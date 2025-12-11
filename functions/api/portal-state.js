const DEFAULT_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-gtf-user-id',
};

function requireUserId(request) {
  const headerId = request.headers.get('x-gtf-user-id');
  if (headerId && headerId.trim()) return headerId.trim().toLowerCase();
  throw new Response(JSON.stringify({ message: 'User id required' }), { status: 401, headers: DEFAULT_HEADERS });
}

function requireDb(env) {
  const db = env?.BIBLE_PROGRESS || env?.DB || env?.__D1_BETA__;
  if (!db) {
    throw new Response(
      JSON.stringify({ message: 'Database binding missing (add BIBLE_PROGRESS/DB D1 binding)' }),
      {
        status: 500,
        headers: DEFAULT_HEADERS,
      }
    );
  }
  return db;
}

async function ensureSchema(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS PortalState (
        Id INTEGER PRIMARY KEY AUTOINCREMENT,
        UserId TEXT NOT NULL UNIQUE,
        Data TEXT NOT NULL,
        UpdatedAt TEXT NOT NULL
      );`
    )
    .run();
}

function safeParseState(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: DEFAULT_HEADERS });
}

export async function onRequestGet({ env, request }) {
  let userId;
  try {
    userId = requireUserId(request);
  } catch (errorResponse) {
    return errorResponse;
  }

  let db;
  try {
    db = requireDb(env);
    await ensureSchema(db);
  } catch (errorResponse) {
    return errorResponse;
  }

  const row = await db.prepare('SELECT Data FROM PortalState WHERE UserId = ?').bind(userId).first();
  const state = safeParseState(row?.Data);

  return new Response(JSON.stringify({ state }), { status: 200, headers: DEFAULT_HEADERS });
}

export async function onRequestPost({ env, request }) {
  let userId;
  try {
    userId = requireUserId(request);
  } catch (errorResponse) {
    return errorResponse;
  }

  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return new Response(JSON.stringify({ message: 'Invalid JSON body' }), { status: 400, headers: DEFAULT_HEADERS });
  }

  if (!payload || typeof payload.state !== 'object') {
    return new Response(JSON.stringify({ message: 'Missing state payload' }), { status: 400, headers: DEFAULT_HEADERS });
  }

  let db;
  try {
    db = requireDb(env);
    await ensureSchema(db);
  } catch (errorResponse) {
    return errorResponse;
  }

  const serialized = JSON.stringify(payload.state);
  const updatedAt = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO PortalState (UserId, Data, UpdatedAt) VALUES (?, ?, ?)
       ON CONFLICT(UserId) DO UPDATE SET Data = excluded.Data, UpdatedAt = excluded.UpdatedAt`
    )
    .bind(userId, serialized, updatedAt)
    .run();

  return new Response(JSON.stringify({ saved: true, updatedAt }), { status: 200, headers: DEFAULT_HEADERS });
}
