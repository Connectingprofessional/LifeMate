import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { SentenceChunker, sanitizeForSpeech } from "./sentences.ts";
import { downsample, encodeWav, pcmToWav } from "./wav.ts";
import { describeVoice, voicesForLanguage } from "./languages.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { createSession, getSession, removeSession, sweepSessions } from "./sessions.ts";
import { runTurn } from "./turn.ts";
import type { TurnEvent } from "./turn.ts";
import { avatarPreviewPath, listAvatars } from "./avatars.ts";
import { listVoiceIds, ltOffer } from "./clients.ts";

// ───────────────────────── helpers ─────────────────────────

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    req.on("data", (c) => parts.push(c));
    req.on("end", () => resolve(Buffer.concat(parts)));
  });
}

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function collect(gen: AsyncGenerator<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

// ───────────────────────── unit tests ─────────────────────────

describe("SentenceChunker", () => {
  it("cuts streamed text into sentences", () => {
    const c = new SentenceChunker();
    const got: string[] = [];
    for (const piece of ["Hello the", "re, my friend. How are ", "you doing today? Tell", " me more."]) got.push(...c.push(piece));
    got.push(...c.flush());
    assert.deepEqual(got, ["Hello there, my friend.", "How are you doing today?", "Tell me more."]);
  });

  it("drops <think> blocks even when the tags are split across chunks", () => {
    const c = new SentenceChunker();
    const got: string[] = [];
    for (const piece of ["<thi", "nk>secret plan</th", "ink>Sure, I can help with that. Go ahead."]) got.push(...c.push(piece));
    got.push(...c.flush());
    assert.equal(got.join(" "), "Sure, I can help with that. Go ahead.");
  });

  it("does not split decimals and handles the Hindi danda", () => {
    const c = new SentenceChunker();
    const a = [...c.push("The value is 3.5 percent today and rising. "), ...c.flush()];
    assert.equal(a[0], "The value is 3.5 percent today and rising.");
    const d = new SentenceChunker();
    const b = [...d.push("नमस्ते, आप कैसे हैं आज? मैं आपकी मदद के लिए यहाँ हूँ।"), ...d.flush()];
    assert.deepEqual(b, ["नमस्ते, आप कैसे हैं आज?", "मैं आपकी मदद के लिए यहाँ हूँ।"]);
  });

  it("removes markdown, links and emoji before speaking", () => {
    assert.equal(sanitizeForSpeech("**Great** idea 😀 see [docs](http://x.io) now"), "Great idea see docs now");
  });
});

describe("audio helpers", () => {
  it("writes a valid WAV header", () => {
    const wav = pcmToWav(new Uint8Array(100), 24000);
    const v = new DataView(wav.buffer);
    assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
    assert.equal(v.getUint32(4, true), 136);
    assert.equal(v.getUint32(24, true), 24000);
    assert.equal(v.getUint32(40, true), 100);
    assert.equal(wav.length, 144);
  });

  it("encodes float samples and downsamples", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]), 16000);
    const v = new DataView(wav.buffer);
    assert.equal(v.getInt16(44 + 2, true), 32767);
    assert.equal(v.getInt16(44 + 4, true), -32768);
    assert.equal(downsample(new Float32Array(480), 48000, 16000).length, 160);
  });
});

describe("languages, prompt and config", () => {
  it("describes voices by their prefix", () => {
    assert.deepEqual(describeVoice("hf_alpha"), { id: "hf_alpha", name: "Alpha", gender: "female", language: "hi" });
    assert.equal(describeVoice("zz_nobody"), null);
    assert.deepEqual(
      voicesForLanguage("en", ["af_heart", "bm_george", "hf_alpha"]).map((v) => v.id),
      ["af_heart", "bm_george"],
    );
  });

  it("builds a spoken-style system prompt", () => {
    const p = buildSystemPrompt({ languageLabel: "Hindi", tone: "calm, warm", topic: "Job search" });
    assert.match(p, /Speak only in Hindi/);
    assert.match(p, /Speaking style: calm, warm/);
    assert.match(p, /Job search/);
    assert.match(p, /no lists, headings, markdown, emoji/);
  });

  it("has local defaults and reads overrides", () => {
    const d = loadConfig({});
    assert.equal(d.llmBaseUrl, "http://127.0.0.1:11434/v1");
    assert.equal(d.liveTalkingUrl, "http://127.0.0.1:8010");
    const c = loadConfig({ LLM_BASE_URL: "http://gpu:9000/v1/", LLM_MODEL: "x", ICE_SERVERS_JSON: '[{"urls":"turn:t:3478"}]' });
    assert.equal(c.llmBaseUrl, "http://gpu:9000/v1");
    assert.equal(c.llmModel, "x");
    assert.equal(c.iceServers.length, 1);
  });
});

describe("sessions and avatars", () => {
  it("sweeps idle sessions", () => {
    const s = createSession("old", { language: "en", languageLabel: "English", voice: "af_heart", tone: "", topic: "", avatar: "a" });
    s.lastSeen = 0;
    createSession("fresh", s.persona);
    assert.equal(sweepSessions(1000, 5000), 1);
    assert.equal(getSession("old"), undefined);
    assert.ok(getSession("fresh"));
    removeSession("fresh");
  });

  it("lists avatar folders and guards preview paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "avatars-"));
    mkdirSync(join(dir, "asha_01", "full_imgs"), { recursive: true });
    writeFileSync(join(dir, "asha_01", "full_imgs", "00000000.png"), "x");
    writeFileSync(join(dir, "asha_01", "meta.json"), JSON.stringify({ name: "Asha", gender: "female", voice: "hf_alpha" }));
    mkdirSync(join(dir, "plain-two"));
    writeFileSync(join(dir, "stray.txt"), "ignore me");
    const list = listAvatars(dir);
    assert.deepEqual(list.map((a) => [a.id, a.name, a.gender, a.voice, a.hasPreview]), [
      ["asha_01", "Asha", "female", "hf_alpha", true],
      ["plain-two", "plain two", "", "", false],
    ]);
    assert.ok(avatarPreviewPath(dir, "asha_01")?.endsWith("00000000.png"));
    assert.equal(avatarPreviewPath(dir, "../etc"), null);
    assert.equal(listAvatars(join(dir, "missing")).length, 0);
  });
});

// ───────────────────── pipeline against fake services ─────────────────────

describe("runTurn with fake STT, LLM, TTS and avatar servers", () => {
  const log = {
    stt: [] as string[],
    llm: [] as { messages: { role: string; content: string }[] }[],
    tts: [] as { input: string; voice: string }[],
    avatarAudio: [] as { sessionid: boolean; riff: boolean }[],
    interrupts: 0,
  };
  let servers: Server[] = [];
  let cfg: ReturnType<typeof loadConfig>;
  let llmReply = ["<think>hid", "den</think>Hello there, friend. ", "How are you today? ", "Tell me more."];
  let sttText = "I want a new job";
  let sttDown = false;
  let ttsDelayMs = 0;

  before(async () => {
    const stt = await listen(async (req, res) => {
      if (sttDown) return res.writeHead(503).end("busy");
      const body = (await readBody(req)).toString("latin1");
      log.stt.push(/name="language"\r\n\r\n(\w+)/.exec(body)?.[1] ?? "");
      res.setHeader("content-type", "application/json").end(JSON.stringify({ text: sttText }));
    });
    const llm = await listen(async (req, res) => {
      log.llm.push(JSON.parse((await readBody(req)).toString()));
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const t of llmReply) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
        await new Promise((r) => setTimeout(r, 5));
      }
      res.end("data: [DONE]\n\n");
    });
    const tts = await listen(async (req, res) => {
      if (req.url?.endsWith("/audio/voices")) {
        return res.setHeader("content-type", "application/json").end(JSON.stringify({ voices: ["af_heart", "hf_alpha"] }));
      }
      log.tts.push(JSON.parse((await readBody(req)).toString()));
      if (ttsDelayMs) await new Promise((r) => setTimeout(r, ttsDelayMs));
      res.setHeader("content-type", "audio/pcm").end(Buffer.alloc(4800, 1));
    });
    const lt = await listen(async (req, res) => {
      const body = await readBody(req);
      res.setHeader("content-type", "application/json");
      if (req.url === "/humanaudio") {
        const text = body.toString("latin1");
        log.avatarAudio.push({ sessionid: /name="sessionid"\r\n\r\n42/.test(text), riff: text.includes("RIFF") });
        return res.end(JSON.stringify({ code: 0, msg: "ok" }));
      }
      if (req.url === "/offer") return res.end(JSON.stringify({ sdp: "answer-sdp", type: "answer", sessionid: 42 }));
      if (req.url === "/interrupt_talk") {
        log.interrupts++;
        return res.end(JSON.stringify({ code: 0 }));
      }
      res.end(JSON.stringify({ code: 0, data: true }));
    });
    servers = [stt.server, llm.server, tts.server, lt.server];
    cfg = loadConfig({
      STT_BASE_URL: stt.url,
      LLM_BASE_URL: llm.url,
      TTS_BASE_URL: tts.url,
      LIVETALKING_URL: lt.url,
    });
  });

  after(() => {
    for (const s of servers) s.close();
  });

  const persona = { language: "hi", languageLabel: "Hindi", voice: "hf_alpha", tone: "calm", topic: "Job search", avatar: "asha" };

  it("listens, thinks and speaks sentence by sentence, in order", async () => {
    const session = createSession("42", persona);
    const events = await collect(runTurn(cfg, session, { wav: new Uint8Array(1000) }));

    assert.deepEqual(events, [
      { type: "user", text: "I want a new job" },
      { type: "assistant", text: "Hello there, friend." },
      { type: "assistant", text: "How are you today?" },
      { type: "assistant", text: "Tell me more." },
      { type: "done" },
    ]);
    assert.equal(log.stt.at(-1), "hi", "speech-to-text is told the chosen language");
    assert.equal(log.tts.length, 3);
    assert.ok(log.tts.every((t) => t.voice === "hf_alpha"), "every sentence uses the chosen voice");
    assert.deepEqual(log.tts.map((t) => t.input), ["Hello there, friend.", "How are you today?", "Tell me more."]);
    assert.equal(log.avatarAudio.length, 3);
    assert.ok(log.avatarAudio.every((a) => a.sessionid && a.riff), "avatar receives valid audio for its own session");

    const sent = log.llm.at(-1)!.messages;
    assert.equal(sent[0].role, "system");
    assert.match(sent[0].content, /Speak only in Hindi/);
    assert.match(sent[0].content, /calm/);
    assert.equal(sent.at(-1)!.content, "I want a new job");
    assert.equal(session.history.at(-1)!.content, "Hello there, friend. How are you today? Tell me more.");
    removeSession("42");
  });

  it("accepts typed text and remembers the conversation", async () => {
    const session = createSession("42", persona);
    await collect(runTurn(cfg, session, { text: "first question" }));
    await collect(runTurn(cfg, session, { text: "second question" }));
    const sent = log.llm.at(-1)!.messages.map((m) => m.role);
    assert.deepEqual(sent, ["system", "user", "assistant", "user"]);
    removeSession("42");
  });

  it("ignores silence and empty transcripts", async () => {
    const session = createSession("42", persona);
    sttText = " .. ";
    const events = await collect(runTurn(cfg, session, { wav: new Uint8Array(10) }));
    sttText = "I want a new job";
    assert.deepEqual(events, [{ type: "ignored" }]);
    assert.equal(session.history.length, 0);
    removeSession("42");
  });

  it("reports a down service by name instead of failing silently", async () => {
    const session = createSession("42", persona);
    sttDown = true;
    const events = await collect(runTurn(cfg, session, { wav: new Uint8Array(10) }));
    sttDown = false;
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "error");
    assert.match((events[0] as { message: string }).message, /Speech-to-text: HTTP 503/);
    removeSession("42");
  });

  it("cancels the old reply when the person talks again (barge-in)", async () => {
    const session = createSession("42", persona);
    ttsDelayMs = 80;
    llmReply = ["One long answer sentence here. ", "And a second one follows. ", "And a third one too."];
    const before = log.avatarAudio.length;
    const first = collect(runTurn(cfg, session, { text: "go on" }));
    await new Promise((r) => setTimeout(r, 40));
    const second = collect(runTurn(cfg, session, { text: "actually stop" }));
    const [a, b] = await Promise.all([first, second]);
    ttsDelayMs = 0;
    assert.ok(!a.some((e) => e.type === "done"), "interrupted turn never reports done");
    assert.ok(b.some((e) => e.type === "done"), "new turn completes");
    assert.ok(log.avatarAudio.length - before <= 4);
    llmReply = ["<think>hid", "den</think>Hello there, friend. ", "How are you today? ", "Tell me more."];
    removeSession("42");
  });

  it("talks to the avatar server for calls and the TTS server for voices", async () => {
    const answer = await ltOffer(cfg, { sdp: "offer-sdp", type: "offer", avatar: "asha" });
    assert.deepEqual(answer, { sdp: "answer-sdp", type: "answer", sessionid: "42" });
    assert.deepEqual(await listVoiceIds(cfg), ["af_heart", "hf_alpha"]);
  });
});
