import { createFileRoute } from "@tanstack/react-router";
import { getSession } from "@/lib/selfhost/sessions";
import { runTurn } from "@/lib/selfhost/turn";
import type { TurnInput } from "@/lib/selfhost/turn";
import { cfg, fail } from "@/lib/selfhost/runtime.server";

/**
 * One spoken turn. Send the person's speech as audio/wav (or {"text": "..."} as JSON);
 * the reply streams back as newline-delimited JSON events while the avatar speaks.
 */
export const Route = createFileRoute("/api/turn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const sessionid = new URL(request.url).searchParams.get("sessionid");
        const session = getSession(sessionid);
        if (!session) return fail("This call is no longer active. Start a new call.", 404);

        let input: TurnInput;
        const type = request.headers.get("content-type") ?? "";
        if (type.includes("application/json")) {
          const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
          if (!body || typeof body.text !== "string") return fail('Expected {"text": "..."}.');
          input = { text: body.text };
        } else {
          const buf = new Uint8Array(await request.arrayBuffer());
          if (!buf.length) return fail("No audio received.");
          if (buf.length > cfg.maxAudioBytes) return fail("That recording is too long.", 413);
          input = { wav: buf };
        }

        const encoder = new TextEncoder();
        const events = runTurn(cfg, session, input);
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const { value, done } = await events.next();
            if (done) controller.close();
            else controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
          },
          async cancel() {
            await events.return(undefined);
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "application/x-ndjson",
            "cache-control": "no-store",
            "x-accel-buffering": "no",
          },
        });
      },
    },
  },
});
