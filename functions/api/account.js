const DEFAULT_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const DEFAULT_SENDER = 'groundedthroughfaith@gmail.com';
// Seed KnownAccounts with paying member emails so lookup and code requests work
// even before Stripe webhooks insert user rows. Unlike the previous iteration
// that auto-created accounts for any email, we now limit access to emails that
// came through checkout or were explicitly seeded as members.
const DEFAULT_KNOWN_EMAILS = ['themissioneffect@gmail.com', 'groundedthroughfaith@gmail.com'];

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

// Resolve the best-available D1 binding so account actions do not fail when the
// environment uses a different name. We scan common binding names first, then
// fall back to any value that exposes a `prepare` function (the D1 interface).
function requireDb(env) {
  const direct = env?.BIBLE_PROGRESS || env?.DB || env?.__D1_BETA__ || env?.__D1__;
  if (direct) return direct;

  for (const value of Object.values(env || {})) {
    if (value && typeof value.prepare === 'function') {
      return value;
    }
  }

  throw new Response(
    JSON.stringify({ message: 'Account service unavailable. Please try again shortly.' }),
    {
      status: 503,
      headers: DEFAULT_HEADERS,
    }
  );
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

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS PasswordResets (
        Id INTEGER PRIMARY KEY AUTOINCREMENT,
        Email TEXT NOT NULL,
        Token TEXT NOT NULL UNIQUE,
        ExpiresAt TEXT NOT NULL,
        Used INTEGER NOT NULL DEFAULT 0,
        CreatedAt TEXT NOT NULL
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

// Create a lightweight placeholder user if a KnownAccounts record exists but no
// corresponding Users row is present. This keeps paid members from hitting
// "account not found" errors when requesting codes before the Stripe webhook
// has populated the Users table.
async function ensureUserForKnownAccount(db, email) {
  if (!email) return null;

  const existing = await db.prepare('SELECT Email FROM Users WHERE Email = ?').bind(email).first();
  if (existing && existing.Email) {
    return existing;
  }

  const known = await db.prepare('SELECT Email FROM KnownAccounts WHERE Email = ?').bind(email).first();
  if (!known || !known.Email) {
    return null;
  }

  const placeholderSalt = generateSalt();
  const placeholderHash = await hashPassword(generateTempCode() + generateTempCode(), placeholderSalt);
  const createdAt = new Date().toISOString();

  await db
    .prepare(
      'INSERT INTO Users (Email, PasswordHash, PasswordSalt, CreatedAt) VALUES (?, ?, ?, ?)' 
    )
    .bind(email, placeholderHash, placeholderSalt, createdAt)
    .run();

  await trackKnownAccount(db, email);
  return { Email: email };
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

function generateResetToken() {
  const tokenBytes = new Uint8Array(16);
  crypto.getRandomValues(tokenBytes);
  return toHex(tokenBytes.buffer);
}

function isExpired(timestamp) {
  if (!timestamp) return true;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) || date.getTime() < Date.now();
}

async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

async function verifyPassword(password, salt, expectedHash) {
  const actualHash = await hashPassword(password, salt);
  return actualHash === expectedHash;
}

function generateTempCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    const idx = Math.floor(Math.random() * chars.length);
    code += chars[idx];
  }
  return code;
}

function resolveSender(env, override) {
  const configured = (env?.RESEND_FROM || '').trim();
  return override || configured || DEFAULT_SENDER;
}

async function sendEmail(env, to, { subject, text, html, from }) {
  const resendKey = (env?.RESEND_KEY || '').trim();
  const sender = resolveSender(env, from);

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
      return { sent: false, reason: message || 'Resend request failed', provider: 'resend' };
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
  return new Response(null, { status: 204, headers: DEFAULT_HEADERS });
}

export async function onRequestPost({ env, request }) {
  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return new Response(JSON.stringify({ message: 'Invalid JSON body' }), { status: 400, headers: DEFAULT_HEADERS });
  }

  const action = (payload?.action || '').trim().toLowerCase();
  const email = normalizeEmail(payload?.email);
  const password = (payload?.password || '').trim();
  const currentSecret = (payload?.current || '').trim();

  if (!action || !email) {
    return new Response(JSON.stringify({ message: 'Email and action are required' }), {
      status: 400,
      headers: DEFAULT_HEADERS,
    });
  }

  // Membership access is handled with emailed codes rather than user-created
  // passwords. We only require a code (passed via the password field) for
  // login and ignore password creation flows entirely.
  const requiresCode = ['login'].includes(action);
  if (requiresCode && !password) {
    return new Response(JSON.stringify({ message: 'Membership code is required for this action' }), {
      status: 400,
      headers: DEFAULT_HEADERS,
    });
  }

  let db;
  try {
    db = requireDb(env);
    await ensureSchema(db);
    await seedKnownAccounts(db);
  } catch (errorResponse) {
    return errorResponse;
  }

  if (action === 'login') {
    // Pull the account; if it does not exist, try to hydrate it from a seeded
    // KnownAccounts entry so only paid or pre-approved emails can sign in.
    let user = await db
      .prepare(
        'SELECT Email, TemporaryCodeHash, TemporaryCodeSalt, TemporaryCodeExpiresAt, PasswordHash, PasswordSalt FROM Users WHERE Email = ?'
      )
      .bind(email)
      .first();

    if (!user || !user.Email) {
      user = await ensureUserForKnownAccount(db, email);
    }

    if (!user || !user.Email) {
      return new Response(
        JSON.stringify({ message: 'Email not found. Use the email from your membership purchase.' }),
        { status: 404, headers: DEFAULT_HEADERS }
      );
    }

    await trackKnownAccount(db, email);

    const hasTempCode = user.TemporaryCodeHash && user.TemporaryCodeSalt && !isExpired(user.TemporaryCodeExpiresAt);
    const validTemp = hasTempCode ? await verifyPassword(password, user.TemporaryCodeSalt, user.TemporaryCodeHash) : false;

    // Legacy passwords are still honored for existing users, but the primary
    // path uses the emailed membership code. This keeps earlier members
    // functional while focusing new logins on codes only.
    const validPassword = user.PasswordHash && user.PasswordSalt
      ? await verifyPassword(password, user.PasswordSalt, user.PasswordHash)
      : false;

    if (!validTemp && !validPassword) {
      return new Response(JSON.stringify({ message: 'Invalid membership code' }), { status: 401, headers: DEFAULT_HEADERS });
    }

    return new Response(JSON.stringify({ userId: email }), { status: 200, headers: DEFAULT_HEADERS });
  }

  if (action === 'lookup-account') {
    // Confirm whether the email already exists as a user or known account so the
    // UI can prompt the member to use the same address they used at checkout.
    const user = await db.prepare('SELECT Email FROM Users WHERE Email = ?').bind(email).first();
    const known = await db.prepare('SELECT Email FROM KnownAccounts WHERE Email = ?').bind(email).first();
    const exists = Boolean(user?.Email || known?.Email);
    if (exists) {
      await trackKnownAccount(db, email);
    }
    return new Response(JSON.stringify({ exists, created: false }), {
      status: exists ? 200 : 404,
      headers: DEFAULT_HEADERS,
    });
  }

  if (action === 'set-password') {
    return new Response(JSON.stringify({ message: 'Password setup is disabled. Use your membership code to sign in.' }), {
      status: 400,
      headers: DEFAULT_HEADERS,
    });
  }

  if (action === 'request-reset') {
    return new Response(JSON.stringify({ message: 'Password resets are disabled. Use your membership code instead.' }), {
      status: 400,
      headers: DEFAULT_HEADERS,
    });
  }

  if (action === 'request-temp-code') {
    // Send a login code only when the email matches an existing member account
    // or a KnownAccounts entry that originated from Stripe checkout seeding.
    let user = await db.prepare('SELECT Email FROM Users WHERE Email = ?').bind(email).first();

    if (!user || !user.Email) {
      user = await ensureUserForKnownAccount(db, email);
    }

    if (!user || !user.Email) {
      return new Response(JSON.stringify({ message: 'Email not found. Use the email from your membership purchase.' }), {
        status: 404,
        headers: DEFAULT_HEADERS,
      });
    }

    await trackKnownAccount(db, email);

    const code = generateTempCode();
    const tempSalt = generateSalt();
    const tempHash = await hashPassword(code, tempSalt);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await db
      .prepare(
        'UPDATE Users SET TemporaryCodeHash = ?, TemporaryCodeSalt = ?, TemporaryCodeExpiresAt = ? WHERE Email = ?'
      )
      .bind(tempHash, tempSalt, expiresAt, email)
      .run();

    const emailStatus = await sendEmail(env, email, {
      from: 'groundedthroughfaith@gmail.com',
      subject: 'Your Grounded Through Faith membership code',
      text: `Here is your membership code: ${code}. It expires in 7 days. Use this code to sign in to the member portal.`,
      html: `<p>Here is your Grounded Through Faith membership code:</p><p><strong style="font-size:18px;letter-spacing:2px;">${code}</strong></p><p>This code expires in 7 days. Use it to sign in to the member portal.</p>`,
    });

    const delivered = Boolean(emailStatus?.sent);
    const message = delivered
      ? 'Temporary code sent'
      : `Login code created, but email could not be sent${emailStatus?.reason ? `: ${emailStatus.reason}` : ''}`;

    return new Response(
      JSON.stringify({ message, expiresAt, code, emailDelivered: delivered, emailError: delivered ? null : emailStatus?.reason || 'Email delivery failed' }),
      { status: delivered ? 200 : 207, headers: DEFAULT_HEADERS }
    );
  }

  if (action === 'reset-password') {
    return new Response(JSON.stringify({ message: 'Password resets are disabled. Use your membership code instead.' }), {
      status: 400,
      headers: DEFAULT_HEADERS,
    });
  }

  if (action === 'issue-temp-code') {
    const adminKey = (payload?.adminKey || '').trim();
    const expectedKey = (env?.ACCOUNT_ADMIN_KEY || '').trim();
    if (!expectedKey) {
      return new Response(JSON.stringify({ message: 'Admin key missing' }), { status: 500, headers: DEFAULT_HEADERS });
    }

    if (adminKey !== expectedKey) {
      return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 403, headers: DEFAULT_HEADERS });
    }

    const code = (payload?.code || '').trim();
    if (!code) {
      return new Response(JSON.stringify({ message: 'Temporary code is required' }), { status: 400, headers: DEFAULT_HEADERS });
    }

    const tempSalt = generateSalt();
    const tempHash = await hashPassword(code, tempSalt);
    const expiresAt = payload?.expiresAt || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const createdAt = new Date().toISOString();

    const user = await db.prepare('SELECT Email FROM Users WHERE Email = ?').bind(email).first();

    if (user && user.Email) {
      await db
        .prepare(
          'UPDATE Users SET TemporaryCodeHash = ?, TemporaryCodeSalt = ?, TemporaryCodeExpiresAt = ? WHERE Email = ?'
        )
        .bind(tempHash, tempSalt, expiresAt, email)
        .run();
    } else {
      const salt = generateSalt();
      const hash = await hashPassword(code, salt);
      await db
        .prepare(
          'INSERT INTO Users (Email, PasswordHash, PasswordSalt, TemporaryCodeHash, TemporaryCodeSalt, TemporaryCodeExpiresAt, CreatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(email, hash, salt, tempHash, tempSalt, expiresAt, createdAt)
        .run();
    }

    await trackKnownAccount(db, email);

    return new Response(JSON.stringify({ userId: email, expiresAt }), { status: 200, headers: DEFAULT_HEADERS });
  }

  return new Response(JSON.stringify({ message: 'Unsupported action' }), { status: 400, headers: DEFAULT_HEADERS });
}
