/** Browser-only: listens to the microphone and hands over one WAV per spoken utterance. */
import { Vad } from "./vad.ts";
import { downsample, encodeWav } from "./wav.ts";

export type MicHandle = {
  stop: () => void;
  setMuted: (muted: boolean) => void;
};

export type MicOptions = {
  onUtterance: (wav: Uint8Array) => void;
  /** While this returns true the microphone is ignored (the avatar is talking). */
  isPaused: () => boolean;
};

const WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("capture", Capture);
`;

const BLOCK_MS = 20;
const PREROLL_MS = 300;
const MIN_SPEECH_MS = 400;
const MAX_UTTERANCE_MS = 30_000;
const TARGET_RATE = 16_000;

function rms(block: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
  return Math.sqrt(sum / Math.max(1, block.length));
}

export async function startMic(opts: MicOptions): Promise<MicHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "capture");
  source.connect(node);

  const blockSize = Math.round((ctx.sampleRate * BLOCK_MS) / 1000);
  const prerollBlocks = Math.round(PREROLL_MS / BLOCK_MS);
  const vad = new Vad();

  let muted = false;
  let carry = new Float32Array(0);
  const preroll: Float32Array[] = [];
  let utterance: Float32Array[] = [];
  let utteranceMs = 0;

  const finish = () => {
    const blocks = utterance;
    const ms = utteranceMs;
    utterance = [];
    utteranceMs = 0;
    vad.reset();
    if (ms < MIN_SPEECH_MS) return;
    const all = new Float32Array(blocks.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const b of blocks) {
      all.set(b, at);
      at += b.length;
    }
    opts.onUtterance(encodeWav(downsample(all, ctx.sampleRate, TARGET_RATE), TARGET_RATE));
  };

  const handleBlock = (block: Float32Array) => {
    if (muted || opts.isPaused()) {
      // Drop anything half-heard so the avatar's own voice never reaches the model.
      if (utterance.length) {
        utterance = [];
        utteranceMs = 0;
      }
      vad.reset();
      preroll.length = 0;
      return;
    }
    const event = vad.process(rms(block), BLOCK_MS);
    if (event === "start") {
      utterance = [...preroll];
      utteranceMs = utterance.length * BLOCK_MS;
    }
    if (vad.isSpeaking || event === "end") {
      utterance.push(block);
      utteranceMs += BLOCK_MS;
    } else {
      preroll.push(block);
      if (preroll.length > prerollBlocks) preroll.shift();
    }
    if (event === "end" || utteranceMs >= MAX_UTTERANCE_MS) finish();
  };

  node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
    const incoming = ev.data;
    const merged = new Float32Array(carry.length + incoming.length);
    merged.set(carry);
    merged.set(incoming, carry.length);
    let at = 0;
    while (merged.length - at >= blockSize) {
      handleBlock(merged.slice(at, at + blockSize));
      at += blockSize;
    }
    carry = merged.slice(at);
  };

  return {
    setMuted: (m) => {
      muted = m;
      stream.getAudioTracks().forEach((t) => (t.enabled = !m));
    },
    stop: () => {
      node.port.onmessage = null;
      try {
        source.disconnect();
        node.disconnect();
      } catch {
        /* already disconnected */
      }
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
