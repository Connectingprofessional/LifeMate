import { createFileRoute } from "@tanstack/react-router";
import { ltInterrupt } from "@/lib/selfhost/clients";
import { getSession } from "@/lib/selfhost/sessions";
import { cfg, fail, json, readJson } from "@/lib/selfhost/runtime.server";

export const Route = createFileRoute("/api/interrupt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJson<{ sessionid?: unknown }>(request);
        const session = getSession(typeof body?.sessionid === "string" ? body.sessionid : null);
        if (!session) return fail("This call is no longer active.", 404);
        session.abort?.abort();
        await ltInterrupt(cfg, session.id).catch(() => undefined);
        return json({ ok: true });
      },
    },
  },
});
