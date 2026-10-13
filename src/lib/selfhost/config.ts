/**
 * Runtime configuration for the self-hosted stack. Every service is reached
 * over plain HTTP on the server's own network, so nothing leaves the machine.
 * All values come from environment variables (see deploy/.env.example).
 */
export type SelfhostConfig = {
  /** LiveTalking (avatar video over WebRTC). */
  liveTalkingUrl: string;
  /** OpenAI-compatible chat endpoint (Ollama, vLLM, llama.cpp ...), incl. /v1. */
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
  /** OpenAI-compatible speech-to-text endpoint (speaches, whisper.cpp ...), incl. /v1. */
  sttBaseUrl: string;
  sttModel: string;
  /** OpenAI-compatible text-to-speech endpoint (Kokoro-FastAPI ...), incl. /v1. */
  ttsBaseUrl: string;
  ttsModel: string;
  /** Sample rate of the raw PCM the TTS service returns. */
  ttsSampleRate: number;
  /** Folder that holds LiveTalking avatars (the same folder LiveTalking reads). */
  avatarsDir: string;
  /** WebRTC ICE servers handed to the browser (add a TURN server here). */
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
  /** Number of past messages sent to the model. */
  maxHistory: number;
  /** Largest audio upload accepted for one spoken turn. */
  maxAudioBytes: number;
  /** Idle sessions are forgotten after this long. */
  sessionTtlMs: number;
};

type Env = Record<string, string | undefined>;

function str(env: Env, key: string, fallback: string): string {
  const v = env[key]?.trim();
  return v ? v : fallback;
}

function num(env: Env, key: string, fallback: number): number {
  const n = Number(env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function loadConfig(env: Env = process.env): SelfhostConfig {
  let iceServers: SelfhostConfig["iceServers"] = [];
  const raw = env.ICE_SERVERS_JSON?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) iceServers = parsed;
    } catch {
      console.error("[selfhost] ICE_SERVERS_JSON is not valid JSON — ignoring it");
    }
  }
  return {
    liveTalkingUrl: trimSlash(str(env, "LIVETALKING_URL", "http://127.0.0.1:8010")),
    llmBaseUrl: trimSlash(str(env, "LLM_BASE_URL", "http://127.0.0.1:11434/v1")),
    llmModel: str(env, "LLM_MODEL", "qwen3:8b"),
    llmApiKey: str(env, "LLM_API_KEY", "ollama"),
    sttBaseUrl: trimSlash(str(env, "STT_BASE_URL", "http://127.0.0.1:8000/v1")),
    sttModel: str(env, "STT_MODEL", "Systran/faster-whisper-large-v3"),
    ttsBaseUrl: trimSlash(str(env, "TTS_BASE_URL", "http://127.0.0.1:8880/v1")),
    ttsModel: str(env, "TTS_MODEL", "kokoro"),
    ttsSampleRate: num(env, "TTS_SAMPLE_RATE", 24000),
    avatarsDir: str(env, "AVATARS_DIR", "./data/avatars"),
    iceServers,
    maxHistory: num(env, "MAX_HISTORY", 12),
    maxAudioBytes: num(env, "MAX_AUDIO_BYTES", 8 * 1024 * 1024),
    sessionTtlMs: num(env, "SESSION_TTL_MS", 30 * 60 * 1000),
  };
}
