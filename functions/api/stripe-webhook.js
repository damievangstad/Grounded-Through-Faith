const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
};

const TEMP_CODE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const DEFAULT_SENDER = 'groundedthroughfaith@gmail.com';
// Seed KnownAccounts with paid member emails so they always receive codes even
// if a webhook has not populated the database yet.
const DEFAULT_KNOWN_EMAILS = ['themissioneffect@gmail.com', 'groundedthroughfaith@gmail.com'];

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateSalt() {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  return toHex(saltBytes.buffer);
}

async function hashSecret(secret, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${salt}:${secret}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

function generateTempCode(length = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => alphabet[b % alphabet.length])
    .join('');
}

// Resolve a D1 binding for membership creation, even if the environment uses a
// different key. Known names are preferred, but we also scan for any binding
// exposing the D1 `prepare` API to avoid failing after successful Stripe
// payments.
function requireDb(env) {
  const direct = env?.BIBLE_PROGRESS || env?.DB || env?.__D1_BETA__ || env?.__D1__;
  if (direct) return direct;

  for (const value of Object.values(env || {})) {
    if (value && typeof value.prepare === 'function') {
      return value;
    }
  }

  throw new Response(JSON.stringify({ message: 'Account database unavailable.' }), {
    status: 503,
    headers: HEADERS,
  });
}

async function ensureSchema(db) {
  // Create the Users table if missing so Stripe webhooks can seed members.
  // NeedsPassword flags first-time sign-ins so the password a member enters is
  // stored immediately, avoiding separate setup screens.
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS Users (
        Id INTEGER PRIMARY KEY AUTOINCREMENT,
        Email TEXT NOT NULL UNIQUE,
        PasswordHash TEXT NOT NULL,
        PasswordSalt TEXT NOT NULL,
        TemporaryCodeHash TEXT,
        TemporaryCodeSalt TEXT,
        TemporaryCodeExpiresAt TEXT,
        NeedsPassword INTEGER NOT NULL DEFAULT 0,
        CreatedAt TEXT NOT NULL
      );`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS KnownAccounts (
        Email TEXT PRIMARY KEY,
        RecordedAt TEXT NOT NULL,
        LastSeenAt TEXT NOT NULL
      );`
    )
    .run();

  const columns = await db.prepare("PRAGMA table_info('Users');").all();
  const columnNames = new Set((columns?.results || columns || []).map((c) => c?.name));

  async function ensureColumn(name, definition) {
    if (!columnNames.has(name)) {
      await db.prepare(`ALTER TABLE Users ADD COLUMN ${name} ${definition};`).run();
    }
  }

  await ensureColumn('TemporaryCodeHash', 'TEXT');
  await ensureColumn('TemporaryCodeSalt', 'TEXT');
  await ensureColumn('TemporaryCodeExpiresAt', 'TEXT');
  await ensureColumn('NeedsPassword', 'INTEGER NOT NULL DEFAULT 0');
}

async function trackKnownAccount(db, email) {
  if (!email) return;
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO KnownAccounts (Email, RecordedAt, LastSeenAt)
       VALUES (?, ?, ?)
       ON CONFLICT(Email) DO UPDATE SET LastSeenAt = excluded.LastSeenAt`
    )
    .bind(email, timestamp, timestamp)
    .run();
}

async function seedKnownAccounts(db) {
  for (const email of DEFAULT_KNOWN_EMAILS) {
    await trackKnownAccount(db, email);
  }
}

async function saveTempCode(db, email, code) {
  // Look for an existing member and refresh their temporary code without
  // disturbing the stored password; this allows optional backup codes.
  const user = await db
    .prepare('SELECT Email, PasswordHash, PasswordSalt FROM Users WHERE Email = ?')
    .bind(email)
    .first();

  const tempSalt = generateSalt();
  const tempHash = await hashSecret(code, tempSalt);
  const expiresAt = new Date(Date.now() + TEMP_CODE_TTL_MS).toISOString();
  const createdAt = new Date().toISOString();

  if (user && user.Email) {
    await db
      .prepare(
        'UPDATE Users SET TemporaryCodeHash = ?, TemporaryCodeSalt = ?, TemporaryCodeExpiresAt = ? WHERE Email = ?'
      )
      .bind(tempHash, tempSalt, expiresAt, email)
      .run();
    await trackKnownAccount(db, email);
    return { exists: true, expiresAt };
  }

  // New members start with a placeholder password hash and a NeedsPassword flag
  // so their first login saves whatever password they enter. The temporary code
  // remains optional for those who prefer using the emailed code one time.
  const salt = generateSalt();
  const placeholderHash = await hashSecret(code + generateTempCode(), salt);
  await db
    .prepare(
      'INSERT INTO Users (Email, PasswordHash, PasswordSalt, TemporaryCodeHash, TemporaryCodeSalt, TemporaryCodeExpiresAt, NeedsPassword, CreatedAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
    )
    .bind(email, placeholderHash, salt, tempHash, tempSalt, expiresAt, createdAt)
    .run();

  await trackKnownAccount(db, email);
  return { exists: false, expiresAt };
}

function resolveSender(env) {
  const configured = (env?.RESEND_FROM || '').trim();
  return configured || DEFAULT_SENDER;
}

async function sendEmail(env, to, code) {
  const subject = 'Welcome to Grounded Through Faith — set your password';
  const text = `Thank you for joining Grounded Through Faith!\n\nVisit https://www.groundedthroughfaith.org/signin.html and enter your email. On your first sign-in, any password you choose will be saved for future logins.\n\nIf you prefer, you can also use this one-time access code: ${code}. It expires in 7 days. After signing in, you can keep using your chosen password.`;
  const html = `<p>Thank you for joining Grounded Through Faith!</p><p>Visit <a href="https://www.groundedthroughfaith.org/signin.html">groundedthroughfaith.org/signin.html</a> and enter your email.</p><p><strong>On your first sign-in, any password you choose will be saved for future logins.</strong></p><p>If you prefer, you can also use this one-time access code: <strong>${code}</strong> (expires in 7 days). After signing in, you can keep using your chosen password.</p>`;

  const resendKey = (env?.RESEND_KEY || '').trim();
  const sender = resolveSender(env);
  if (resendKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({ from: sender, to: Array.isArray(to) ? to : [to], subject, text, html }),
    });

    if (!response.ok) {
      const message = await response.text();
      return { sent: false, reason: message || 'Resend request failed' };
    }

    const json = await response.json().catch(() => ({}));
    return { sent: true, id: json?.id || null, provider: 'resend' };
  }

  const webhook = (env?.EMAIL_WEBHOOK_URL || '').trim();
  if (webhook) {
    const token = (env?.EMAIL_WEBHOOK_TOKEN || '').trim();
    const response = await fetch(webhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
        body: JSON.stringify({ to, subject, text, html, from: sender }),
      });

    if (!response.ok) {
      const message = await response.text();
      return { sent: false, reason: message || 'Email request failed' };
    }

    return { sent: true, provider: 'webhook' };
  }

  return { sent: false, reason: 'Email delivery not configured' };
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: HEADERS });
}

export async function onRequestPost({ env, request }) {
  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return new Response(JSON.stringify({ message: 'Invalid JSON body' }), { status: 400, headers: HEADERS });
  }

  const eventType = payload?.type;
  const session = payload?.data?.object || {};
  const customerEmail = normalizeEmail(session.customer_details?.email || session.customer_email);

  if (!eventType) {
    return new Response(JSON.stringify({ message: 'Event type missing' }), { status: 400, headers: HEADERS });
  }

  if (eventType !== 'checkout.session.completed' && eventType !== 'invoice.payment_succeeded') {
    return new Response(JSON.stringify({ received: true, ignored: true }), { status: 200, headers: HEADERS });
  }

  if (!customerEmail) {
    return new Response(JSON.stringify({ message: 'Customer email missing' }), { status: 200, headers: HEADERS });
  }

  let db;
  try {
    db = requireDb(env);
    await ensureSchema(db);
    await seedKnownAccounts(db);
  } catch (errorResponse) {
    return errorResponse;
  }

  const code = generateTempCode();
  const { expiresAt } = await saveTempCode(db, customerEmail, code);
  const emailStatus = await sendEmail(env, customerEmail, code);

  if (!emailStatus.sent) {
    return new Response(JSON.stringify({ message: emailStatus.reason || 'Unable to send membership code email' }), {
      status: 500,
      headers: HEADERS,
    });
  }

  return new Response(
    JSON.stringify({
      issued: true,
      email: customerEmail,
      expiresAt,
      emailDelivered: emailStatus.sent,
      emailError: emailStatus.reason || null,
    }),
    { status: 200, headers: HEADERS }
  );
}
