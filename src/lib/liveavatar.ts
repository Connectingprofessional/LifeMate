import { createServerFn } from "@tanstack/react-start";

const API = "https://api.liveavatar.com/v1";

function apiKey() {
  const key = process.env.LIVEAVATAR_API_KEY;
  if (!key) throw new Error("LIVEAVATAR_API_KEY is not set");
  return key;
}

export type Avatar = {
  id: string;
  name: string;
  preview_url?: string;
  is_expired?: boolean;
  default_voice?: { id?: string };
};

export type Voice = {
  id: string;
  name?: string;
  language?: string;
  gender?: string;
  tags?: string[] | string;
  description?: string;
};

async function la(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("X-API-KEY", apiKey());
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const r = await fetch(API + path, { ...init, headers });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const detail =
      typeof data.message === "string"
        ? data.message
        : typeof data.error === "string"
          ? data.error
          : JSON.stringify(data).slice(0, 400);
    throw new Error(detail || `LiveAvatar ${r.status}`);
  }
  return data;
}

function results(data: Record<string, unknown>): unknown[] {
  const inner = (data.data ?? data) as { results?: unknown[] };
  return Array.isArray(inner?.results) ? inner.results : [];
}

export const listCatalog = createServerFn({ method: "GET" }).handler(async () => {
  const headers = { "X-API-KEY": apiKey() };
  const get = (path: string) =>
    fetch(API + path + "?page_size=100", { headers })
      .then((r) => r.json())
      .catch(() => ({}));

  const [pub, mine] = await Promise.all([get("/avatars/public"), get("/avatars")]);
  const avatars = [...results(pub as Record<string, unknown>), ...results(mine as Record<string, unknown>)]
    .filter((a) => a && typeof a === "object" && !(a as Avatar).is_expired) as Avatar[];

  const voices: Voice[] = [];
  for (let page = 1; page <= 5; page++) {
    const q = new URLSearchParams({ page: String(page), page_size: "100", voice_type: "public" });
    const r = await fetch(API + "/voices?" + q, { headers });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new Error(JSON.stringify(d).slice(0, 300));
    const batch = results(d) as Voice[];
    voices.push(...batch);
    const inner = (d.data ?? {}) as { next?: unknown };
    if (!inner.next || !batch.length) break;
  }

  return { avatars, voices };
});

type StartInput = {
  language?: string;
  language_name?: string;
  voice_id?: string;
  avatar_id?: string;
  topic?: string;
};

const GUIDE_NAME = "LifeMate Guide";
const GUIDE_PROMPT = `You are LifeMate, a live video guide on a two-way call. Speak only in \${language_name}. The person opened the call wanting help with: \${topic}. Follow that, and also follow them if they change subject — work, personal life, spirituality, music, business, markets, research, study, or finding a job. Listen, answer in short spoken turns, and ask one useful follow-up. Be warm and direct. You are not a doctor, lawyer, or licensed financial adviser: for health, legal, or money decisions give general context and tell them to confirm with a qualified person. Never invent live prices, private facts, or breaking news.`;

async function guideContextId() {
  const listed = await fetch(API + "/contexts?page_size=100", { headers: { "X-API-KEY": apiKey() } })
    .then((r) => r.json())
    .catch(() => ({}));
  const found = (results(listed as Record<string, unknown>) as { id?: string; name?: string }[]).find(
    (c) => c.name === GUIDE_NAME && c.id,
  );
  if (found?.id) {
    await la("/contexts/" + found.id, {
      method: "PATCH",
      body: JSON.stringify({
        name: GUIDE_NAME,
        prompt: GUIDE_PROMPT,
        opening_text: "Hello. I can see you are here. What would you like to talk through?",
      }),
    }).catch(() => undefined);
    return found.id;
  }
  const created = await la("/contexts", {
    method: "POST",
    body: JSON.stringify({
      name: GUIDE_NAME,
      prompt: GUIDE_PROMPT,
      opening_text: "Hello. I can see you are here. What would you like to talk through?",
    }),
  });
  const id = (created.data as { id?: string } | undefined)?.id;
  if (!id) throw new Error("Could not prepare the avatar's conversation guide");
  return id;
}

export const startSession = createServerFn({ method: "POST" })
  .validator((data: StartInput) => data)
  .handler(async ({ data }) => {
    if (!data.avatar_id) throw new Error("Pick an avatar before starting the video call.");
    const context_id = await guideContextId();
    const persona: Record<string, string> = {
      language: data.language || "en",
      context_id,
    };
    if (data.voice_id) persona.voice_id = data.voice_id;
    const body = {
      mode: "FULL",
      avatar_id: data.avatar_id,
      interactivity_type: "CONVERSATIONAL",
      video_settings: { quality: "high", encoding: "H264" },
      avatar_persona: persona,
      dynamic_variables: {
        language_name: (data.language_name || "English").slice(0, 80),
        topic: (data.topic || "anything they bring up").slice(0, 900),
      },
    };
    let sandbox = false;
    let tokenRes: Record<string, unknown>;
    try {
      tokenRes = await la("/sessions/token", {
        method: "POST",
        body: JSON.stringify({ ...body, is_sandbox: false }),
      });
    } catch {
      sandbox = true;
      tokenRes = await la("/sessions/token", {
        method: "POST",
        body: JSON.stringify({ ...body, is_sandbox: true }),
      });
    }
    const tokenData = tokenRes.data as { session_token?: string; session_id?: string };
    if (!tokenData?.session_token) throw new Error("LiveAvatar did not return a session token");
    const start = await fetch(API + "/sessions/start", {
      method: "POST",
      headers: { authorization: "Bearer " + tokenData.session_token },
    });
    const sj = (await start.json().catch(() => ({}))) as {
      data?: { livekit_url?: string; livekit_client_token?: string };
      message?: string;
    };
    if (!start.ok || !sj.data?.livekit_url || !sj.data.livekit_client_token) {
      throw new Error(sj.message || "Could not start the LiveAvatar session");
    }
    return {
      session_id: tokenData.session_id || "",
      livekit_url: sj.data.livekit_url,
      token: sj.data.livekit_client_token,
      sandbox,
    };
  });

export const stopSession = createServerFn({ method: "POST" })
  .validator((data: { session_id?: string }) => data)
  .handler(async ({ data }) => {
    if (!data.session_id) return { ok: true };
    await fetch(API + "/sessions/stop", {
      method: "POST",
      headers: { "X-API-KEY": apiKey(), "content-type": "application/json" },
      body: JSON.stringify({ session_id: data.session_id, reason: "USER_CLOSED" }),
    }).catch(() => undefined);
    return { ok: true };
  });
