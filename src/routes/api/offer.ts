import { createFileRoute } from "@tanstack/react-router";
import { listAvatars } from "@/lib/selfhost/avatars";
import { ltOffer } from "@/lib/selfhost/clients";
import { LANGUAGES, TOPICS, describeVoice, findLanguage } from "@/lib/selfhost/languages";
import { createSession } from "@/lib/selfhost/sessions";
import { cfg, fail, json, readJson } from "@/lib/selfhost/runtime.server";

type OfferBody = {
  sdp?: unknown;
  type?: unknown;
  avatar?: unknown;
  language?: unknown;
  voice?: unknown;
  tone?: unknown;
  topic?: unknown;
};

export const Route = createFileRoute("/api/offer")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJson<OfferBody>(request);
        if (!body || typeof body.sdp !== "string" || body.type !== "offer") {
          return fail("Expected a WebRTC offer (sdp + type).");
        }

        const lang = findLanguage(typeof body.language === "string" ? body.language : "en") ?? LANGUAGES[0];

        const avatars = listAvatars(cfg.avatarsDir);
        const avatar = typeof body.avatar === "string" ? body.avatar : "";
        if (avatars.length && !avatars.some((a) => a.id === avatar)) {
          return fail("Pick one of the avatars from the list.");
        }

        // The voice must speak the chosen language, otherwise fall back to its first voice.
        const requested = typeof body.voice === "string" ? describeVoice(body.voice) : null;
        const voice = requested && requested.language === lang.code ? requested.id : lang.fallbackVoices[0];

        const topic = typeof body.topic === "string" ? body.topic.slice(0, 300) : TOPICS[0];
        const tone = typeof body.tone === "string" ? body.tone.slice(0, 120) : "";

        try {
          const answer = await ltOffer(cfg, { sdp: body.sdp, type: "offer", avatar: avatar || undefined });
          createSession(answer.sessionid, {
            language: lang.code,
            languageLabel: lang.label,
            voice,
            tone,
            topic,
            avatar,
          });
          return json(answer);
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Could not start the call.", 502);
        }
      },
    },
  },
});
