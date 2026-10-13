import { createFileRoute } from "@tanstack/react-router";
import { listAvatars } from "@/lib/selfhost/avatars";
import { listVoiceIds } from "@/lib/selfhost/clients";
import { LANGUAGES, TOPICS, describeVoice } from "@/lib/selfhost/languages";
import type { VoiceInfo } from "@/lib/selfhost/languages";
import { cfg, checkServices, json } from "@/lib/selfhost/runtime.server";

export const Route = createFileRoute("/api/catalog")({
  server: {
    handlers: {
      GET: async () => {
        const [services, liveVoices] = await Promise.all([
          checkServices(),
          listVoiceIds(cfg, AbortSignal.timeout(3000)).catch(() => null),
        ]);

        const ids = liveVoices ?? LANGUAGES.flatMap((l) => l.fallbackVoices);
        const voices = ids
          .map(describeVoice)
          .filter((v): v is VoiceInfo => v !== null)
          .sort((a, b) => a.language.localeCompare(b.language) || a.name.localeCompare(b.name));

        const avatars = listAvatars(cfg.avatarsDir).map((a) => ({
          ...a,
          preview_url: a.hasPreview ? `/api/avatar-preview/${encodeURIComponent(a.id)}` : undefined,
        }));

        const warnings = services.filter((s) => !s.ok).map((s) => `${s.name} is ${s.detail}`);
        if (!avatars.length) warnings.push(`No avatars found in ${cfg.avatarsDir}`);

        return json({
          avatars,
          voices,
          languages: LANGUAGES.map(({ code, label }) => ({ code, label })),
          topics: TOPICS,
          iceServers: cfg.iceServers,
          warnings,
        });
      },
    },
  },
});
