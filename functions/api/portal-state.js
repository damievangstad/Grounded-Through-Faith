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

// Locate any available D1 database binding so portal state can load even when
// the environment uses non-standard names. We check known keys first and then
// scan for any binding exposing the D1 `prepare` API.
function requireDb(env) {
  const direct = env?.BIBLE_PROGRESS || env?.DB || env?.__D1_BETA__ || env?.__D1__;
  if (direct) return direct;

  for (const value of Object.values(env || {})) {
    if (value && typeof value.prepare === 'function') {
      return value;
    }
  }

  throw new Response(JSON.stringify({ message: 'Account data currently unavailable.' }), {
    status: 503,
    headers: DEFAULT_HEADERS,
  });
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
