const HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "Connection": "keep-alive",
  "Access-Control-Allow-Origin": "*",
};

const SYSTEM_PROMPT = [
  "You are Faith Formation AI for Grounded Through Faith.",
  "Stay pastoral, Christ-centered, and concise while using simple Markdown (headings, short bullets, and brief paragraphs).",
  "Respond conversationally like ChatGPT and continue the thread in the same manner.",
  "Use the running conversation for context--do not reset unless the user asks. Clarify gently if details are missing.",
  "For straightforward questions, respond briefly with at most one Scripture reference in parentheses and end with the italic invitation: _Would you like a short study plan to go deeper?_, without adding a closing prayer.",
  "Only build multi-day devotionals or study plans when the user clearly requests one; use headings like 'Day 1:', 'Day 2:' on their own lines with blank lines between days so each day is distinct, and add a short Closing Prayer after the final day that is clearly separated from the day sections.",
  "Avoid raw HTML, avoid denominational debates, and keep the tone hopeful and rooted in Christ."
].join("\n");

function resolveDb(env) {
  const direct = env?.BIBLE_PROGRESS || env?.DB || env?.__D1_BETA__ || env?.__D1__;
  if (direct) return direct;

  for (const value of Object.values(env || {})) {
    if (value && typeof value.prepare === "function") {
      return value;
    }
  }

  return null;
}

async function ensureSchema(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ChatConversations (
        ConversationId TEXT PRIMARY KEY,
        CreatedAt TEXT NOT NULL,
        UpdatedAt TEXT NOT NULL
      );`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ChatMessages (
        Id INTEGER PRIMARY KEY AUTOINCREMENT,
        ConversationId TEXT NOT NULL,
        MessageIndex INTEGER NOT NULL,
        Role TEXT NOT NULL,
        Content TEXT NOT NULL,
        CreatedAt TEXT NOT NULL
      );`
    )
    .run();

  await db
    .prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS IX_ChatMessages_ConversationIndex
       ON ChatMessages(ConversationId, MessageIndex);`
    )
    .run();
}

async function upsertConversation(db, conversationId) {
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO ChatConversations (ConversationId, CreatedAt, UpdatedAt)
       VALUES (?, ?, ?)
       ON CONFLICT(ConversationId) DO UPDATE SET UpdatedAt = excluded.UpdatedAt`
    )
    .bind(conversationId, timestamp, timestamp)
    .run();
}

async function loadConversationMessages(db, conversationId) {
  const result = await db
    .prepare(
      `SELECT Role, Content
       FROM ChatMessages
       WHERE ConversationId = ?
       ORDER BY MessageIndex ASC`
    )
    .bind(conversationId)
    .all();

  const rows = Array.isArray(result?.results) ? result.results : [];
  return rows.map((row) => ({ role: row.Role, content: row.Content }));
}

async function loadMessageCount(db, conversationId) {
  const row = await db
    .prepare("SELECT COUNT(*) as Count FROM ChatMessages WHERE ConversationId = ?")
    .bind(conversationId)
    .first();
  return Number(row?.Count || 0);
}

async function storeMessages(db, conversationId, messages, startIndex) {
  const now = new Date().toISOString();
  for (let i = startIndex; i < messages.length; i += 1) {
    const message = messages[i];
    if (!message || !message.role || typeof message.content !== "string") continue;
    await db
      .prepare(
        `INSERT INTO ChatMessages (ConversationId, MessageIndex, Role, Content, CreatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(ConversationId, MessageIndex) DO NOTHING`
      )
      .bind(conversationId, i, message.role, message.content, now)
      .run();
  }
}
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.OPENAI_API_KEY) {
      const body =
        `data: ${JSON.stringify({ error: "Missing OpenAI credentials." })}\n\n` +
        `data: [DONE]\n\n`;
      return new Response(body, { status: 500, headers: HEADERS });
    }

    const { messages = [], conversationId } = await request.json().catch(() => ({ messages: [] }));

    if (!conversationId || typeof conversationId !== "string") {
      const body =
        `data: ${JSON.stringify({ error: "Conversation id required." })}\n\n` +
        `data: [DONE]\n\n`;
      return new Response(body, { status: 400, headers: HEADERS });
    }

    const incoming = Array.isArray(messages) ? messages : [];
    const db = resolveDb(env);
    let historyMessages = incoming;

    if (db) {
      await ensureSchema(db);
      await upsertConversation(db, conversationId);
      const messageCount = await loadMessageCount(db, conversationId);
      if (incoming.length > 0 && messageCount < incoming.length) {
        await storeMessages(db, conversationId, incoming, messageCount);
      }
      if (incoming.length === 0) {
        historyMessages = await loadConversationMessages(db, conversationId);
      }
    }

    const history = [
      {
        role: "system",
        content: [{ type: "input_text", text: SYSTEM_PROMPT }],
      },
      ...historyMessages.map((message) => ({
        role: message.role,
        content: [
          {
            type: message.role === "assistant" ? "output_text" : "input_text",
            text: message.content ?? "",
          },
        ],
      })),
    ];

    const payload = {
      model: "gpt-4o-mini",
      input: history,
      stream: true,
    };

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "Upstream error");
      const body =
        `data: ${JSON.stringify({ error: text })}\n\n` +
        `data: [DONE]\n\n`;
      return new Response(body, { status: 500, headers: HEADERS });
    }

    const upstreamReader = upstream.body.getReader();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const decoder = new TextDecoder("utf-8");
    const encoder = new TextEncoder();
    let buffer = "";
    let assistantText = "";

    const writeSse = async (data) => {
      await writer.write(encoder.encode(`data: ${data}\n\n`));
    };

    const processStream = async () => {
      try {
        let done = false;
        while (!done) {
          const { value, done: streamDone } = await upstreamReader.read();
          done = streamDone;

          if (value) {
            buffer += decoder.decode(value, { stream: !done });
          }

          if (done) {
            buffer += decoder.decode();
          }

          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);

            let eventName = null;
            const dataLines = [];

            rawEvent.split("\n").forEach((line) => {
              const trimmed = line.trim();
              if (!trimmed) return;
              if (trimmed.startsWith("event:")) {
                eventName = trimmed.slice(6).trim();
              } else if (trimmed.startsWith("data:")) {
                dataLines.push(trimmed.slice(5).trim());
              }
            });

            if (!dataLines.length) {
              boundary = buffer.indexOf("\n\n");
              continue;
            }

            const payloadRaw = dataLines.join("");
            let payload;
            try {
              payload = JSON.parse(payloadRaw);
            } catch (error) {
              payload = payloadRaw;
            }

            if (eventName === "response.output_text.delta") {
              const delta = typeof payload === "string" ? payload : payload?.delta || "";
              if (delta) {
                assistantText += delta;
                await writeSse(JSON.stringify({ delta }));
              }
            } else if (eventName === "response.error") {
              const message = typeof payload === "string" ? payload : payload?.message || "Upstream error";
              await writeSse(JSON.stringify({ error: message }));
              done = true;
              break;
            } else if (eventName === "response.completed") {
              done = true;
              break;
            }

            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch (error) {
        console.error("Chat stream error:", error);
        try {
          await writeSse(JSON.stringify({ error: "Stream error" }));
        } catch (streamError) {
          console.error("Chat stream write failed:", streamError);
        }
      } finally {
        try {
          if (db && assistantText.trim()) {
            await storeMessages(
              db,
              conversationId,
              [...historyMessages, { role: "assistant", content: assistantText.trim() }],
              historyMessages.length
            );
            await upsertConversation(db, conversationId);
          }
        } catch (error) {
          console.warn("Chat message persistence failed:", error);
        }
        try {
          await writeSse("[DONE]");
        } catch (error) {
          console.error("Chat stream completion write failed:", error);
        }
        await writer.close();
      }
    };

    processStream();

    return new Response(stream.readable, { status: 200, headers: HEADERS });
  } catch (error) {
    const body =
      `data: ${JSON.stringify({ error: error.message || "Server error" })}\n\n` +
      `data: [DONE]\n\n`;
    return new Response(body, { status: 500, headers: HEADERS });
  }
}
