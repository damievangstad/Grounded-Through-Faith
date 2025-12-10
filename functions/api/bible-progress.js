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

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: DEFAULT_HEADERS });
}

export async function onRequestGet({ env, request }) {
  const db = env?.BIBLE_PROGRESS;
  if (!db) {
    return new Response(JSON.stringify({ message: 'Database binding missing' }), {
      status: 500,
      headers: DEFAULT_HEADERS,
    });
  }

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
  const db = env?.BIBLE_PROGRESS;
  if (!db) {
    return new Response(JSON.stringify({ message: 'Database binding missing' }), {
      status: 500,
      headers: DEFAULT_HEADERS,
    });
  }

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
