const DEFAULT_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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
        CreatedAt TEXT NOT NULL
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

  if (!action || !email) {
    return new Response(JSON.stringify({ message: 'Email and action are required' }), {
      status: 400,
      headers: DEFAULT_HEADERS,
    });
  }

  const requiresPassword = ['register', 'login', 'reset-password'].includes(action);
  if (requiresPassword && !password) {
    return new Response(JSON.stringify({ message: 'Password is required for this action' }), {
      status: 400,
      headers: DEFAULT_HEADERS,
    });
  }

  if (requiresPassword && password.length < 8) {
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

  if (action === 'register') {
    const existing = await db.prepare('SELECT Email FROM Users WHERE Email = ?').bind(email).first();
    if (existing && existing.Email) {
      return new Response(JSON.stringify({ message: 'Account already exists' }), {
        status: 409,
        headers: DEFAULT_HEADERS,
      });
    }

    const salt = generateSalt();
    const hash = await hashPassword(password, salt);
    const createdAt = new Date().toISOString();

    await db
      .prepare('INSERT INTO Users (Email, PasswordHash, PasswordSalt, CreatedAt) VALUES (?, ?, ?, ?)')
      .bind(email, hash, salt, createdAt)
      .run();

    return new Response(JSON.stringify({ userId: email, createdAt }), { status: 200, headers: DEFAULT_HEADERS });
  }

  if (action === 'login') {
    const user = await db
      .prepare('SELECT Email, PasswordHash, PasswordSalt FROM Users WHERE Email = ?')
      .bind(email)
      .first();

    if (!user || !user.Email) {
      return new Response(JSON.stringify({ message: 'Account not found' }), { status: 404, headers: DEFAULT_HEADERS });
    }

    const valid = await verifyPassword(password, user.PasswordSalt, user.PasswordHash);
    if (!valid) {
      return new Response(JSON.stringify({ message: 'Invalid credentials' }), { status: 401, headers: DEFAULT_HEADERS });
    }

    return new Response(JSON.stringify({ userId: email }), { status: 200, headers: DEFAULT_HEADERS });
  }

  if (action === 'request-reset') {
    const user = await db.prepare('SELECT Email FROM Users WHERE Email = ?').bind(email).first();
    if (!user || !user.Email) {
      return new Response(JSON.stringify({ message: 'Account not found' }), { status: 404, headers: DEFAULT_HEADERS });
    }

    const token = generateResetToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const createdAt = new Date().toISOString();

    await db
      .prepare('INSERT INTO PasswordResets (Email, Token, ExpiresAt, CreatedAt) VALUES (?, ?, ?, ?)')
      .bind(email, token, expiresAt, createdAt)
      .run();

    return new Response(
      JSON.stringify({
        message: 'Reset instructions generated',
        resetToken: token,
        expiresAt,
      }),
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

    await db.prepare('UPDATE PasswordResets SET Used = 1 WHERE Token = ?').bind(token).run();

    return new Response(JSON.stringify({ message: 'Password updated successfully' }), { status: 200, headers: DEFAULT_HEADERS });
  }

  return new Response(JSON.stringify({ message: 'Unsupported action' }), { status: 400, headers: DEFAULT_HEADERS });
}
