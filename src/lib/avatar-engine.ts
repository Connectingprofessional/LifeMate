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
  engineUrl?: string;
};

const defaultEngineUrl = (import.meta.env.VITE_AVATAR_ENGINE_URL as string | undefined)?.trim() || "http://localhost:8010";

function engineUrl(value?: string) {
  return (value || defaultEngineUrl).replace(/\/$/, "");
}

async function apiError(response: Response) {
  const body = await response.text().catch(() => "");
  return body.slice(0, 500) || `Avatar engine returned HTTP ${response.status}`;
}

export async function startAvatarEngine(options: AvatarEngineOptions): Promise<AvatarEngineSession> {
  const base = engineUrl(options.engineUrl);
  const pc = new RTCPeerConnection();
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  pc.ontrack = (event) => {
    const [stream] = event.streams;
    if (stream) {
      options.video.srcObject = stream;
      void options.video.play().catch(() => undefined);
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  if (!pc.localDescription?.sdp) {
    pc.close();
    throw new Error("The avatar engine could not create a WebRTC offer.");
  }

  const query = new URLSearchParams({ avatar: options.avatarId, refaudio: options.voice });
  const response = await fetch(`${base}/whep?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: pc.localDescription.sdp,
  });
  if (!response.ok) {
    pc.close();
    throw new Error(await apiError(response));
  }

  const answerSdp = await response.text();
  const sessionId = response.headers.get("X-Session-ID") || "";
  if (!sessionId) {
    pc.close();
    throw new Error("The avatar engine did not return a WebRTC session ID.");
  }
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  return {
    sessionId,
    video: options.video,
    close: async () => {
      try {
        await fetch(`${base}/interrupt_talk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionid: sessionId }),
        });
      } catch {}
      pc.close();
      options.video.srcObject = null;
    },
    speak: async (text, voice) => {
      const response = await fetch(`${base}/human`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionid: sessionId, text, type: "echo", interrupt: false, tts: { voice } }),
      });
      if (!response.ok) throw new Error(await apiError(response));
    },
    interrupt: async () => {
      const response = await fetch(`${base}/interrupt_talk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionid: sessionId }),
      });
      if (!response.ok) throw new Error(await apiError(response));
    },
  };
}
