import { createServerFn } from "@tanstack/react-start";
import { AVATARS, VOICES } from "@/lib/avatar-catalog";

export type Avatar = {
  id: string;
  name: string;
  preview_url?: string;
  is_expired?: boolean;
  default_voice?: { id?: string };
};

export type Voice = {
  id: string;
  name?: string;
  language?: string;
  gender?: string;
  tags?: string[] | string;
  description?: string;
};

// Compatibility surface retained for existing LifeMate avatar/voice integrations.
// The provider implementation is now local: catalog data is bundled with the app,
// and the call media transport is native WebRTC in avatar-engine.ts.
export const listCatalog = createServerFn({ method: "GET" }).handler(async () => ({
  avatars: AVATARS.map((avatar) => ({
    id: avatar.id,
    name: avatar.name,
    preview_url: avatar.preview_url,
    is_expired: false,
  })) as Avatar[],
  voices: VOICES.map((voice) => ({
    id: voice.id,
    name: voice.name,
    language: voice.language,
    gender: voice.gender,
    tags: voice.tags,
  })) as Voice[],
}));

export type StartInput = {
  language?: string;
  language_name?: string;
  voice_id?: string;
  avatar_id?: string;
  topic?: string;
};

// Kept as a compatibility export so existing callers do not break. New runtime
// sessions are created by the native WebRTC avatar engine instead of a hosted
// avatar provider.
export const startSession = createServerFn({ method: "POST" })
  .validator((data: StartInput) => data)
  .handler(async ({ data }) => {
    if (!data.avatar_id) throw new Error("Pick an avatar before starting the video call.");
    const avatar = AVATARS.find((item) => item.id === data.avatar_id);
    if (!avatar) throw new Error("The selected avatar is unavailable.");
    return {
      session_id: `local-${avatar.id}-${Date.now().toString(36)}`,
      avatar_id: avatar.id,
      voice_id: data.voice_id || "",
      transport: "native-webrtc" as const,
      provider: "local" as const,
    };
  });

export const stopSession = createServerFn({ method: "POST" })
  .validator((data: { session_id?: string }) => data)
  .handler(async () => ({ ok: true }));
