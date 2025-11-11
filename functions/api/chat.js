const HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "Connection": "keep-alive",
  "Access-Control-Allow-Origin": "*",
};

const SYSTEM_PROMPT =
  "You are a warm, biblical, Christ-centered assistant for Grounded Through Faith. " +
  "Offer Scripture when helpful, be concise and pastoral, and avoid denominational arguments.";

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!env.OPENAI_API_KEY) {
      return new Response(
        `data: ${JSON.stringify({ type: "error", message: "Missing OpenAI credentials." })}\n\n`,
        {
          status: 500,
          headers: HEADERS,
        },
      );
    }

    const { messages = [] } = await request.json().catch(() => ({ messages: [] }));

    const payload = {
      model: "gpt-4.1",
      input: [
        {
          role: "system",
          content: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
            },
          ],
        },
        ...messages.map((message) => ({
          role: message.role,
          content: [
            {
              type: "text",
              text: message.content,
            },
          ],
        })),
      ],
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
      const errorMessage = await upstream.text();
      return new Response(
        `data: ${JSON.stringify({ type: "error", message: errorMessage || "Assistant upstream error." })}\n\n`,
        {
          status: 500,
          headers: HEADERS,
        },
      );
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const reader = upstream.body.getReader();
        let buffer = "";

        const send = (payload) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };

        const flushBuffer = (isFinal = false) => {
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            handleEvent(rawEvent, send);
            boundary = buffer.indexOf("\n\n");
          }

          if (isFinal && buffer.trim()) {
            handleEvent(buffer, send);
            buffer = "";
          }
        };

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              buffer += decoder.decode();
              flushBuffer(true);
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            flushBuffer(false);
          }
        } catch (error) {
          send({ type: "error", message: error.message || "Assistant stream error." });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: HEADERS,
    });
  } catch (error) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: error.message || "Assistant error." })}\n\n`,
      {
        status: 500,
        headers: HEADERS,
      },
    );
  }
}

function handleEvent(rawEvent, send) {
  if (!rawEvent) return;

  const lines = rawEvent.split("\n");
  let eventType = "message";
  const dataLines = [];

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  const dataText = dataLines.join("\n");
  if (!dataText) return;

  if (eventType === "message") {
    try {
      const payload = JSON.parse(dataText);
      if (payload.type === "text" && payload.delta) {
        send({ type: "text", delta: payload.delta });
      } else if (payload.type === "done") {
        send({ type: "done" });
      } else if (payload.type === "error") {
        send({ type: "error", message: payload.message || "Assistant stream error." });
      }
    } catch (error) {
      // Ignore malformed message events
    }
    return;
  }

  try {
    const payload = JSON.parse(dataText);

    if (eventType === "response.output_text.delta" || eventType === "response.refusal.delta") {
      const delta = payload.delta || payload.text || "";
      if (delta) {
        send({ type: "text", delta });
      }
    } else if (eventType === "response.completed") {
      send({ type: "done" });
    } else if (eventType === "response.error") {
      const message =
        (payload.error && payload.error.message) ||
        payload.message ||
        "Assistant upstream error.";
      send({ type: "error", message });
    }
  } catch (error) {
    // Ignore events we cannot parse
  }
}
