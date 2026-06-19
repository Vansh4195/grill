// speech.js — wrappers around the browser Web Speech API.
// SpeechSynthesis speaks the interviewer's questions; SpeechRecognition
// captures the candidate's spoken answer. Both degrade gracefully.

const SR =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

export const support = {
  synthesis: typeof window !== "undefined" && "speechSynthesis" in window,
  recognition: !!SR,
};

export function recognitionSupported() {
  return support.recognition;
}

/* ---------- Text to speech ---------- */

let voicesCache = [];

export function loadVoices() {
  return new Promise((resolve) => {
    if (!support.synthesis) return resolve([]);
    const grab = () => {
      voicesCache = window.speechSynthesis.getVoices();
      if (voicesCache.length) resolve(voicesCache);
    };
    grab();
    if (!voicesCache.length) {
      window.speechSynthesis.onvoiceschanged = grab;
      // Safety net: some browsers never fire the event.
      setTimeout(grab, 400);
      setTimeout(() => resolve(voicesCache), 1200);
    }
  });
}

export function getVoices() {
  return voicesCache;
}

/**
 * Speak text aloud. Resolves when speech finishes (or immediately if
 * synthesis is unavailable).
 * @param {string} text
 * @param {string} [voiceURI]
 */
export function speak(text, voiceURI) {
  return new Promise((resolve) => {
    if (!support.synthesis || !text) return resolve();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    u.pitch = 1.0;
    if (voiceURI) {
      const v = voicesCache.find((x) => x.voiceURI === voiceURI);
      if (v) u.voice = v;
    }
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (support.synthesis) window.speechSynthesis.cancel();
}

/* ---------- Speech recognition ---------- */

/**
 * Creates a recognizer with start/stop controls.
 * Callbacks:
 *   onPartial(text)  — interim + final transcript so far this session
 *   onError(message) — recoverable error string
 *   onEnd()          — recognition stopped
 */
export function createRecognizer({ onPartial, onError, onEnd }) {
  if (!SR) return null;

  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";

  let finalText = "";
  let active = false;

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const chunk = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += chunk + " ";
      else interim += chunk;
    }
    onPartial((finalText + interim).trim());
  };

  rec.onerror = (e) => {
    // "no-speech" / "aborted" are routine when the user pauses or stops.
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      onError("Microphone access was denied. Allow it, or type your answer.");
    } else if (e.error === "no-speech") {
      onError("I didn't catch that — try again or type your answer.");
    } else if (e.error !== "aborted") {
      onError(`Speech recognition error: ${e.error}.`);
    }
  };

  rec.onend = () => {
    active = false;
    onEnd();
  };

  return {
    start() {
      if (active) return;
      finalText = "";
      try {
        rec.start();
        active = true;
      } catch {
        /* start() throws if called while already starting — ignore */
      }
    },
    stop() {
      if (active) rec.stop();
    },
    isActive() {
      return active;
    },
  };
}
