// Minimal typings for the vendored TalkingHead library (MIT, see ./LICENSE).
// The library is plain JavaScript; only the surface LifeMate uses is typed.
/* eslint-disable @typescript-eslint/no-explicit-any */
export class TalkingHead {
  constructor(node: HTMLElement, opt?: Record<string, unknown>);
  audioCtx: AudioContext;
  audioStreamGainNode: GainNode;
  mtAvatar: Record<string, { newvalue?: number; needsUpdate?: boolean }>;
  opt: Record<string, any>;
  showAvatar(avatar: Record<string, unknown>, onprogress?: ((e: ProgressEvent) => void) | null): Promise<void>;
  streamStart(
    opt?: Record<string, unknown>,
    onAudioStart?: (() => void) | null,
    onAudioEnd?: (() => void) | null,
    onSubtitles?: ((s: string) => void) | null,
    onMetrics?: ((m: unknown) => void) | null,
  ): Promise<void>;
  streamAudio(r: { audio?: ArrayBuffer | Int16Array | Uint8Array | Float32Array }): void;
  streamNotifyEnd(): void;
  streamInterrupt(): void;
  streamStop(): void;
  setMood(mood: string): void;
  lookAtCamera(ms: number): void;
  speakWithHands(delay?: number, prob?: number): void;
  start(): void;
  stop(): void;
  [key: string]: any;
}
