import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type AvatarInfo = {
  id: string;
  name: string;
  gender: "female" | "male" | "";
  /** Preferred voice id, if the avatar's meta.json names one. */
  voice: string;
  hasPreview: boolean;
};

function previewFile(dir: string, id: string): string | null {
  const imgs = join(dir, id, "full_imgs");
  try {
    const first = readdirSync(imgs)
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .sort()[0];
    return first ? join(imgs, first) : null;
  } catch {
    return null;
  }
}

/**
 * Avatars are folders created by LiveTalking (upload a short video in its
 * /avatar.html page). An optional meta.json beside them can set a display name:
 *   { "name": "Asha", "gender": "female", "voice": "hf_alpha" }
 */
export function listAvatars(dir: string): AvatarInfo[] {
  if (!existsSync(dir)) return [];
  const out: AvatarInfo[] = [];
  for (const id of readdirSync(dir).sort()) {
    const full = join(dir, id);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    let meta: { name?: unknown; gender?: unknown; voice?: unknown } = {};
    try {
      meta = JSON.parse(readFileSync(join(full, "meta.json"), "utf8"));
    } catch {
      /* meta.json is optional */
    }
    const gender = meta.gender === "female" || meta.gender === "male" ? meta.gender : "";
    out.push({
      id,
      name: typeof meta.name === "string" && meta.name ? meta.name : id.replace(/[_-]+/g, " "),
      gender,
      voice: typeof meta.voice === "string" ? meta.voice : "",
      hasPreview: previewFile(dir, id) !== null,
    });
  }
  return out;
}

/** Path of an avatar's preview image; only ids that really exist are accepted. */
export function avatarPreviewPath(dir: string, id: string): string | null {
  if (!listAvatars(dir).some((a) => a.id === id)) return null;
  return previewFile(dir, id);
}
