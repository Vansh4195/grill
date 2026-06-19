// tests/e2e.mjs — free, real end-to-end check against Google Gemini.
//
// Grill talks to model providers using the OpenAI chat-completions request
// shape (see chatOpenAI in ../llm.js). Google exposes an OpenAI-compatible
// endpoint, so we can exercise that exact request/parse path against a real
// model for free on the Gemini free tier.
//
// Run:  GEMINI_API_KEY=... node tests/e2e.mjs
// Get a free key at https://aistudio.google.com/apikey
//
// Skips (exit 0) if GEMINI_API_KEY is unset, so CI stays green without secrets.

const KEY = process.env.GEMINI_API_KEY;

if (!KEY) {
  console.log("SKIP: GEMINI_API_KEY is not set.");
  console.log("Get a free key at https://aistudio.google.com/apikey, then:");
  console.log("  GEMINI_API_KEY=your_key node tests/e2e.mjs");
  process.exit(0);
}

// Same base URL + model the in-app "Gemini (free)" provider uses.
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const MODEL = "gemini-2.0-flash";

function fail(reason) {
  console.log(`FAIL: ${reason}`);
  process.exit(1);
}

try {
  // Mirror the body shape Grill sends in chatOpenAI(): model + max_tokens +
  // messages. Kept to a single tiny request so it costs ~nothing.
  const body = {
    model: MODEL,
    max_tokens: 20,
    messages: [{ role: "user", content: "Reply with the single word: OK" }],
  };

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const errBody = await res.json();
      detail = errBody?.error?.message || errBody?.error?.type || "";
    } catch {
      /* non-JSON error body */
    }
    fail(`HTTP ${res.status}. ${detail}`.trim());
  }

  const data = await res.json();

  // Same parse path the app uses: data.choices[0].message.content
  const text = data.choices?.[0]?.message?.content?.trim() || "";
  if (!text) fail("Response parsed but contained no assistant text.");

  console.log(`Model replied: ${JSON.stringify(text)}`);
  console.log("PASS");
  process.exit(0);
} catch (err) {
  fail(err && err.message ? err.message : String(err));
}
