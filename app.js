// app.js — main controller. Wires UI, speech, and the LLM together.

import { PROVIDERS, chat, parseJson } from "./llm.js";
import * as speech from "./speech.js";
import { ROLES, interviewerSystem, feedbackSystem } from "./prompts.js";

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = "grill.settings";
const SESSIONS_KEY = "grill.sessions";

/* ---------- App state ---------- */

const state = {
  view: "setup",
  settings: loadSettings(),
  // active interview
  config: null, // { role, difficulty, total, voiceURI }
  messages: [], // LLM conversation: {role, content}
  asked: 0, // questions asked so far
  recognizer: null,
  recording: false,
  busy: false,
  lastQuestion: "",
  finished: false,
};

/* ---------- Settings persistence ---------- */

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      provider: s.provider || "anthropic",
      apiKey: s.apiKey || "",
      model: s.model || PROVIDERS[s.provider || "anthropic"].defaultModel,
    };
  } catch {
    return { provider: "anthropic", apiKey: "", model: PROVIDERS.anthropic.defaultModel };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function hasKey() {
  return !!state.settings.apiKey;
}

function llmConfig() {
  return {
    provider: state.settings.provider,
    apiKey: state.settings.apiKey,
    model: state.settings.model || PROVIDERS[state.settings.provider].defaultModel,
  };
}

/* ---------- Sessions (history) ---------- */

function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveSession(session) {
  const all = loadSessions();
  all.unshift(session);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(all.slice(0, 30)));
}

function deleteSession(id) {
  const all = loadSessions().filter((s) => s.id !== id);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(all));
}

/* ---------- View switching ---------- */

function show(view) {
  state.view = view;
  for (const v of ["setup", "interview", "feedback"]) {
    $(`${v}View`).hidden = v !== view;
  }
}

/* ---------- Setup view ---------- */

function initSetup() {
  const sel = $("roleSelect");
  sel.innerHTML = "";
  for (const r of ROLES) {
    const o = document.createElement("option");
    o.value = r;
    o.textContent = r;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => {
    $("customRoleField").hidden = sel.value !== "Custom…";
  });

  // Difficulty segmented control
  const seg = $("difficultySelect");
  seg.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", "false"));
    btn.setAttribute("aria-checked", "true");
  });

  $("startBtn").addEventListener("click", startInterview);

  // Speech support note
  const note = $("setupNote");
  if (!speech.recognitionSupported()) {
    note.textContent = speech.support.synthesis
      ? "Voice input isn't supported in this browser — you can type your answers. Questions will still be spoken aloud. Chrome works best."
      : "This browser has limited Web Speech support — you can type answers. Chrome works best.";
  }
}

function selectedDifficulty() {
  const btn = $("difficultySelect").querySelector('[aria-checked="true"]');
  return btn ? btn.dataset.value : "medium";
}

async function populateVoices() {
  await speech.loadVoices();
  const sel = $("voiceSelect");
  const voices = speech.getVoices().filter((v) => v.lang && v.lang.startsWith("en"));
  for (const v of voices) {
    const o = document.createElement("option");
    o.value = v.voiceURI;
    o.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(o);
  }
}

/* ---------- Start the interview ---------- */

async function startInterview() {
  if (!hasKey()) {
    openSettings("Add an API key to start. Your key stays in this browser.");
    return;
  }

  const roleRaw = $("roleSelect").value;
  const role =
    roleRaw === "Custom…" ? ($("customRole").value.trim() || "General interview") : roleRaw;

  state.config = {
    role,
    difficulty: selectedDifficulty(),
    total: parseInt($("lengthSelect").value, 10),
    voiceURI: $("voiceSelect").value,
  };
  state.messages = [];
  state.asked = 0;
  state.finished = false;
  state.lastQuestion = "";

  $("roleChip").textContent = role;
  $("difficultyChip").textContent = { easy: "Warm-up", medium: "Standard", hard: "Hard" }[
    state.config.difficulty
  ];
  $("transcript").innerHTML = "";
  $("answerInput").value = "";

  setupRecognizer();
  show("interview");
  updateProgress();
  await askNext("Hello — let's begin.");
}

function updateProgress() {
  $("progressLabel").textContent = `Question ${Math.min(state.asked, state.config.total)} of ${state.config.total}`;
}

/* ---------- Conversation turns ---------- */

async function askNext(seedUser) {
  setBusy(true);
  setStatus("thinking", "Thinking…");
  const thinkingEl = addBubble("q", "", true);

  state.messages.push({ role: "user", content: seedUser });

  let question;
  try {
    question = await chat(
      llmConfig(),
      interviewerSystem(state.config),
      state.messages,
      { maxTokens: 600 }
    );
  } catch (err) {
    thinkingEl.remove();
    return failTurn(err.message);
  }

  state.messages.push({ role: "assistant", content: question });
  state.asked += 1;
  state.lastQuestion = question;

  thinkingEl.classList.remove("thinking");
  thinkingEl.querySelector(".text").textContent = question;
  updateProgress();

  // Detect the model's wrap-up line.
  const isClosing = /that's all my questions/i.test(question) || state.asked > state.config.total;

  setBusy(false);
  setStatus("speaking", "Speaking…");
  await speech.speak(question, state.config.voiceURI);

  if (isClosing) {
    state.finished = true;
    setStatus("ready", "Generating your feedback…");
    await generateFeedback();
    return;
  }

  setStatus("ready", "Your turn — hold to talk, or type.");
  $("answerInput").focus();
}

async function submitAnswer() {
  const answer = $("answerInput").value.trim();
  if (!answer || state.busy) return;
  if (state.recording) stopRecording();

  addBubble("a", answer);
  $("answerInput").value = "";
  $("submitBtn").disabled = true;

  await askNext(answer);
}

function failTurn(msg) {
  setBusy(false);
  setStatus("ready", "Ready");
  const note = $("interviewNote");
  note.textContent = msg;
  note.classList.add("error");
  // Roll back the unanswered user seed so a retry doesn't double-send.
  if (state.messages.length && state.messages[state.messages.length - 1].role === "user") {
    state.messages.pop();
  }
}

/* ---------- Feedback ---------- */

async function generateFeedback() {
  setBusy(true);
  let result;
  try {
    const raw = await chat(
      llmConfig(),
      feedbackSystem(state.config),
      [...state.messages, { role: "user", content: "Now produce my scorecard as the JSON object." }],
      { maxTokens: 1500, json: true }
    );
    result = parseJson(raw);
  } catch (err) {
    setBusy(false);
    state.finished = false; // let the user retry via End button
    show("interview");
    failTurn(`Couldn't build feedback: ${err.message} Tap "End & get feedback" to retry.`);
    return;
  }

  renderFeedback(result);
  saveSession({
    id: Date.now().toString(36),
    date: new Date().toISOString(),
    role: state.config.role,
    difficulty: state.config.difficulty,
    overall: result.overall,
    result,
    transcript: state.messages.slice(),
  });
  setBusy(false);
  show("feedback");
}

function renderFeedback(r) {
  const score = clamp(r.overall, 0, 100);
  $("scoreSummary").innerHTML = `
    <span class="score-big">${score}</span>
    <span class="score-out">/ 100</span>
    <span class="score-verdict">${escapeHtml(r.verdict || "")}</span>`;

  $("rubric").innerHTML = (r.rubric || [])
    .map((item) => {
      const s = clamp(item.score, 0, 10);
      return `<div class="rubric-item">
        <div class="rubric-top">
          <span class="r-name">${escapeHtml(item.name)}</span>
          <span class="r-score">${s}/10</span>
        </div>
        <div class="bar"><span style="width:${s * 10}%"></span></div>
        <div class="r-note">${escapeHtml(item.note || "")}</div>
      </div>`;
    })
    .join("");

  const list = (arr) => (arr || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
  $("feedbackBody").innerHTML = `
    <h4>What went well</h4>
    <ul>${list(r.strengths)}</ul>
    <h4>What to work on</h4>
    <ul>${list(r.improvements)}</ul>`;
}

/* ---------- Recording controls ---------- */

function setupRecognizer() {
  if (!speech.recognitionSupported()) return;
  state.recognizer = speech.createRecognizer({
    onPartial: (text) => {
      $("answerInput").value = text;
      $("submitBtn").disabled = !text.trim();
    },
    onError: (msg) => {
      const note = $("interviewNote");
      note.textContent = msg;
      note.classList.add("error");
      stopRecording();
    },
    onEnd: () => {
      if (state.recording) stopRecording();
    },
  });
}

function startRecording() {
  if (!state.recognizer || state.busy || state.recording || state.finished) return;
  speech.stopSpeaking();
  clearNote();
  state.recording = true;
  $("recordBtn").classList.add("recording");
  $("recordLabel").textContent = "Listening…";
  setStatus("listening", "Listening — speak now.");
  state.recognizer.start();
}

function stopRecording() {
  if (!state.recording) return;
  state.recording = false;
  $("recordBtn").classList.remove("recording");
  $("recordLabel").textContent = "Hold to talk";
  if (state.recognizer) state.recognizer.stop();
  if (!state.busy && !state.finished) setStatus("ready", "Review your answer, then submit.");
  $("submitBtn").disabled = !$("answerInput").value.trim();
}

function initRecordButton() {
  const btn = $("recordBtn");
  if (!speech.recognitionSupported()) {
    btn.disabled = true;
    btn.title = "Voice input not supported — type your answer.";
    $("recordLabel").textContent = "Voice not supported — type below";
    return;
  }
  // Press-and-hold (pointer) with a tap-to-toggle fallback.
  let held = false;
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    held = true;
    startRecording();
  });
  const release = () => {
    if (held) {
      held = false;
      stopRecording();
    }
  };
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointerleave", release);
  btn.addEventListener("pointercancel", release);

  // Keyboard accessibility: toggle on Enter/Space.
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      state.recording ? stopRecording() : startRecording();
    }
  });
}

/* ---------- UI helpers ---------- */

function addBubble(kind, text, thinking = false) {
  const el = document.createElement("div");
  el.className = `bubble ${kind}` + (thinking ? " thinking" : "");
  const who = kind === "q" ? "Interviewer" : "You";
  el.innerHTML = `<div class="who">${who}</div><div class="text">${
    thinking ? '<span class="dots"></span>' : escapeHtml(text)
  }</div>`;
  const t = $("transcript");
  t.appendChild(el);
  t.scrollTop = t.scrollHeight;
  return el;
}

function setStatus(cls, text) {
  const dot = $("statusDot");
  dot.className = "status-dot " + cls;
  $("statusText").textContent = text;
}

function setBusy(b) {
  state.busy = b;
  $("submitBtn").disabled = b || !$("answerInput").value.trim();
  $("recordBtn").disabled = b || !speech.recognitionSupported();
}

function clearNote() {
  const n = $("interviewNote");
  n.textContent = "";
  n.classList.remove("error");
}

function clamp(n, lo, hi) {
  n = Number(n);
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ---------- Settings modal ---------- */

function openSettings(note) {
  $("providerSelect").value = state.settings.provider;
  $("apiKeyInput").value = state.settings.apiKey;
  $("modelInput").value = state.settings.model;
  refreshSettingsHints();
  if (note) {
    const el = $("keyHint");
    el.textContent = note;
  }
  $("settingsModal").hidden = false;
}

function refreshSettingsHints() {
  const p = PROVIDERS[$("providerSelect").value];
  $("keyHint").textContent = p.keyHint;
  $("modelHint").textContent = p.modelHint;
}

function initSettings() {
  $("settingsBtn").addEventListener("click", () => openSettings());
  $("providerSelect").addEventListener("change", () => {
    refreshSettingsHints();
    // Offer the provider's default model if the field is empty.
    const p = PROVIDERS[$("providerSelect").value];
    if (!$("modelInput").value.trim()) $("modelInput").value = p.defaultModel;
  });
  $("saveSettingsBtn").addEventListener("click", () => {
    const provider = $("providerSelect").value;
    state.settings = {
      provider,
      apiKey: $("apiKeyInput").value.trim(),
      model: $("modelInput").value.trim() || PROVIDERS[provider].defaultModel,
    };
    saveSettings();
    closeModals();
  });
  $("clearKeyBtn").addEventListener("click", () => {
    state.settings.apiKey = "";
    saveSettings();
    $("apiKeyInput").value = "";
    $("keyHint").textContent = "Key forgotten.";
  });
}

/* ---------- History modal ---------- */

function initHistory() {
  $("historyBtn").addEventListener("click", () => {
    renderHistory();
    $("historyModal").hidden = false;
  });
}

function renderHistory() {
  const list = $("historyList");
  const sessions = loadSessions();
  if (!sessions.length) {
    list.innerHTML = '<p class="history-empty">No sessions yet. Finish an interview to see it here.</p>';
    return;
  }
  list.innerHTML = "";
  for (const s of sessions) {
    const item = document.createElement("div");
    item.className = "history-item";
    const d = new Date(s.date);
    item.innerHTML = `
      <div class="h-main">
        <div class="h-role">${escapeHtml(s.role)}</div>
        <div class="h-meta">${d.toLocaleDateString()} · ${escapeHtml(s.difficulty)}</div>
      </div>
      <span class="h-score">${clamp(s.overall, 0, 100)}</span>
      <button class="history-del" title="Delete" aria-label="Delete session">×</button>`;
    item.querySelector(".h-main").addEventListener("click", () => {
      renderFeedback(s.result);
      state.config = { role: s.role, difficulty: s.difficulty, total: 0 };
      state.messages = s.transcript || [];
      closeModals();
      show("feedback");
    });
    item.querySelector(".h-score").addEventListener("click", () => item.querySelector(".h-main").click());
    item.querySelector(".history-del").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSession(s.id);
      renderHistory();
    });
    list.appendChild(item);
  }
}

function closeModals() {
  $("settingsModal").hidden = true;
  $("historyModal").hidden = true;
}

/* ---------- Review transcript (in feedback view) ---------- */

function renderTranscriptModal() {
  const t = $("transcript");
  t.innerHTML = "";
  for (const m of state.messages) {
    if (m.role === "assistant") addBubble("q", m.content);
    else if (m.role === "user" && m.content !== "Hello — let's begin." && !/scorecard as the JSON/.test(m.content))
      addBubble("a", m.content);
  }
  show("interview");
  setStatus("ready", "Transcript — read-only review.");
  setBusy(true);
}

/* ---------- Wiring ---------- */

function init() {
  initSetup();
  initSettings();
  initHistory();
  initRecordButton();
  populateVoices();

  $("submitBtn").addEventListener("click", submitAnswer);
  $("answerInput").addEventListener("input", () => {
    $("submitBtn").disabled = state.busy || !$("answerInput").value.trim();
  });
  $("replayBtn").addEventListener("click", () => {
    if (state.lastQuestion) {
      setStatus("speaking", "Speaking…");
      speech.speak(state.lastQuestion, state.config?.voiceURI).then(() => {
        if (!state.finished) setStatus("ready", "Your turn — hold to talk, or type.");
      });
    }
  });
  $("endBtn").addEventListener("click", async () => {
    if (state.busy) return;
    speech.stopSpeaking();
    if (state.recording) stopRecording();
    setStatus("thinking", "Wrapping up — generating feedback…");
    state.finished = true;
    await generateFeedback();
  });
  $("newBtn").addEventListener("click", () => {
    speech.stopSpeaking();
    show("setup");
  });
  $("reviewBtn").addEventListener("click", renderTranscriptModal);

  // Modal close handlers
  document.querySelectorAll("[data-close]").forEach((el) =>
    el.addEventListener("click", closeModals)
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModals();
  });

  // Stop any speech if the tab is hidden.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) speech.stopSpeaking();
  });

  show("setup");
  if (!hasKey()) openSettings("Add your API key to begin. It stays in this browser only.");
}

document.addEventListener("DOMContentLoaded", init);
