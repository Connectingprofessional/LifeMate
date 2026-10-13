import { createFileRoute } from "@tanstack/react-router";
import { removeSession } from "@/lib/selfhost/sessions";
import { json, readJson } from "@/lib/selfhost/runtime.server";

export const Route = createFileRoute("/api/stop")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJson<{ sessionid?: unknown }>(request);
        if (typeof body?.sessionid === "string") removeSession(body.sessionid);
        return json({ ok: true });
      },
    },
  },
});
