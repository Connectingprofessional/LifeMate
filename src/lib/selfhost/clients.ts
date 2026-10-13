import type { SelfhostConfig } from "./config.ts";
import { pcmToWav } from "./wav.ts";

export class ServiceError extends Error {
  service: string;
  constructor(service: string, message: string) {
    super(`${service}: ${message}`);
    this.service = service;
  }
}

async function call(service: string, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (init.signal?.aborted) throw e;
    const why = e instanceof Error ? e.message : String(e);
    throw new ServiceError(service, `cannot reach ${url} (${why}). Is the container running?`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new ServiceError(service, `HTTP ${res.status} from ${url}${body ? ` — ${body}` : ""}`);
  }
  return res;
}

// ───────────────────────── speech to text ─────────────────────────

export async function transcribe(
  cfg: SelfhostConfig,
  wav: Uint8Array,
  language: string,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([wav as BlobPart], { type: "audio/wav" }), "speech.wav");
  form.append("model", cfg.sttModel);
  form.append("language", language);
  form.append("response_format", "json");
  form.append("temperature", "0");
  const res = await call("Speech-to-text", `${cfg.sttBaseUrl}/audio/transcriptions`, {
    method: "POST",
    body: form,
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as { text?: unknown };
  return typeof data.text === "string" ? data.text.trim() : "";
}

// ───────────────────────────── language model ─────────────────────────────

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Streams the model's answer as text pieces (OpenAI-compatible server-sent events). */
export async function* chatStream(
  cfg: SelfhostConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const res = await call("Language model", `${cfg.llmBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.llmApiKey}`,
    },
    body: JSON.stringify({
      model: cfg.llmModel,
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 400,
    }),
    signal,
  });
  if (!res.body) throw new ServiceError("Language model", "empty response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const piece = json.choices?.[0]?.delta?.content;
          if (piece) yield piece;
        } catch {
          /* ignore keep-alive or partial lines */
        }
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

// ───────────────────────────── text to speech ─────────────────────────────

/** Returns a WAV file of the spoken text. */
export async function synthesize(
  cfg: SelfhostConfig,
  text: string,
  voice: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const res = await call("Text-to-speech", `${cfg.ttsBaseUrl}/audio/speech`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: cfg.ttsModel, input: text, voice, response_format: "pcm" }),
    signal,
  });
  const pcm = new Uint8Array(await res.arrayBuffer());
  if (pcm.length < 2) throw new ServiceError("Text-to-speech", "returned no audio");
  // Raw PCM + our own header: streamed WAV headers carry bogus lengths.
  return pcmToWav(pcm, cfg.ttsSampleRate);
}

export async function listVoiceIds(cfg: SelfhostConfig, signal?: AbortSignal): Promise<string[]> {
  const res = await call("Text-to-speech", `${cfg.ttsBaseUrl}/audio/voices`, { signal });
  const data = (await res.json().catch(() => ({}))) as unknown;
  const list = Array.isArray(data) ? data : ((data as { voices?: unknown }).voices ?? []);
  return Array.isArray(list)
    ? list.map((v) => (typeof v === "string" ? v : (v as { id?: string; name?: string })?.id ?? (v as { name?: string })?.name)).filter((v): v is string => typeof v === "string")
    : [];
}

// ───────────────────────── avatar video (LiveTalking) ─────────────────────────

type LtReply = { code?: number; msg?: string; data?: unknown };

async function ltJson(cfg: SelfhostConfig, path: string, body: unknown, signal?: AbortSignal): Promise<LtReply> {
  const res = await call("Avatar video", `${cfg.liveTalkingUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const reply = (await res.json().catch(() => ({}))) as LtReply;
  if (typeof reply.code === "number" && reply.code !== 0) {
    throw new ServiceError("Avatar video", reply.msg || `request ${path} failed`);
  }
  return reply;
}

export async function ltOffer(
  cfg: SelfhostConfig,
  offer: { sdp: string; type: string; avatar?: string },
): Promise<{ sdp: string; type: string; sessionid: string }> {
  const res = await call("Avatar video", `${cfg.liveTalkingUrl}/offer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(offer),
  });
  const data = (await res.json().catch(() => ({}))) as {
    sdp?: string;
    type?: string;
    sessionid?: string | number;
    code?: number;
    msg?: string;
  };
  if (!data.sdp || data.sessionid === undefined) {
    throw new ServiceError("Avatar video", data.msg || "the avatar server refused the call (no free session?)");
  }
  return { sdp: data.sdp, type: data.type || "answer", sessionid: String(data.sessionid) };
}

export async function ltSendAudio(
  cfg: SelfhostConfig,
  sessionid: string,
  wav: Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  const form = new FormData();
  form.append("sessionid", sessionid);
  form.append("file", new Blob([wav as BlobPart], { type: "audio/wav" }), "reply.wav");
  const res = await call("Avatar video", `${cfg.liveTalkingUrl}/humanaudio`, {
    method: "POST",
    body: form,
    signal,
  });
  const reply = (await res.json().catch(() => ({}))) as LtReply;
  if (typeof reply.code === "number" && reply.code !== 0) {
    throw new ServiceError("Avatar video", reply.msg || "could not play the reply");
  }
}

export async function ltInterrupt(cfg: SelfhostConfig, sessionid: string): Promise<void> {
  await ltJson(cfg, "/interrupt_talk", { sessionid });
}

export async function ltIsSpeaking(cfg: SelfhostConfig, sessionid: string): Promise<boolean> {
  const reply = await ltJson(cfg, "/is_speaking", { sessionid });
  return reply.data === true;
}
