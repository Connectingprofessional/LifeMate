import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createFileRoute } from "@tanstack/react-router";
import { avatarPreviewPath } from "@/lib/selfhost/avatars";
import { cfg } from "@/lib/selfhost/runtime.server";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export const Route = createFileRoute("/api/avatar-preview/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const file = avatarPreviewPath(cfg.avatarsDir, params.id);
        if (!file) return new Response("Not found", { status: 404 });
        const data = await readFile(file);
        return new Response(data, {
          headers: {
            "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
