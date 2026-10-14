export type AvatarEngineSession = {
  sessionId: string;
  video: HTMLVideoElement;
  close: () => Promise<void>;
  speak: (text: string, voice: string) => Promise<void>;
  interrupt: () => Promise<void>;
};

export type AvatarEngineOptions = {
  avatarId: string;
  voice: string;
  video: HTMLVideoElement;
};

type RenderState = {
  speaking: boolean;
  level: number;
};

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function palette(id: string) {
  const h = hash(id);
  const hue = h % 360;
  const skin = ["#f0bc91", "#d59a73", "#c9825d", "#b8754f", "#a86d49", "#8e5a3c"][h % 6];
  const hair = ["#171717", "#241b18", "#3a2520", "#4b2e21", "#8b5a2b", "#201512"][Math.floor(h / 7) % 6];
  const outfit = `hsl(${hue} 55% 45%)`;
  const accent = `hsl(${(hue + 35) % 360} 70% 72%)`;
  return { skin, hair, outfit, accent };
}

function localeFromVoiceId(voiceId: string): string {
  const match = voiceId.match(/^([a-z]{2,3}-[A-Z]{2})/);
  return match?.[1] || "en-US";
}

function pickSpeechVoice(voiceId: string): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  const wanted = voiceId.toLowerCase();
  const locale = localeFromVoiceId(voiceId).toLowerCase();

  return (
    voices.find((v) => v.name.toLowerCase() === wanted) ||
    voices.find((v) => v.name.toLowerCase().includes(wanted.replace(/neural$/, ""))) ||
    voices.find((v) => v.lang.toLowerCase() === locale) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(locale.split("-")[0])) ||
    voices.find((v) => v.default)
  );
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  avatarId: string,
  state: RenderState,
) {
  const { skin, hair, outfit, accent } = palette(avatarId);
  const h = hash(avatarId);
  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#111827");
  background.addColorStop(1, "#05070b");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const cx = width / 2;
  const headY = height * 0.38;
  const headW = width * 0.31;
  const headH = height * 0.36;
  const shoulderY = height * 0.73;

  ctx.globalAlpha = 0.22;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, height * 0.42, width * 0.35 + state.level * 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = outfit;
  ctx.beginPath();
  ctx.ellipse(cx, shoulderY + height * 0.18, width * 0.34, height * 0.23, 0, Math.PI, 0);
  ctx.fill();

  ctx.fillStyle = skin;
  ctx.fillRect(cx - width * 0.06, headY + headH * 0.68, width * 0.12, height * 0.12);

  ctx.beginPath();
  ctx.ellipse(cx, headY, headW, headH, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.ellipse(cx, headY - headH * 0.31, headW * 1.03, headH * 0.55, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - headW * 0.98, headY - headH * 0.31, headW * 0.18, headH * 0.43);
  ctx.fillRect(cx + headW * 0.80, headY - headH * 0.31, headW * 0.18, headH * 0.43);

  const eyeY = headY - headH * 0.02;
  const eyeGap = headW * 0.38;
  ctx.fillStyle = "#172033";
  ctx.beginPath();
  ctx.arc(cx - eyeGap, eyeY, width * 0.018, 0, Math.PI * 2);
  ctx.arc(cx + eyeGap, eyeY, width * 0.018, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#754b3b";
  ctx.lineWidth = Math.max(2, width * 0.008);
  ctx.beginPath();
  ctx.moveTo(cx, eyeY + headH * 0.04);
  ctx.lineTo(cx - width * 0.015, eyeY + headH * 0.15);
  ctx.stroke();

  const mouthOpen = state.speaking ? 0.012 + state.level * 0.055 : 0.006;
  ctx.fillStyle = "#572c31";
  ctx.beginPath();
  ctx.ellipse(cx, headY + headH * 0.34, width * 0.045, height * mouthOpen, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = accent;
  ctx.font = `600 ${Math.max(14, Math.floor(width * 0.035))}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(avatarId.replace(/[-_]/g, " ").replace(/\\b\\w/g, (c) => c.toUpperCase()), cx, height * 0.93);

  // Small deterministic accessory variation keeps the 100+ avatar catalogue visually distinct.
  if (h % 3 === 0) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(2, width * 0.007);
    ctx.beginPath();
    ctx.arc(cx, headY, headW * 1.04, 0.15, Math.PI - 0.15);
    ctx.stroke();
  }
}

export async function startAvatarEngine(options: AvatarEngineOptions): Promise<AvatarEngineSession> {
  if (typeof document === "undefined") throw new Error("Avatar rendering requires a browser.");
  if (!options.video) throw new Error("The video surface is unavailable.");
  if (!("RTCPeerConnection" in window)) throw new Error("This browser does not support WebRTC.");

  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The browser could not create the avatar renderer.");

  const state: RenderState = { speaking: false, level: 0 };
  let closed = false;
  let animationFrame = 0;
  let currentUtterance: SpeechSynthesisUtterance | null = null;

  const render = () => {
    if (closed) return;
    const target = state.speaking ? 0.65 : 0;
    state.level += (target - state.level) * 0.18;
    drawAvatar(ctx, canvas.width, canvas.height, options.avatarId, state);
    animationFrame = requestAnimationFrame(render);
  };
  render();

  // Native WebRTC replaces the former LiveKit media transport. The two peer
  // connections are the local room's publisher/subscriber: the avatar publishes
  // its MediaStream and the LifeMate call surface subscribes to it.
  const publisher = new RTCPeerConnection();
  const subscriber = new RTCPeerConnection();

  publisher.onicecandidate = (event) => {
    if (event.candidate) void subscriber.addIceCandidate(event.candidate).catch(() => undefined);
  };
  subscriber.onicecandidate = (event) => {
    if (event.candidate) void publisher.addIceCandidate(event.candidate).catch(() => undefined);
  };

  const stream = canvas.captureStream(30);
  for (const track of stream.getTracks()) publisher.addTrack(track, stream);

  const subscribed = new Promise<void>((resolve) => {
    subscriber.ontrack = (event) => {
      if (!event.streams[0]) return;
      options.video.srcObject = event.streams[0];
      void options.video.play().catch(() => undefined);
      resolve();
    };
  });

  const offer = await publisher.createOffer();
  await publisher.setLocalDescription(offer);
  await waitForIce(publisher);
  if (!publisher.localDescription?.sdp) {
    publisher.close();
    subscriber.close();
    throw new Error("The WebRTC publisher could not create an offer.");
  }

  await subscriber.setRemoteDescription(publisher.localDescription);
  const answer = await subscriber.createAnswer();
  await subscriber.setLocalDescription(answer);
  await waitForIce(subscriber);
  if (!subscriber.localDescription?.sdp) {
    publisher.close();
    subscriber.close();
    throw new Error("The WebRTC subscriber could not create an answer.");
  }

  await publisher.setRemoteDescription(subscriber.localDescription);
  await subscribed;

  const sessionId = `webrtc-room-${hash(options.avatarId).toString(16)}-${Date.now().toString(36)}`;

  const interrupt = async () => {
    state.speaking = false;
    state.level = 0;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    currentUtterance = null;
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    await interrupt();
    cancelAnimationFrame(animationFrame);
    stream.getTracks().forEach((track) => track.stop());
    publisher.close();
    subscriber.close();
    options.video.srcObject = null;
  };

  const speak = async (text: string, voiceId: string) => {
    if (closed || !text.trim()) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      throw new Error("This browser does not provide speech synthesis.");
    }

    await interrupt();

    const utterance = new SpeechSynthesisUtterance(text);
    const selectedVoice = pickSpeechVoice(voiceId);
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.lang = selectedVoice?.lang || localeFromVoiceId(voiceId);
    utterance.rate = 1;
    utterance.pitch = 1;

    currentUtterance = utterance;
    state.speaking = true;

    await new Promise<void>((resolve, reject) => {
      utterance.onend = () => {
        if (currentUtterance === utterance) currentUtterance = null;
        state.speaking = false;
        state.level = 0;
        resolve();
      };
      utterance.onerror = (event) => {
        if (currentUtterance === utterance) currentUtterance = null;
        state.speaking = false;
        state.level = 0;
        reject(new Error(`Browser speech synthesis failed: ${event.error || "unknown error"}`));
      };
      window.speechSynthesis.speak(utterance);
    });
  };

  return { sessionId, video: options.video, close, speak, interrupt };
}

function waitForIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", done);
      resolve();
    };
    pc.addEventListener("icegatheringstatechange", done);
  });
}
