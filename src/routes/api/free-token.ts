import { createFileRoute } from "@tanstack/react-router";
import { GoogleGenAI, Modality } from "@google/genai";
import { VOICE_IDS, buildSystemPrompt, languageLabel, TOPICS } from "@/lib/free/catalog";

/**
 * Hands the browser a short-lived, single-use Gemini token so the call talks to
 * Google directly and the real GEMINI_API_KEY never leaves the server.
 */
const MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live";
const MAX_TOKENS_PER_HOUR_PER_IP = Number(process.env.FREE_MAX_CALLS_PER_HOUR || 20);

const hits = new Map<string, number[]>();

function allowed(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= MAX_TOKENS_PER_HOUR_PER_IP) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return true;
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/free-token")({
  server: {
    handlers: {
      GET: async () => reply({ configured: Boolean(process.env.GEMINI_API_KEY), model: MODEL }),
      POST: async ({ request }) => {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          return reply({ error: "The free call is not set up yet: GEMINI_API_KEY is missing on the server." }, 503);
        }
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
        if (!allowed(ip)) return reply({ error: "Too many calls started from this network. Try again in a while." }, 429);

        let input: { language?: string; languageName?: string; voice?: string; topic?: string } = {};
        try {
          input = await request.json();
        } catch {
          /* defaults below */
        }
        const voice = input.voice && VOICE_IDS.has(input.voice) ? input.voice : "Kore";
        const topic = TOPICS.includes(input.topic ?? "") ? (input.topic as string) : "Anything";
        const named = (input.languageName ?? "").replace(/[^\p{L} -]/gu, "").trim().slice(0, 40);
        const language = named || languageLabel(input.language ?? "en");

        const config = {
          responseModalities: [Modality.AUDIO],
          systemInstruction: buildSystemPrompt(language, topic),
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          sessionResumption: {},
        };

        const now = Date.now();
        // The token is single-use and locked to this exact model and config, so a
        // leaked token cannot be turned into a different (more expensive) request.
        const make = (apiVersion: string) =>
          new GoogleGenAI({ apiKey, httpOptions: { apiVersion } }).authTokens.create({
            config: {
              uses: 1,
              expireTime: new Date(now + 30 * 60_000).toISOString(),
              newSessionExpireTime: new Date(now + 60_000).toISOString(),
              liveConnectConstraints: { model: MODEL, config },
              httpOptions: { apiVersion },
            },
          });
        try {
          let token;
          try {
            token = await make("v1beta");
          } catch {
            token = await make("v1alpha");
          }
          if (!token.name) return reply({ error: "Gemini did not return a token." }, 502);
          return reply({ token: token.name, model: MODEL, voice, language, topic });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return reply({ error: `Gemini refused to start a call: ${message.slice(0, 300)}` }, 502);
        }
      },
    },
  },
});
