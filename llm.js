// llm.js — thin client for the two supported model providers.
// The end user's API key lives only in their browser and is sent directly to
// the provider's API from here. No key ever passes through a server of ours.

export const PROVIDERS = {
  anthropic: {
    label: "Anthropic (Claude)",
    defaultModel: "claude-opus-4-8",
    keyHint: "Get a key at console.anthropic.com. Starts with sk-ant-.",
    modelHint: "e.g. claude-opus-4-8, claude-sonnet-4-6, claude-haiku-4-5",
  },
  openai: {
    label: "OpenAI (GPT)",
    defaultModel: "gpt-4o",
    keyHint: "Get a key at platform.openai.com. Starts with sk-.",
    modelHint: "e.g. gpt-4o, gpt-4o-mini, gpt-4.1",
  },
};

/**
 * Send a chat-style request and get back the assistant's text.
 * @param {object} cfg  { provider, apiKey, model }
 * @param {string} system  system prompt
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} [opts]  { maxTokens, json }
 * @returns {Promise<string>}
 */
export async function chat(cfg, system, messages, opts = {}) {
  const maxTokens = opts.maxTokens || 1024;
  if (cfg.provider === "anthropic") {
    return chatAnthropic(cfg, system, messages, maxTokens);
  }
  return chatOpenAI(cfg, system, messages, maxTokens, opts.json);
}

async function chatAnthropic(cfg, system, messages, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      // Required to call the Anthropic API directly from a browser.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      // Adaptive thinking: let Claude decide how much to reason per question.
      thinking: { type: "adaptive" },
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) throw await errorFrom(res, "anthropic");
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === "text");
  const text = block ? block.text : "";
  if (!text) throw new Error("The model returned an empty response. Try again.");
  return text.trim();
}

async function chatOpenAI(cfg, system, messages, maxTokens, json) {
  const body = {
    model: cfg.model,
    max_tokens: maxTokens,
    messages: [{ role: "system", content: system }, ...messages],
  };
  if (json) body.response_format = { type: "json_object" };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw await errorFrom(res, "openai");
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("The model returned an empty response. Try again.");
  return text.trim();
}

async function errorFrom(res, provider) {
  let detail = "";
  try {
    const body = await res.json();
    detail = body?.error?.message || body?.error?.type || "";
  } catch {
    /* non-JSON error body */
  }
  if (res.status === 401) {
    return new Error(
      `Authentication failed (401). Check your ${PROVIDERS[provider].label} key in Settings.`
    );
  }
  if (res.status === 429) {
    return new Error("Rate limited (429). Wait a moment and try again.");
  }
  if (res.status === 404) {
    return new Error(`Model not found (404). ${detail || "Check the model name in Settings."}`);
  }
  return new Error(`Request failed (${res.status}). ${detail}`.trim());
}

/**
 * Extract the first JSON object from a model response, tolerating prose or
 * code fences around it.
 */
export function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Could not parse the feedback. Try again.");
  return JSON.parse(raw.slice(start, end + 1));
}
