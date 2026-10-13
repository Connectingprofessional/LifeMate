import { createFileRoute } from "@tanstack/react-router";
import { ltIsSpeaking } from "@/lib/selfhost/clients";
import { getSession } from "@/lib/selfhost/sessions";
import { cfg, json } from "@/lib/selfhost/runtime.server";

export const Route = createFileRoute("/api/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = getSession(new URL(request.url).searchParams.get("sessionid"));
        if (!session) return json({ active: false, speaking: false, busy: false });
        const speaking = await ltIsSpeaking(cfg, session.id).catch(() => false);
        return json({ active: true, speaking, busy: session.abort !== null });
      },
    },
  },
});
