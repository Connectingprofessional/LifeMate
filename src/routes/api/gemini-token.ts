import { createFileRoute } from "@tanstack/react-router";

const MODEL = process.env.GEMINI_LIVE_MODEL?.trim() || "gemini-3.8-live";

export const Route = createFileRoute("/api/gemini-token")({
  server: {
    handlers: {
      POST: async () => {
        const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
        if (!apiKey) {
          return Response.json(
            { error: "GEMINI_API_KEY is not configured on the server." },
            { status: 503 },
          );
        }

        const now = Date.now();
        const response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              uses: 1,
              expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
              newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
            }),
          },
        );

        const data = (await response.json()) as {
          name?: string;
          error?: { message?: string };
        };

        if (!response.ok || !data.name) {
          return Response.json(
            { error: data.error?.message || "Gemini did not issue an ephemeral token." },
            { status: response.status || 502 },
          );
        }

        return Response.json({
          token: data.name,
          model: MODEL,
          expiresInSeconds: 1800,
        });
      },
    },
  },
});
