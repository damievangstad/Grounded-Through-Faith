const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
};

const TEMP_CODE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const DEFAULT_SENDER = 'groundedthroughfaith@gmail.com';
const DEFAULT_KNOWN_EMAILS = ['themissioneffect@gmail.com'];

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

function requireDb(env) {
  const db = env?.BIBLE_PROGRESS;
  if (!db) {
    throw new Response(JSON.stringify({ message: 'Database binding missing' }), { status: 500, headers: HEADERS });
  }
  return db;
}

async function ensureSchema(db) {
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
  const user = await db.prepare('SELECT Email, PasswordHash, PasswordSalt FROM Users WHERE Email = ?').bind(email).first();
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

  // New users keep their temporary code as the initial password hash to allow immediate sign-in.
  const salt = generateSalt();
  const hash = await hashSecret(code, salt);
  await db
    .prepare(
      'INSERT INTO Users (Email, PasswordHash, PasswordSalt, TemporaryCodeHash, TemporaryCodeSalt, TemporaryCodeExpiresAt, CreatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(email, hash, salt, tempHash, tempSalt, expiresAt, createdAt)
    .run();

  await trackKnownAccount(db, email);
  return { exists: false, expiresAt };
}

async function sendEmail(env, to, code) {
  const subject = 'Your Grounded Through Faith membership code';
  const text = `Welcome to Grounded Through Faith! Your membership code is: ${code}\n\nGo to https://www.groundedthroughfaith.org/signin.html and enter this code as your password. After signing in, you will be prompted to create a permanent password for future logins.`;
  const html = `<p>Welcome to Grounded Through Faith!</p><p>Your membership code is <strong>${code}</strong>.</p><p>Go to <a href="https://www.groundedthroughfaith.org/signin.html">groundedthroughfaith.org/signin.html</a> and enter this code as your password. After signing in, you will be prompted to create a permanent password for future logins.</p>`;

  const resendKey = (env?.RESEND_KEY || '').trim();
  if (resendKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({ from: DEFAULT_SENDER, to: Array.isArray(to) ? to : [to], subject, text, html }),
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
      body: JSON.stringify({ to, subject, text, html, from: DEFAULT_SENDER }),
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
