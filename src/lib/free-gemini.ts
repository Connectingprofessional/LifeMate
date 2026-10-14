export type GeminiSession = { close: () => void; setMicrophoneEnabled: (enabled: boolean) => Promise<void> };

export type GeminiSessionOptions = {
  voice?: string;
  language: string;
  topic: string;
  tone: string;
  avatarName: string;
  onStatus: (status: string) => void;
  onTranscript: (kind: "user" | "assistant", text: string) => void;
  onAssistantText?: (text: string) => void;
  onAudioLevel?: (level: number) => void;
};

type GeminiMessage = {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: Array<{ text?: string }> };
    inputTranscription?: { text?: string };
    interimInputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    turnComplete?: boolean;
  };
  error?: { message?: string };
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function floatToPcm16(input: Float32Array, sourceRate: number): Uint8Array {
  const ratio = sourceRate / 16_000;
  const output = new Int16Array(Math.max(1, Math.floor(input.length / ratio)));
  for (let i = 0; i < output.length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    const sample = end > start ? sum / (end - start) : 0;
    output[i] = Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 0x8000 : 0x7fff);
  }
  return new Uint8Array(output.buffer);
}

export async function startGeminiSession(options: GeminiSessionOptions): Promise<GeminiSession> {
  const tokenResponse = await fetch("/api/gemini-token", { method: "POST" });
  const tokenData = (await tokenResponse.json()) as { token?: string; model?: string; error?: string };
  if (!tokenResponse.ok || !tokenData.token) throw new Error(tokenData.error || "Could not obtain a Gemini session token.");

  const model = tokenData.model || "gemini-3.8-live";
  const socket = new WebSocket(
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=" +
      encodeURIComponent(tokenData.token),
  );

  const inputStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const audioContext = new AudioContext({ sampleRate: 16_000 });
  const source = audioContext.createMediaStreamSource(inputStream);
  const processor = audioContext.createScriptProcessor(2048, 1, 1);
  const sink = audioContext.createGain();
  sink.gain.value = 0;
  source.connect(processor);
  processor.connect(sink);
  sink.connect(audioContext.destination);

  let closed = false;
  const setMicrophoneEnabled = async (enabled: boolean) => {
    inputStream.getAudioTracks().forEach((track) => (track.enabled = enabled));
  };

  const close = () => {
    if (closed) return;
    closed = true;
    inputStream.getTracks().forEach((track) => track.stop());
    processor.disconnect();
    source.disconnect();
    sink.disconnect();
    void audioContext.close();
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  };

  await new Promise<void>((resolve, reject) => {
    socket.onerror = () => reject(new Error("Gemini Live WebSocket connection failed."));
    socket.onopen = () => {
      socket.send(JSON.stringify({
        setup: {
          model: "models/" + model,
          generationConfig: { responseModalities: ["TEXT"] },
          systemInstruction:
            "You are LifeMate, a warm, capable personal AI companion. Selected avatar: " + options.avatarName +
            ". Preferred language: " + options.language + ". Topic: " + options.topic + ". Tone: " + options.tone +
            ". Give concise spoken-style replies. Never mention implementation providers.",
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          sessionResumption: {},
        },
      }));
      resolve();
    };
    socket.onclose = (event) => {
      if (!closed && event.code !== 1000) options.onStatus("Gemini connection closed.");
    };
  });

  processor.onaudioprocess = (event) => {
    if (closed || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      realtimeInput: {
        audio: { mimeType: "audio/pcm;rate=16000", data: bytesToBase64(floatToPcm16(event.inputBuffer.getChannelData(0), audioContext.sampleRate)) },
      },
    }));
  };

  let assistantBuffer = "";
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as GeminiMessage;
    if (message.error?.message) { options.onStatus(message.error.message); return; }
    if (message.setupComplete) { options.onStatus("Connected. Speak naturally."); return; }
    const content = message.serverContent;
    if (!content) return;

    if (content.interimInputTranscription?.text) options.onTranscript("user", content.interimInputTranscription.text);
    if (content.inputTranscription?.text) options.onTranscript("user", content.inputTranscription.text);
    if (content.outputTranscription?.text) options.onTranscript("assistant", content.outputTranscription.text);

    for (const part of content.modelTurn?.parts || []) {
      if (part.text) {
        assistantBuffer += part.text;
        options.onTranscript("assistant", part.text);
      }
    }

    if (content.turnComplete) {
      const text = assistantBuffer.trim();
      assistantBuffer = "";
      if (text) options.onAssistantText?.(text);
      options.onStatus("Listening…");
    }
  };

  await audioContext.resume();
  return { close, setMicrophoneEnabled };
}
