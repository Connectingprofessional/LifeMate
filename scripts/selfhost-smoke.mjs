#!/usr/bin/env node
/**
 * End-to-end check of the built self-hosted server (.output) against fake
 * STT / LLM / TTS / avatar services. Needs no GPU:  npm run build (with
 * NITRO_PRESET=node-server) && node scripts/selfhost-smoke.mjs
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const body = (req) => new Promise((r) => { const p = []; req.on("data", (c) => p.push(c)); req.on("end", () => r(Buffer.concat(p))); });
const listen = (h) => new Promise((r) => { const s = createServer(h); s.listen(0, "127.0.0.1", () => r({ s, url: `http://127.0.0.1:${s.address().port}` })); });

const seen = { audio: 0, interrupts: 0 };
const stt = await listen(async (req, res) => { await body(req); res.setHeader("content-type", "application/json").end(JSON.stringify({ text: "I need career advice" })); });
const llm = await listen(async (req, res) => {
  if (req.url.endsWith("/models")) return res.setHeader("content-type", "application/json").end("{}");
  await body(req);
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const t of ["Happy to help. ", "What field are you in? "]) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
  res.end("data: [DONE]\n\n");
});
const tts = await listen(async (req, res) => {
  if (req.url.endsWith("/audio/voices")) return res.setHeader("content-type", "application/json").end(JSON.stringify({ voices: ["af_heart", "hf_alpha", "hm_omega"] }));
  await body(req);
  res.end(Buffer.alloc(4800, 1));
});
const lt = await listen(async (req, res) => {
  await body(req);
  res.setHeader("content-type", "application/json");
  if (req.url === "/humanaudio") { seen.audio++; return res.end('{"code":0}'); }
  if (req.url === "/offer") return res.end('{"sdp":"answer-sdp","type":"answer","sessionid":42}');
  if (req.url === "/interrupt_talk") { seen.interrupts++; return res.end('{"code":0}'); }
  res.end('{"code":0,"data":false}');
});

const avatars = mkdtempSync(join(tmpdir(), "smoke-avatars-"));
mkdirSync(join(avatars, "asha", "full_imgs"), { recursive: true });
writeFileSync(join(avatars, "asha", "full_imgs", "0.png"), "PNGDATA");
writeFileSync(join(avatars, "asha", "meta.json"), '{"name":"Asha","gender":"female","voice":"hf_alpha"}');

const PORT = 3999;
const app = spawn("node", [".output/server/index.mjs"], {
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", STT_BASE_URL: stt.url, LLM_BASE_URL: llm.url, TTS_BASE_URL: tts.url, LIVETALKING_URL: lt.url, AVATARS_DIR: avatars },
  stdio: ["ignore", "inherit", "inherit"],
});
const base = `http://127.0.0.1:${PORT}`;
const stop = () => { app.kill(); for (const x of [stt, llm, tts, lt]) x.s.close(); };

try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(base + "/api/health")).ok) break; } catch { /* not up yet */ }
    if (i > 60) throw new Error("server did not start");
    await new Promise((r) => setTimeout(r, 250));
  }
  const post = (path, init) => fetch(base + path, { method: "POST", ...init });
  const json = (o) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(o) });

  const health = await (await fetch(base + "/api/health")).json();
  assert.ok(health.ok, "all four fake services reachable");

  const cat = await (await fetch(base + "/api/catalog")).json();
  assert.equal(cat.avatars.length, 1);
  assert.equal(cat.avatars[0].name, "Asha");
  assert.equal(cat.avatars[0].preview_url, "/api/avatar-preview/asha");
  assert.deepEqual(cat.voices.map((v) => v.id).sort(), ["af_heart", "hf_alpha", "hm_omega"]);
  assert.equal(cat.warnings.length, 0);

  const img = await fetch(base + cat.avatars[0].preview_url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.equal((await fetch(base + "/api/avatar-preview/..%2F..%2Fetc")).status, 404);

  assert.equal((await post("/api/offer", json({ type: "offer" }))).status, 400, "bad offer rejected");
  assert.equal((await post("/api/offer", json({ sdp: "x", type: "offer", avatar: "nobody" }))).status, 400, "unknown avatar rejected");
  const offer = await (await post("/api/offer", json({ sdp: "offer-sdp", type: "offer", avatar: "asha", language: "hi", voice: "hf_alpha", tone: "calm", topic: "Job search" }))).json();
  assert.equal(offer.sessionid, "42");
  assert.equal(offer.sdp, "answer-sdp");

  const turn = await post("/api/turn?sessionid=42", json({ text: "hello" }));
  assert.equal(turn.status, 200);
  const events = (await turn.text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(events.map((e) => e.type), ["user", "assistant", "assistant", "done"]);
  assert.equal(seen.audio, 2, "each sentence reached the avatar");

  const voiceTurn = await post("/api/turn?sessionid=42", { headers: { "content-type": "audio/wav" }, body: Buffer.alloc(2000, 1) });
  const vEvents = (await voiceTurn.text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(vEvents[0].text, "I need career advice");
  assert.equal(seen.audio, 4);

  const st = await (await fetch(base + "/api/status?sessionid=42")).json();
  assert.deepEqual([st.active, st.speaking], [true, false]);
  assert.equal((await post("/api/interrupt", json({ sessionid: "42" }))).status, 200);
  assert.equal(seen.interrupts, 1);

  await post("/api/stop", json({ sessionid: "42" }));
  assert.equal((await post("/api/turn?sessionid=42", json({ text: "hi" }))).status, 404, "stopped call is gone");

  console.log("selfhost smoke test: all checks passed");
} catch (e) {
  console.error("selfhost smoke test FAILED:", e);
  process.exitCode = 1;
} finally {
  stop();
}
