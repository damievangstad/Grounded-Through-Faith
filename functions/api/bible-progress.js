const DEFAULT_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-gtf-user-id',
};

function requireUserId(request) {
  const headerId = request.headers.get('x-gtf-user-id');
  if (headerId && headerId.trim()) return headerId.trim();
  throw new Response(JSON.stringify({ message: 'User id required' }), { status: 401, headers: DEFAULT_HEADERS });
}

// Ensure the Bible progress table exists so chapter completion can be saved and
// queried reliably for each user.
async function ensureSchema(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS BibleReadingProgress (
      Id INTEGER PRIMARY KEY AUTOINCREMENT,
      UserId TEXT NOT NULL,
      Book TEXT NOT NULL,
      Chapter INTEGER NOT NULL,
      Completed INTEGER NOT NULL DEFAULT 0,
      CompletedDate TEXT
    );`
  ).run();

  await db.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS IX_BibleReadingProgress_UserBookChapter
     ON BibleReadingProgress(UserId, Book, Chapter);`
  ).run();
}

// Normalize a raw database row into a consistent JSON object for clients.
function normalizeRow(row) {
  return {
    id: row.Id,
    userId: row.UserId,
    book: row.Book,
    chapter: row.Chapter,
    completed: Boolean(row.Completed),
    completedDate: row.CompletedDate || null,
  };
}

// Locate an available D1 binding regardless of the configured environment key
// so users can load and save progress even if the binding name changes.
function requireDb(env) {
  const direct = env?.BIBLE_PROGRESS || env?.DB || env?.__D1_BETA__ || env?.__D1__;
  if (direct) return direct;

  for (const value of Object.values(env || {})) {
    if (value && typeof value.prepare === 'function') {
      return value;
    }
  }

  throw new Response(JSON.stringify({ message: 'Progress storage unavailable right now.' }), {
    status: 503,
    headers: DEFAULT_HEADERS,
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: DEFAULT_HEADERS });
}

export async function onRequestGet({ env, request }) {
  const db = requireDb(env);

  let userId;
  try {
    userId = requireUserId(request);
  } catch (errorResponse) {
    return errorResponse;
  }

  await ensureSchema(db);
  const { results } = await db.prepare(
    'SELECT * FROM BibleReadingProgress WHERE UserId = ? ORDER BY Book, Chapter'
  ).bind(userId).all();

  const progress = Array.isArray(results) ? results.map(normalizeRow) : [];

  return new Response(JSON.stringify({ progress }), {
    status: 200,
    headers: DEFAULT_HEADERS,
  });
}

export async function onRequestPost({ env, request }) {
  const db = requireDb(env);

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

  const updates = Array.isArray(payload?.updates) ? payload.updates : [];
  if (!updates.length) {
    return new Response(JSON.stringify({ message: 'No updates supplied' }), { status: 400, headers: DEFAULT_HEADERS });
  }

  await ensureSchema(db);

  let saved = 0;
  for (const update of updates) {
    const book = (update.book || '').trim();
    const chapter = Number(update.chapter);
    if (!book || Number.isNaN(chapter)) continue;

    const completed = update.completed ? 1 : 0;
    const completedDate = update.completedDate || (completed ? new Date().toISOString() : null);

    await db
      .prepare(
        `INSERT INTO BibleReadingProgress (UserId, Book, Chapter, Completed, CompletedDate)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(UserId, Book, Chapter)
         DO UPDATE SET Completed = excluded.Completed, CompletedDate = excluded.CompletedDate`
      )
      .bind(userId, book, chapter, completed, completedDate)
      .run();
    saved += 1;
  }

  return new Response(JSON.stringify({ saved }), { status: 200, headers: DEFAULT_HEADERS });
}
