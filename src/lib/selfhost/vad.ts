/**
 * Decides when the person starts and stops talking, from short loudness
 * readings. The "quiet" level adapts to the room, so a fan or street noise
 * does not count as speech.
 */
export type VadEvent = "start" | "end" | null;

export type VadOptions = {
  /** Loudness must stay up this long before speech is declared. */
  startMs: number;
  /** Silence this long ends the utterance. */
  endMs: number;
  /** How far above the room's noise floor counts as speech. */
  ratio: number;
  /** Never treat anything quieter than this as speech. */
  minRms: number;
};

export const DEFAULT_VAD: VadOptions = { startMs: 120, endMs: 800, ratio: 3, minRms: 0.015 };

export class Vad {
  private noise = 0.004;
  private speaking = false;
  private loudMs = 0;
  private quietMs = 0;
  private readonly o: VadOptions;

  constructor(options: Partial<VadOptions> = {}) {
    this.o = { ...DEFAULT_VAD, ...options };
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  reset(): void {
    this.speaking = false;
    this.loudMs = 0;
    this.quietMs = 0;
  }

  process(rms: number, dtMs: number): VadEvent {
    const threshold = Math.max(this.o.minRms, this.noise * this.o.ratio);
    if (!this.speaking) {
      if (rms > threshold) {
        this.loudMs += dtMs;
        if (this.loudMs >= this.o.startMs) {
          this.speaking = true;
          this.loudMs = 0;
          this.quietMs = 0;
          return "start";
        }
      } else {
        this.loudMs = 0;
        this.noise = this.noise * 0.95 + rms * 0.05;
      }
      return null;
    }
    // Hysteresis: once talking, a softer level still counts as talking.
    if (rms > threshold * 0.6) {
      this.quietMs = 0;
    } else {
      this.quietMs += dtMs;
      if (this.quietMs >= this.o.endMs) {
        this.speaking = false;
        this.quietMs = 0;
        return "end";
      }
    }
    return null;
  }
}
