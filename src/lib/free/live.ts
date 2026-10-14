/** Browser-only. One Gemini Live call: microphone in, spoken reply out. */
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";

export type LiveHooks = {
  onAudio: (pcm24k: Uint8Array) => void;
  onTurnComplete: () => void;
  onInterrupted: () => void;
  onCaption: (who: "you" | "avatar", text: string) => void;
  onClose: (reason: string) => void;
};

export type LiveCall = {
  setMuted: (muted: boolean) => void;
  close: () => void;
};

export type TokenReply = { token: string; model: string };

const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("capture", Capture);
`;

const IN_RATE = 16_000;
const FLUSH_SAMPLES = 1600; // 100 ms

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Cheap linear resampler; speech does not need better. */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const a = Math.floor(pos);
    const b = Math.min(a + 1, input.length - 1);
    out[i] = input[a] + (input[b] - input[a]) * (pos - a);
  }
  return out;
}

function toPcm16(f: Float32Array): Uint8Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(out.buffer);
}

export async function startLiveCall(token: TokenReply, hooks: LiveHooks): Promise<LiveCall> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });

  let closed = false;
  let muted = false;
  let session: Session | null = null;
  let youText = "";
  let avatarText = "";

  const ctx = new AudioContext();
  const workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
  try {
    await ctx.audioWorklet.addModule(workletUrl);
  } finally {
    URL.revokeObjectURL(workletUrl);
  }
  const source = ctx.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(ctx, "capture");
  source.connect(capture);

  const shutdown = (reason: string) => {
    if (closed) return;
    closed = true;
    try {
      capture.disconnect();
      source.disconnect();
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => undefined);
    try {
      session?.close();
    } catch {
      /* ignore */
    }
    hooks.onClose(reason);
  };

  const ai = new GoogleGenAI({ apiKey: token.token, httpOptions: { apiVersion: "v1beta" } });
  const ready = new Promise<void>((resolve, reject) => {
    ai.live
      .connect({
        model: token.model,
        config: { responseModalities: [Modality.AUDIO] },
        callbacks: {
          onopen: () => resolve(),
          onmessage: (m: LiveServerMessage) => {
            const sc = m.serverContent;
            if (sc?.interrupted) hooks.onInterrupted();
            for (const part of sc?.modelTurn?.parts ?? []) {
              const data = part.inlineData?.data;
              if (data) hooks.onAudio(b64ToBytes(data));
            }
            if (sc?.inputTranscription?.text) {
              youText += sc.inputTranscription.text;
              hooks.onCaption("you", youText);
            }
            if (sc?.outputTranscription?.text) {
              if (youText) youText = "";
              avatarText += sc.outputTranscription.text;
              hooks.onCaption("avatar", avatarText);
            }
            if (sc?.turnComplete) {
              avatarText = "";
              hooks.onTurnComplete();
            }
          },
          onerror: (e: ErrorEvent) => {
            reject(new Error(e.message || "Connection error"));
            shutdown(e.message || "The connection failed.");
          },
          onclose: (e: CloseEvent) => shutdown(e.reason || "The call ended."),
        },
      })
      .then((s) => {
        session = s;
      })
      .catch(reject);
  });
  await ready;

  let pending: Float32Array[] = [];
  let pendingLen = 0;
  capture.port.onmessage = (ev: MessageEvent<Float32Array>) => {
    if (closed || muted || !session) return;
    const block = resample(ev.data, ctx.sampleRate, IN_RATE);
    pending.push(block);
    pendingLen += block.length;
    if (pendingLen < FLUSH_SAMPLES) return;
    const all = new Float32Array(pendingLen);
    let at = 0;
    for (const b of pending) {
      all.set(b, at);
      at += b.length;
    }
    pending = [];
    pendingLen = 0;
    try {
      session.sendRealtimeInput({ audio: { data: bytesToB64(toPcm16(all)), mimeType: `audio/pcm;rate=${IN_RATE}` } });
    } catch {
      /* socket already closing */
    }
  };

  // The model greets first, as the guide prompt asks.
  try {
    session!.sendRealtimeInput({ text: "The call has started. Greet the person." });
  } catch {
    /* it will still answer once the person speaks */
  }

  return {
    setMuted: (m) => {
      muted = m;
    },
    close: () => shutdown("You ended the call."),
  };
}
