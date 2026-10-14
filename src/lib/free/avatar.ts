/** Browser-only. Shows a 3D avatar and makes its mouth follow the audio it is fed. */
import type { FreeAvatar } from "./catalog.ts";

export const OUTPUT_RATE = 24_000;

export type AvatarStage = {
  /** Queue a chunk of 16-bit little-endian PCM (24 kHz mono) for playback + lip-sync. */
  speak: (pcm: Uint8Array) => void;
  /** Tell the avatar no more audio is coming for this reply. */
  endOfReply: () => void;
  /** Cut speech off at once (the person interrupted). */
  interrupt: () => void;
  destroy: () => void;
};

type HeadAudioNode = AudioNode & {
  loadModel: (url: string) => Promise<void>;
  update: (dt: number) => void;
  onvalue: ((key: string, value: number) => void) | null;
};

export async function createAvatarStage(
  container: HTMLElement,
  avatar: FreeAvatar,
  hooks: { onSpeaking: (speaking: boolean) => void; onProgress?: (pct: number) => void },
): Promise<AvatarStage> {
  const { TalkingHead } = await import("@/vendor/talkinghead/talkinghead.mjs");
  const head = new TalkingHead(container, {
    lipsyncModules: [], // lip-sync comes from the audio itself, not from text
    cameraView: "upper",
    cameraRotateEnable: false,
    cameraPanEnable: false,
    cameraZoomEnable: false,
    modelFPS: 30,
    avatarMood: "neutral",
  });

  await head.showAvatar(
    { url: `/avatars/${avatar.glb}`, body: avatar.body ?? "F", lipsyncLang: "en", avatarMood: "neutral" },
    (e: ProgressEvent) => {
      if (e.lengthComputable && hooks.onProgress) hooks.onProgress(Math.round((e.loaded / e.total) * 100));
    },
  );

  let headAudio: HeadAudioNode | null = null;
  let streaming = false;

  const ensureStreaming = async () => {
    if (streaming) return;
    // Starts the playback graph at Gemini's native 24 kHz output rate.
    await head.streamStart(
      { sampleRate: OUTPUT_RATE, lipsyncType: "visemes", waitForAudioChunks: false, gain: 1 },
      () => hooks.onSpeaking(true),
      () => hooks.onSpeaking(false),
    );
    streaming = true;

    // Audio-driven mouth shapes (HeadAudio, MIT). It listens to what the avatar is
    // about to say, so it works in any language and needs no transcript timing.
    try {
      const [{ HeadAudio }, ] = await Promise.all([
        import(/* @vite-ignore */ "/vendor/headaudio/headaudio.min.mjs") as Promise<{
          HeadAudio: new (ctx: AudioContext, opts: object) => HeadAudioNode;
        }>,
        head.audioCtx.audioWorklet.addModule("/vendor/headaudio/headworklet.min.mjs"),
      ]);
      headAudio = new HeadAudio(head.audioCtx, {
        processorOptions: {},
        parameterData: { vadGateActiveDb: -40, vadGateInactiveDb: -60 },
      });
      await headAudio.loadModel("/vendor/headaudio/model-en-mixed.bin");
      head.audioStreamGainNode.connect(headAudio);
      headAudio.onvalue = (key, value) => {
        const target = head.mtAvatar[key];
        if (target) Object.assign(target, { newvalue: value, needsUpdate: true });
      };
      head.opt.update = headAudio.update.bind(headAudio);
    } catch (e) {
      // The avatar still talks and moves; only the detailed mouth shapes are lost.
      console.warn("Lip-sync model unavailable:", e);
    }
  };

  return {
    speak: (pcm) => {
      void ensureStreaming().then(() => {
        const copy = pcm.slice().buffer;
        head.streamAudio({ audio: copy });
      });
    },
    endOfReply: () => {
      if (streaming) head.streamNotifyEnd();
    },
    interrupt: () => {
      if (streaming) head.streamInterrupt();
    },
    destroy: () => {
      try {
        if (streaming) head.streamStop();
        headAudio?.disconnect();
        head.stop();
        head.audioCtx.close().catch(() => undefined);
        container.replaceChildren();
      } catch {
        /* already torn down */
      }
    },
  };
}
