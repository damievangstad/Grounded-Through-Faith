// Shared HTTP headers keep every response CORS-friendly and JSON encoded so
// the browser clients can interpret results without extra parsing steps.
const DEFAULT_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Outbound email defaults keep transactional messages consistent even when no
// custom sender is configured in the environment.
const DEFAULT_SENDER = 'groundedthroughfaith@gmail.com';

// Previously we tried to mint accounts automatically during checkout, but that
// caused confusion. KnownAccounts remains to honor earlier seeded rows, yet the
// primary path now requires users to register first and then subscribe.
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
  // Create the Users table if it does not already exist. Each column captures
  // the credential state so we can support temporary codes and first-time
  // password creation without breaking existing members.
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
        IsSubscriber INTEGER NOT NULL DEFAULT 0,
        SubscriberSince TEXT,
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
  await ensureColumn('NeedsPassword', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('IsSubscriber', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('SubscriberSince', 'TEXT');
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

  // All flows require a password for login, but first-time members create that
  // password during their initial sign-in. We still enforce presence for the
  // login action so we can hash and save it when missing.
  if (action === 'login' && !password) {
    return new Response(JSON.stringify({ message: 'Password is required to sign in.' }), {
      status: 400,
      headers: DEFAULT_HEADERS,
    });
  }

  // Registration must capture a password upfront because we now insist on
  // creating accounts before checkout instead of inventing credentials after
  // payment succeeds.
  if (action === 'register' && !password) {
    return new Response(JSON.stringify({ message: 'Choose a password to create your account.' }), {
      status: 400,
      headers: DEFAULT_HEADERS,
    });
  }

  let db;
  try {
    db = requireDb(env);
    await ensureSchema(db);
  } catch (errorResponse) {
    return errorResponse;
  }

  if (action === 'register') {
    // New members create a credential before paying. We only block duplicates
    // and keep the flow simple so checkout can rely on an existing account.
    const existing = await db
      .prepare('SELECT Email FROM Users WHERE Email = ?')
      .bind(email)
      .first();

    if (existing && existing.Email) {
      return new Response(JSON.stringify({ message: 'An account already exists for this email. Please sign in instead.' }), {
        status: 409,
        headers: DEFAULT_HEADERS,
      });
    }

    const salt = generateSalt();
    const hash = await hashPassword(password, salt);
    const createdAt = new Date().toISOString();

    await db
      .prepare(
        'INSERT INTO Users (Email, PasswordHash, PasswordSalt, NeedsPassword, IsSubscriber, CreatedAt) VALUES (?, ?, ?, 0, 0, ?)'
      )
      .bind(email, hash, salt, createdAt)
      .run();

    await trackKnownAccount(db, email);

    return new Response(
      JSON.stringify({ userId: email, subscriber: false, passwordCreated: true, created: true }),
      { status: 201, headers: DEFAULT_HEADERS }
    );
  }

  if (action === 'login') {
    // Pull the account; we no longer invent users during checkout, so a missing
    // email means the member must register before subscribing.
    const user = await db
      .prepare(
        'SELECT Email, TemporaryCodeHash, TemporaryCodeSalt, TemporaryCodeExpiresAt, PasswordHash, PasswordSalt, NeedsPassword, IsSubscriber FROM Users WHERE Email = ?'
      )
      .bind(email)
      .first();

    if (!user || !user.Email) {
      return new Response(
        JSON.stringify({ message: 'Email not found. Please create an account before subscribing.' }),
        { status: 404, headers: DEFAULT_HEADERS }
      );
    }

    await trackKnownAccount(db, email);

    const needsPassword = user.NeedsPassword === 1 || user.NeedsPassword === '1';
    const hasTempCode = user.TemporaryCodeHash && user.TemporaryCodeSalt && !isExpired(user.TemporaryCodeExpiresAt);
    const validTemp = hasTempCode ? await verifyPassword(password, user.TemporaryCodeSalt, user.TemporaryCodeHash) : false;

    // If the member has never set a password, accept the provided one, hash it,
    // and clear any temporary code so future logins rely on the stored secret.
    if (needsPassword || !user.PasswordHash || !user.PasswordSalt) {
      const salt = generateSalt();
      const hash = await hashPassword(password, salt);
      await db
        .prepare(
          'UPDATE Users SET PasswordHash = ?, PasswordSalt = ?, NeedsPassword = 0, TemporaryCodeHash = NULL, TemporaryCodeSalt = NULL, TemporaryCodeExpiresAt = NULL WHERE Email = ?'
        )
        .bind(hash, salt, email)
        .run();

      return new Response(
        JSON.stringify({ userId: email, passwordCreated: true, subscriber: user.IsSubscriber === 1 || user.IsSubscriber === '1' }),
        { status: 200, headers: DEFAULT_HEADERS }
      );
    }

    // Otherwise validate against either a fresh temporary code or the stored
    // password hash so existing members continue to work during the transition.
    const validPassword = user.PasswordHash && user.PasswordSalt
      ? await verifyPassword(password, user.PasswordSalt, user.PasswordHash)
      : false;

    if (!validTemp && !validPassword) {
      return new Response(JSON.stringify({ message: 'Invalid password or code' }), { status: 401, headers: DEFAULT_HEADERS });
    }

    // If the user logged in with a temporary code, keep it from blocking future
    // password-based sign-ins by clearing the expired state.
    if (validTemp) {
      await db
        .prepare(
          'UPDATE Users SET TemporaryCodeHash = NULL, TemporaryCodeSalt = NULL, TemporaryCodeExpiresAt = NULL WHERE Email = ?'
        )
        .bind(email)
        .run();
    }

    return new Response(
      JSON.stringify({
        userId: email,
        passwordCreated: false,
        subscriber: user.IsSubscriber === 1 || user.IsSubscriber === '1',
      }),
      { status: 200, headers: DEFAULT_HEADERS }
    );
  }

  if (action === 'lookup-account') {
    // Confirm whether the email already exists so the UI can nudge members to
    // sign in instead of creating duplicate accounts.
    const user = await db.prepare('SELECT Email FROM Users WHERE Email = ?').bind(email).first();
    const exists = Boolean(user?.Email);
    if (exists) await trackKnownAccount(db, email);
    return new Response(JSON.stringify({ exists, created: false }), { status: exists ? 200 : 404, headers: DEFAULT_HEADERS });
  }

  if (action === 'set-password') {
    return new Response(JSON.stringify({ message: 'Password updates are not available yet. Please sign in with your saved password.' }), {
      status: 400,
      headers: DEFAULT_HEADERS,
    });
  }

  if (action === 'request-reset') {
    return new Response(JSON.stringify({ message: 'Password resets are not available yet. Contact support if you need help.' }), {
      status: 400,
      headers: DEFAULT_HEADERS,
    });
  }

  if (action === 'request-temp-code') {
    // Temporary codes are no longer issued automatically. The flow now focuses
    // on password-based sign-ins after users have created accounts.
    return new Response(JSON.stringify({ message: 'Temporary codes are disabled. Please sign in with your password.' }), {
      status: 400,
      headers: DEFAULT_HEADERS,
    });
  }

  if (action === 'reset-password') {
    return new Response(JSON.stringify({ message: 'Password resets are not available yet. Contact support if you need help.' }), {
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
