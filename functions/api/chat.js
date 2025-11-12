diff --git a/functions/api/chat.js b/functions/api/chat.js
new file mode 100644
index 0000000000000000000000000000000000000000..f82ed6a70ee96a3762f6a841341a2406236a8b35
--- /dev/null
+++ b/functions/api/chat.js
@@ -0,0 +1,90 @@
+const HEADERS = {
+  "Content-Type": "text/event-stream; charset=utf-8",
+  "Cache-Control": "no-cache, no-transform",
+  "Connection": "keep-alive",
+  "Access-Control-Allow-Origin": "*",
+};
+
+const SYSTEM_PROMPT =
+  "You are the Grounded Through Faith Assistant. Format ALL responses as clean Markdown.\n" +
+  "- Title: H1 or H2, then a one-sentence aim.\n" +
+  "- Use H2 for weeks/sections, H3 for Scripture / Catechism / Application.\n" +
+  "- Bold verse references (e.g., **Ephesians 5:25**), keep the verse in quotes.\n" +
+  "- Use short bullet points; avoid long paragraphs.\n" +
+  "- Insert horizontal rules (`---`) between weeks.\n" +
+  "- End with a short encouragement and a one-line prayer.\n" +
+  "Keep tone pastoral, Christ-centered, and concise; no preface like ‘Here is’.";
+export async function onRequestOptions() {
+  return new Response(null, {
+    headers: {
+      "Access-Control-Allow-Origin": "*",
+      "Access-Control-Allow-Methods": "POST, OPTIONS",
+      "Access-Control-Allow-Headers": "Content-Type",
+    },
+  });
+}
+
+export async function onRequestPost({ request, env }) {
+  try {
+    if (!env.OPENAI_API_KEY) {
+      const body =
+        `event: response.error\n` +
+        `data: ${JSON.stringify({ message: "Missing OpenAI credentials." })}\n\n` +
+        `event: response.completed\n` +
+        `data: {}\n\n`;
+      return new Response(body, { status: 500, headers: HEADERS });
+    }
+
+    const { messages = [] } = await request.json().catch(() => ({ messages: [] }));
+
+    const history = [
+      {
+        role: "system",
+        content: [{ type: "input_text", text: SYSTEM_PROMPT }],
+      },
+      ...messages.map((message) => ({
+        role: message.role,
+        content: [
+          {
+            type: message.role === "assistant" ? "output_text" : "input_text",
+            text: message.content ?? "",
+          },
+        ],
+      })),
+    ];
+
+    const payload = {
+      model: "gpt-4o-mini",
+      input: history,
+      stream: true,
+    };
+
+    const upstream = await fetch("https://api.openai.com/v1/responses", {
+      method: "POST",
+      headers: {
+        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
+        "Content-Type": "application/json",
+      },
+      body: JSON.stringify(payload),
+    });
+
+    if (!upstream.ok || !upstream.body) {
+      const text = await upstream.text().catch(() => "Upstream error");
+      const body =
+        `event: response.error\n` +
+        `data: ${JSON.stringify({ message: text })}\n\n` +
+        `event: response.completed\n` +
+        `data: {}\n\n`;
+      return new Response(body, { status: 500, headers: HEADERS });
+    }
+
+    return new Response(upstream.body, { status: 200, headers: HEADERS });
+  } catch (error) {
+    const body =
+      `event: response.error\n` +
+      `data: ${JSON.stringify({ message: error.message || "Server error" })}\n\n` +
+      `event: response.completed\n` +
+      `data: {}\n\n`;
+    return new Response(body, { status: 500, headers: HEADERS });
+  }
+}
