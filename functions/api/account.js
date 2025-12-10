const DEFAULT_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const DEFAULT_SENDER = 'groundedthroughfaith@gmail.com';

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function requireDb(env) {
  const db = env?.BIBLE_PROGRESS;
  if (!db) {
    throw new Response(JSON.stringify({ message: 'Database binding missing' }), {
      status: 500,
      headers: DEFAULT_HEADERS,
    });
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

async function sendEmail(env, to, { subject, text, html, from }) {
  const webhook = (env?.EMAIL_WEBHOOK_URL || '').trim();
  if (!webhook) {
    throw new Error('Email webhook not configured');
  }

  const token = (env?.EMAIL_WEBHOOK_TOKEN || '').trim();
  const response = await fetch(webhook, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ to, subject, text, html, from: from || DEFAULT_SENDER }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Email request failed');
  }
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

  const requiresPassword = ['register', 'login', 'reset-password', 'set-password'].includes(action);
  if (requiresPassword && !password) {
    return new Response(JSON.stringify({ message: 'Password is required for this action' }), {
      status: 400,
      headers: DEFAULT_HEADERS,
    });
  }

  const requiresMinLength = ['register', 'reset-password', 'set-password'].includes(action);
  if (requiresMinLength && password.length < 8) {
    return new Response(JSON.stringify({ message: 'Password must be at least 8 characters' }), {
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

  if (action === 'login') {
    const user = await db
      .prepare(
        'SELECT Email, PasswordHash, PasswordSalt, TemporaryCodeHash, TemporaryCodeSalt, TemporaryCodeExpiresAt FROM Users WHERE Email = ?'
      )
      .bind(email)
      .first();

    if (!user || !user.Email) {
      return new Response(JSON.stringify({ message: 'Account not found' }), { status: 404, headers: DEFAULT_HEADERS });
    }

    await trackKnownAccount(db, email);

    const validPassword = await verifyPassword(password, user.PasswordSalt, user.PasswordHash);

    const hasTempCode = user.TemporaryCodeHash && user.TemporaryCodeSalt && !isExpired(user.TemporaryCodeExpiresAt);
    const validTemp = hasTempCode ? await verifyPassword(password, user.TemporaryCodeSalt, user.TemporaryCodeHash) : false;

    if (!validPassword && !validTemp) {
      return new Response(JSON.stringify({ message: 'Invalid credentials' }), { status: 401, headers: DEFAULT_HEADERS });
    }

    const requiresPasswordChange = Boolean(validTemp && hasTempCode);

    return new Response(JSON.stringify({ userId: email, requiresPasswordChange }), { status: 200, headers: DEFAULT_HEADERS });
  }

  if (action === 'lookup-account') {
    const user = await db.prepare('SELECT Email FROM Users WHERE Email = ?').bind(email).first();
    if (user && user.Email) {
      await trackKnownAccount(db, email);
      return new Response(JSON.stringify({ exists: true }), { status: 200, headers: DEFAULT_HEADERS });
    }

    return new Response(JSON.stringify({ exists: false }), { status: 404, headers: DEFAULT_HEADERS });
  }

  if (action === 'set-password') {
    if (!currentSecret) {
      return new Response(JSON.stringify({ message: 'Current password or code is required' }), {
        status: 400,
        headers: DEFAULT_HEADERS,
      });
    }

    const user = await db
      .prepare(
        'SELECT Email, PasswordHash, PasswordSalt, TemporaryCodeHash, TemporaryCodeSalt, TemporaryCodeExpiresAt FROM Users WHERE Email = ?'
      )
      .bind(email)
      .first();

    if (!user || !user.Email) {
      return new Response(JSON.stringify({ message: 'Account not found' }), { status: 404, headers: DEFAULT_HEADERS });
    }

    await trackKnownAccount(db, email);

    const validPassword = await verifyPassword(currentSecret, user.PasswordSalt, user.PasswordHash);
    const hasTempCode = user.TemporaryCodeHash && user.TemporaryCodeSalt && !isExpired(user.TemporaryCodeExpiresAt);
    const validTemp = hasTempCode ? await verifyPassword(currentSecret, user.TemporaryCodeSalt, user.TemporaryCodeHash) : false;

    if (!validPassword && !validTemp) {
      return new Response(JSON.stringify({ message: 'Current password or code is incorrect' }), {
        status: 401,
        headers: DEFAULT_HEADERS,
      });
    }

    const salt = generateSalt();
    const hash = await hashPassword(password, salt);

    await db
      .prepare(
        'UPDATE Users SET PasswordHash = ?, PasswordSalt = ?, TemporaryCodeHash = NULL, TemporaryCodeSalt = NULL, TemporaryCodeExpiresAt = NULL WHERE Email = ?'
      )
      .bind(hash, salt, email)
      .run();

    return new Response(JSON.stringify({ userId: email }), { status: 200, headers: DEFAULT_HEADERS });
  }

  if (action === 'request-reset') {
    const user = await db.prepare('SELECT Email FROM Users WHERE Email = ?').bind(email).first();
    if (!user || !user.Email) {
      return new Response(JSON.stringify({ message: 'Account not found' }), { status: 404, headers: DEFAULT_HEADERS });
    }

    await trackKnownAccount(db, email);

    const token = generateResetToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const createdAt = new Date().toISOString();

    await db
      .prepare('INSERT INTO PasswordResets (Email, Token, ExpiresAt, CreatedAt) VALUES (?, ?, ?, ?)')
      .bind(email, token, expiresAt, createdAt)
      .run();

    try {
      await sendEmail(env, email, {
        subject: 'Reset your Grounded Through Faith password',
        text: `Use this code to reset your password: ${token}. It expires in 30 minutes. If you did not request this, ignore this email.`,
        html: `<p>Use this code to reset your password: <strong>${token}</strong>.</p><p>This code expires in 30 minutes. If you did not request this, you can ignore this email.</p>`,
      });
    } catch (error) {
      return new Response(JSON.stringify({ message: `Unable to send reset email: ${error.message}` }), {
        status: 500,
        headers: DEFAULT_HEADERS,
      });
    }

    return new Response(
      JSON.stringify({
        message: 'Reset instructions generated',
        resetToken: token,
        expiresAt,
      }),
      { status: 200, headers: DEFAULT_HEADERS }
    );
  }

  if (action === 'request-temp-code') {
    const user = await db
      .prepare('SELECT Email FROM Users WHERE Email = ?')
      .bind(email)
      .first();

    if (!user || !user.Email) {
      return new Response(JSON.stringify({ message: 'Account not found' }), { status: 404, headers: DEFAULT_HEADERS });
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

    try {
      await sendEmail(env, email, {
        from: 'groundedthroughfaith@gmail.com',
        subject: 'Your Grounded Through Faith login code',
        text: `Here is your login code: ${code}. It expires in 7 days. Use this code as your password to sign in, then set a new password to keep your account secure.`,
        html: `<p>Here is your Grounded Through Faith login code:</p><p><strong style="font-size:18px;letter-spacing:2px;">${code}</strong></p><p>This code expires in 7 days. Use it as your password to sign in, then set a new password to keep your account secure.</p>`,
      });
    } catch (error) {
      return new Response(JSON.stringify({ message: `Unable to send code email: ${error.message}` }), {
        status: 500,
        headers: DEFAULT_HEADERS,
      });
    }

    return new Response(
      JSON.stringify({ message: 'Temporary code sent', expiresAt }),
      { status: 200, headers: DEFAULT_HEADERS }
    );
  }

  if (action === 'reset-password') {
    const token = (payload?.token || '').trim();
    if (!token) {
      return new Response(JSON.stringify({ message: 'Reset token is required' }), { status: 400, headers: DEFAULT_HEADERS });
    }

    if (!password || password.length < 8) {
      return new Response(JSON.stringify({ message: 'New password must be at least 8 characters' }), {
        status: 400,
        headers: DEFAULT_HEADERS,
      });
    }

    const reset = await db
      .prepare('SELECT Email, ExpiresAt, Used FROM PasswordResets WHERE Token = ?')
      .bind(token)
      .first();

    if (!reset || !reset.Email) {
      return new Response(JSON.stringify({ message: 'Reset link invalid or expired' }), { status: 404, headers: DEFAULT_HEADERS });
    }

    if (reset.Used) {
      return new Response(JSON.stringify({ message: 'Reset link already used' }), { status: 400, headers: DEFAULT_HEADERS });
    }

    const expiresAt = new Date(reset.ExpiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      return new Response(JSON.stringify({ message: 'Reset link invalid or expired' }), { status: 400, headers: DEFAULT_HEADERS });
    }

    if (reset.Email !== email) {
      return new Response(JSON.stringify({ message: 'Email does not match this reset request' }), {
        status: 400,
        headers: DEFAULT_HEADERS,
      });
    }

    const salt = generateSalt();
    const hash = await hashPassword(password, salt);

    await db
      .prepare('UPDATE Users SET PasswordHash = ?, PasswordSalt = ? WHERE Email = ?')
      .bind(hash, salt, email)
      .run();

    await trackKnownAccount(db, email);

    await db.prepare('UPDATE PasswordResets SET Used = 1 WHERE Token = ?').bind(token).run();

    await db
      .prepare('UPDATE Users SET TemporaryCodeHash = NULL, TemporaryCodeSalt = NULL, TemporaryCodeExpiresAt = NULL WHERE Email = ?')
      .bind(email)
      .run();

    return new Response(JSON.stringify({ message: 'Password updated successfully' }), { status: 200, headers: DEFAULT_HEADERS });
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
