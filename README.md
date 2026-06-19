# Grill

A voice-based AI mock interviewer that runs entirely in your browser. Pick a
role and difficulty, and an AI interviewer asks you questions **out loud**. You
answer with **your voice**; it follows up, and at the end it gives you a scored
rubric with concrete feedback.

**Live:** https://vansh4195.github.io/grill/

There is no backend. The page talks directly to your chosen model provider
(Anthropic, OpenAI, or Gemini) using a key you paste in — the key is stored only
in your browser and is sent only to the provider's API.

---

## What it does

- **Speaks the questions.** Uses the browser's `SpeechSynthesis` API so the
  interviewer's questions are read aloud. Pick any English voice your browser
  exposes, or use the default.
- **Listens to your answers.** Uses `SpeechRecognition` to transcribe what you
  say in real time. Hold the mic button to talk; release to stop. There's a
  typed fallback for browsers without speech-to-text.
- **Conducts a real interview.** The model asks one question at a time, gives a
  brief acknowledgement, and drills in with natural follow-ups — tuned by the
  role, focus area, and difficulty you chose.
- **Scores you at the end.** A rubric (communication, technical depth,
  structure, specificity), an overall score, and specific strengths and
  fixes — grounded in what you actually said.
- **Remembers your sessions.** Past interviews and scorecards are saved to
  `localStorage` so you can review them later.

## Run it locally

It's a static site — no build step, no dependencies. But it uses ES modules, so
you need to serve it over HTTP (opening `index.html` from `file://` won't load
the modules).

```bash
git clone https://github.com/Vansh4195/grill.git
cd grill
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works (`npx serve`, `php -S localhost:8000`, etc.).

## Bring your own key

On first load, Grill asks for an API key. You can use either provider:

- **Anthropic (Claude)** — get a key at
  [console.anthropic.com](https://console.anthropic.com). Default model
  `claude-opus-4-8`. The browser request includes the
  `anthropic-dangerous-direct-browser-access` header, which is what lets the
  Anthropic API be called from client-side JavaScript.
- **OpenAI (GPT)** — get a key at
  [platform.openai.com](https://platform.openai.com). Default model `gpt-4o`.
- **Gemini (free)** — get a free key at
  [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Default model
  `gemini-2.0-flash`. This uses Google's OpenAI-compatible endpoint
  (`generativelanguage.googleapis.com/.../openai`), which sends the exact same
  request shape as OpenAI. It works directly from the browser — Google's endpoint
  returns CORS headers for this origin — and is the cheapest way to try Grill
  (the Gemini free tier costs nothing for this usage).

Open **Settings** any time to switch providers, change the model, or forget the
key.

## Test for free with Gemini

You can prove the model request/parse path works for free, without a browser,
using a Google Gemini key:

1. Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Run the end-to-end test:

   ```bash
   GEMINI_API_KEY=your_key node tests/e2e.mjs
   # or, with the npm script:
   GEMINI_API_KEY=your_key npm run test:e2e
   ```

The test makes one tiny real call (`max_tokens: 20`) through the same
OpenAI-compatible request shape the app uses, pointed at Gemini's
`gemini-2.0-flash`, and prints `PASS` (or `FAIL: <reason>` and exits non-zero).
If `GEMINI_API_KEY` is unset it prints `SKIP` and exits 0, so it's safe to wire
into CI without a secret.

Because this is a Node script there's no browser and therefore no CORS concern —
it's the most reliable free path. The in-app **Gemini (free)** provider uses the
same endpoint and model and also works from the browser.

### About your key

- It is saved only in this browser's `localStorage`.
- It is sent only to the provider's own API endpoint
  (`api.anthropic.com` / `api.openai.com` /
  `generativelanguage.googleapis.com`), directly from your browser.
- It never passes through any server belonging to this project — there is no
  such server.

Because the key is exposed to the page, use a key you're comfortable using
client-side, and remove it (Settings → "Forget key") when you're done on a
shared machine.

## Browser support

Voice works best in **Google Chrome** (and Chromium-based browsers like Edge),
which have the most complete Web Speech API implementation.

| Browser            | Questions spoken | Voice answers       |
| ------------------ | ---------------- | ------------------- |
| Chrome / Edge      | Yes              | Yes                 |
| Safari             | Yes              | Partial / variable  |
| Firefox            | Yes              | Typed fallback      |

If speech-to-text isn't available, Grill detects it and lets you type your
answers instead — the questions are still spoken aloud.

## How it's built

Vanilla JavaScript, no framework, no bundler:

- `index.html` / `styles.css` — UI (setup, interview, scorecard, settings,
  history).
- `app.js` — the controller: view state, interview loop, recording controls.
- `llm.js` — the provider client (Anthropic + OpenAI + Gemini) and JSON parsing.
- `speech.js` — Web Speech API wrappers (synthesis, recognition, voice list).
- `prompts.js` — the interviewer persona and the grading rubric instructions.

The interview is a normal multi-turn chat: each of your answers is appended to
the conversation and sent back, so the interviewer's follow-ups are grounded in
what you've said so far. The final scorecard is a separate request that asks the
model to return strict JSON, which is then rendered into the rubric.

## License

MIT — see [LICENSE](LICENSE).
