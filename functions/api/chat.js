const HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "Connection": "keep-alive",
  "Access-Control-Allow-Origin": "*",
};

const SYSTEM_PROMPT =
  "You are the Grounded Through Faith Assistant. Respond with a warm, biblical tone and clean Markdown.\n" +
  "When the request is a simple question, answer directly with short paragraphs or bullet points and include at most one Scripture reference in bold.\n" +
  "After those concise answers, end with the italic question: _Would you like a short study plan to go deeper?_\n" +
  "Only create multi-day devotionals or study plans when the user clearly asks for one.\n" +
  "When crafting a plan, use headings (##) for weeks or major movements, bullets for actions, `---` between major sections, and finish with a brief encouragement plus a single-sentence prayer.\n" +
  "Avoid raw HTML tags—rely on Markdown for emphasis and quotes, remain Christ-centered, and stay concise.";
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

    const history = [
      {
        role: "system",
        content: [{ type: "input_text", text: SYSTEM_PROMPT }],
      },
      ...messages.map((message) => ({
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
        `event: response.error\n` +
        `data: ${JSON.stringify({ message: text })}\n\n` +
        `event: response.completed\n` +
        `data: {}\n\n`;
      return new Response(body, { status: 500, headers: HEADERS });
    }

    return new Response(upstream.body, { status: 200, headers: HEADERS });
  } catch (error) {
    const body =
      `event: response.error\n` +
      `data: ${JSON.stringify({ message: error.message || "Server error" })}\n\n` +
      `event: response.completed\n` +
      `data: {}\n\n`;
    return new Response(body, { status: 500, headers: HEADERS });
  }
}
