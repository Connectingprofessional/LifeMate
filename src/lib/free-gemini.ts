export type GeminiSessionOptions = {
  voice: string;
  language: string;
  topic: string;
  tone: string;
  avatarName: string;
  onStatus: (status: string) => void;
  onTranscript: (kind: "user" | "assistant", text: string) => void;
  onAudioLevel: (level: number) => void;
};

type GeminiMessage = {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: {
      parts?: Array<{
        inlineData?: { data?: string; mimeType?: string };
        text?: string;
      }>;
    };
    inputTranscription?: { text?: string };
    interimInputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    turnComplete?: boolean;
    generationComplete?: boolean;
  };
  error?: { message?: string };
};

type AudioEngine = {
  context: AudioContext;
  inputContext: AudioContext;
  inputStream: MediaStream;
  processor: ScriptProcessorNode;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  gain: GainNode;
  nextPlayTime: number;
  activeSources: Set<AudioBufferSourceNode>;
};

const INPUT_RATE = 16_000;
const OUTPUT_RATE = 24_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function floatToPcm16(input: Float32Array, sourceRate: number): Uint8Array {
  const ratio = sourceRate / INPUT_RATE;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += input[j];
      count += 1;
    }
    const sample = count ? sum / count : input[Math.min(start, input.length - 1)] || 0;
    const clipped = Math.max(-1, Math.min(1, sample));
    output[i] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
  }

  return new Uint8Array(output.buffer);
}

function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const output = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < output.length; i += 1) {
    output[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return output;
}

async function createAudioEngine(
  onChunk: (pcm: Uint8Array) => void,
  onLevel: (level: number) => void,
): Promise<AudioEngine> {
  const context = new AudioContext({ sampleRate: OUTPUT_RATE });
  const inputContext = new AudioContext({ sampleRate: INPUT_RATE });
  const inputStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const source = inputContext.createMediaStreamSource(inputStream);
  const processor = inputContext.createScriptProcessor(2048, 1, 1);
  const sink = inputContext.createGain();
  sink.gain.value = 0;

  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.7;
  const gain = context.createGain();
  gain.gain.value = 1;
  gain.connect(analyser);
  analyser.connect(context.destination);

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    onChunk(floatToPcm16(input, inputContext.sampleRate));
  };

  const levelData = new Uint8Array(analyser.fftSize);
  const tick = () => {
    if (context.state !== "closed") {
      analyser.getByteTimeDomainData(levelData);
      let sum = 0;
      for (const value of levelData) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      onLevel(Math.min(1, Math.sqrt(sum / levelData.length) * 3.5));
      requestAnimationFrame(tick);
    }
  };
  tick();

  source.connect(processor);
  processor.connect(sink);
  sink.connect(inputContext.destination);
  await context.resume();
  await inputContext.resume();

  return {
    context,
    inputContext,
    inputStream,
    processor,
    source,
    analyser,
    gain,
    nextPlayTime: context.currentTime,
    activeSources: new Set(),
  };
}

function stopAudio(engine: AudioEngine) {
  engine.inputStream.getTracks().forEach((track) => track.stop());
  engine.processor.disconnect();
  engine.source.disconnect();
  engine.gain.disconnect();
  engine.analyser.disconnect();
  for (const source of engine.activeSources) {
    try { source.stop(); } catch {}
  }
  engine.activeSources.clear();
  void engine.inputContext.close();
  void engine.context.close();
}

function playPcm(engine: AudioEngine, bytes: Uint8Array) {
  const samples = pcm16ToFloat(bytes);
  if (!samples.length) return;

  const buffer = engine.context.createBuffer(1, samples.length, OUTPUT_RATE);
  buffer.copyToChannel(samples, 0);

  const source = engine.context.createBufferSource();
  source.buffer = buffer;
  source.connect(engine.gain);
  engine.activeSources.add(source);

  const startAt = Math.max(engine.context.currentTime + 0.01, engine.nextPlayTime);
  source.start(startAt);
  engine.nextPlayTime = startAt + buffer.duration;
  source.onended = () => engine.activeSources.delete(source);
}

function stopPlayback(engine: AudioEngine) {
  for (const source of engine.activeSources) {
    try { source.stop(); } catch {}
  }
  engine.activeSources.clear();
  engine.nextPlayTime = engine.context.currentTime;
}

export async function startGeminiSession(options: GeminiSessionOptions) {
  const tokenResponse = await fetch("/api/gemini-token", { method: "POST" });
  const tokenData = (await tokenResponse.json()) as {
    token?: string;
    model?: string;
    error?: string;
  };

  if (!tokenResponse.ok || !tokenData.token) {
    throw new Error(tokenData.error || "Could not obtain a Gemini session token.");
  }

  const model = tokenData.model || "gemini-3.8-live";
  const wsUrl =
    "wss://generativelanguage.googleapis.com/ws/" +
    "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained" +
    "?access_token=" +
    encodeURIComponent(tokenData.token);

  const socket = new WebSocket(wsUrl);
  let audio: AudioEngine | null = null;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    if (audio) {
      stopAudio(audio);
      audio = null;
    }
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  };

  const ready = new Promise<void>((resolve, reject) => {
    socket.onerror = () => reject(new Error("Gemini Live WebSocket connection failed."));
    socket.onclose = (event) => {
      if (!closed && event.code !== 1000) {
        options.onStatus("Gemini connection closed. Start a new session to reconnect.");
      }
    };
    socket.onopen = async () => {
      try {
        audio = await createAudioEngine(
          (pcm) => {
            if (socket.readyState !== WebSocket.OPEN) return;
            socket.send(
              JSON.stringify({
                realtimeInput: {
                  audio: {
                    mimeType: "audio/pcm;rate=16000",
                    data: bytesToBase64(pcm),
                  },
                },
              }),
            );
          },
          options.onAudioLevel,
        );

        socket.send(
          JSON.stringify({
            setup: {
              model: "models/" + model,
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: options.voice },
                  },
                },
              },
              systemInstruction:
                "You are LifeMate, a warm, capable personal AI companion. " +
                "The selected avatar is " +
                options.avatarName +
                ". Preferred language: " +
                options.language +
                ". Topic: " +
                options.topic +
                ". Tone: " +
                options.tone +
                ". Speak naturally and concisely. Do not mention HeyGen, LiveAvatar, LiveKit, " +
                "or implementation details. The user is speaking to a browser-rendered avatar.",
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              sessionResumption: {},
            },
          }),
        );
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Could not initialize microphone audio."));
      }
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as GeminiMessage;

      if (message.error?.message) {
        options.onStatus(message.error.message);
        return;
      }

      const content = message.serverContent;
      if (!content) {
        if (message.setupComplete) {
          options.onStatus("Connected. You can speak naturally.");
          socket.send(
            JSON.stringify({
              clientContent: {
                turns: [
                  {
                    role: "user",
                    parts: [{ text: "Greet me briefly and ask how you can help today. Use the selected language when appropriate." }],
                  },
                ],
                turnComplete: true,
              },
            }),
          );
        }
        return;
      }

      if (content.interimInputTranscription?.text) options.onTranscript("user", content.interimInputTranscription.text);
      if (content.inputTranscription?.text) options.onTranscript("user", content.inputTranscription.text);
      if (content.outputTranscription?.text) options.onTranscript("assistant", content.outputTranscription.text);

      if (content.interrupted && audio) {
        stopPlayback(audio);
        options.onStatus("Listening…");
      }

      for (const part of content.modelTurn?.parts || []) {
        if (part.inlineData?.data && audio) {
          playPcm(audio, base64ToBytes(part.inlineData.data));
          options.onStatus("LifeMate is speaking…");
        }
      }

      if (content.turnComplete) options.onStatus("Listening…");
    };
  });

  await ready;
  return { close };
}
