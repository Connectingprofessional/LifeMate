import { createFileRoute } from "@tanstack/react-router";
import { checkServices, json } from "@/lib/selfhost/runtime.server";
import { sessionCount } from "@/lib/selfhost/sessions";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const services = await checkServices();
        return json({ ok: services.every((s) => s.ok), services, sessions: sessionCount() });
      },
    },
  },
});
