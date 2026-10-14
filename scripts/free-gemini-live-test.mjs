// Real end-to-end check of the free call's Gemini path, run in CI with the
// GEMINI_API_KEY secret. Mirrors src/routes/api/free-token.ts and
// src/lib/free/live.ts: mint a locked one-use token, connect with it, ask for a
// greeting, and require spoken audio (24 kHz PCM) plus transcripts to come back.
// The key is never printed.
import { GoogleGenAI, Modality } from "@google/genai";

const key = process.env.GEMINI_API_KEY;
if (!key) { console.error("FAIL: GEMINI_API_KEY is not available to this job."); process.exit(2); }
const MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live";
const voice = process.env.TEST_VOICE || "Kore";

const config = {
  responseModalities: [Modality.AUDIO],
  systemInstruction: "You are LifeMate, a warm video guide. Speak only in English, in one or two short sentences.",
  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  sessionResumption: {},
};

async function mint(apiVersion) {
  const now = Date.now();
  return new GoogleGenAI({ apiKey: key, httpOptions: { apiVersion } }).authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(now + 30 * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      liveConnectConstraints: { model: MODEL, config },
      httpOptions: { apiVersion },
    },
  });
}

let token, usedVersion = "v1beta";
try { token = await mint("v1beta"); }
catch (e) { console.log("token v1beta failed:", String(e.message).slice(0, 200)); usedVersion = "v1alpha"; token = await mint("v1alpha"); }
console.log(`token minted via ${usedVersion}: ${token.name ? "yes" : "NO"}`);
if (!token.name) process.exit(1);

let audioBytes = 0, outText = "", turnComplete = false, opened = false, closeReason = "";
const ai = new GoogleGenAI({ apiKey: token.name, httpOptions: { apiVersion: usedVersion } });
const done = new Promise((resolve) => {
  const timer = setTimeout(resolve, 45_000);
  ai.live.connect({
    model: MODEL,
    config: { responseModalities: [Modality.AUDIO] },
    callbacks: {
      onopen: () => { opened = true; },
      onmessage: (m) => {
        const sc = m.serverContent;
        for (const p of sc?.modelTurn?.parts ?? []) if (p.inlineData?.data) audioBytes += Buffer.from(p.inlineData.data, "base64").length;
        if (sc?.outputTranscription?.text) outText += sc.outputTranscription.text;
        if (sc?.turnComplete) { turnComplete = true; clearTimeout(timer); resolve(); }
      },
      onerror: (e) => { closeReason = "error: " + (e.message || "unknown"); clearTimeout(timer); resolve(); },
      onclose: (e) => { closeReason ||= "closed: " + (e.reason || e.code); clearTimeout(timer); resolve(); },
    },
  }).then((s) => {
    try { s.sendRealtimeInput({ text: "The call has started. Greet the person." }); }
    catch (e) { closeReason = "send failed: " + e.message; resolve(); }
  }).catch((e) => { closeReason = "connect failed: " + String(e.message).slice(0, 300); resolve(); });
});
await done;

const seconds = audioBytes / 2 / 24000;
console.log(JSON.stringify({ model: MODEL, voice, opened, turnComplete, audioBytes, audioSeconds: +seconds.toFixed(2), transcript: outText.slice(0, 200), closeReason }, null, 1));
if (!opened || audioBytes < 4800) { console.error("FAIL: no spoken audio came back."); process.exit(1); }
console.log("PASS: Gemini returned spoken audio for the free call.");
process.exit(0);
