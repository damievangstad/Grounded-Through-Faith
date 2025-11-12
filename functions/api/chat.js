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

export async function onRequestPost({ request, env }) {
  try {
    if (!env.OPENAI_API_KEY) {
      const body =
        `event: response.error\n` +
        `data: ${JSON.stringify({ message: "Missing OpenAI credentials." })}\n\n` +
        `event: response.completed\n` +
        `data: {}\n\n`;
      return new Response(body, { status: 500, headers: HEADERS });
    }

    const { messages = [] } = await request.json().catch(() => ({ messages: [] }));

    // Map to Responses API parts
    const history = [
      {
        role: "system",
        content: [{ type: "input_text", text: SYSTEM_PROMPT }],
      },
      ...messages.map((m) => ({
        role: m.role,
        content: [
          {
            type: m.role === "assistant" ? "output_text" : "input_text",
            text: m.content ?? "",
          },
        ],
      })),
    ];

    const payload = {
      model: "gpt-4o-mini", // cheaper for testing; swap to gpt-4.1 if you want
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
        `event: response.error\n` +
        `data: ${JSON.stringify({ message: text })}\n\n` +
        `event: response.completed\n` +
        `data: {}\n\n`;
      return new Response(body, { status: 500, headers: HEADERS });
    }

    //  Pass OpenAI's native SSE stream straight through
    return new Response(upstream.body, { status: 200, headers: HEADERS });
  } catch (err) {
    const body =
      `event: response.error\n` +
      `data: ${JSON.stringify({ message: err.message || "Server error" })}\n\n` +
      `event: response.completed\n` +
      `data: {}\n\n`;
    return new Response(body, { status: 500, headers: HEADERS });
  }
}
