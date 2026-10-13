/**
 * Turns a streaming LLM answer into speakable sentences.
 *
 * - drops <think>...</think> blocks some models emit before answering
 * - cuts at sentence ends (including the Hindi danda and CJK punctuation)
 * - cleans markdown and emoji so the voice does not read symbols aloud
 */

const OPEN = "<think>";
const CLOSE = "</think>";
const STRONG = new Set(["!", "?", "।", "。", "！", "？", "\n"]);

export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [label](url) -> label
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[`*_#>~|]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function partialPrefixLength(s: string, tag: string): number {
  const max = Math.min(s.length, tag.length - 1);
  for (let n = max; n > 0; n--) {
    if (tag.startsWith(s.slice(s.length - n))) return n;
  }
  return 0;
}

export class SentenceChunker {
  private raw = "";
  private pending = "";
  private inThink = false;
  private emitted = 0;
  /** Shortest stretch worth speaking alone; stops "Dr." or "1." becoming a sentence. */
  private readonly sentenceMin = 6;
  /** Only the first sentence may be cut at a comma, so the avatar starts talking sooner. */
  private readonly commaMin = 24;

  /** Feed streamed text; returns any sentences that are now complete. */
  push(chunk: string): string[] {
    this.raw += chunk;
    this.consumeRaw(false);
    return this.cut(false);
  }

  /** Call once the stream ends; returns whatever is left. */
  flush(): string[] {
    this.consumeRaw(true);
    return this.cut(true);
  }

  private consumeRaw(final: boolean) {
    for (;;) {
      if (this.inThink) {
        const end = this.raw.indexOf(CLOSE);
        if (end === -1) {
          if (final) this.raw = "";
          else this.raw = this.raw.slice(Math.max(0, this.raw.length - CLOSE.length));
          return;
        }
        this.raw = this.raw.slice(end + CLOSE.length);
        this.inThink = false;
        continue;
      }
      const start = this.raw.indexOf(OPEN);
      if (start === -1) {
        const keep = final ? 0 : partialPrefixLength(this.raw, OPEN);
        this.pending += this.raw.slice(0, this.raw.length - keep);
        this.raw = this.raw.slice(this.raw.length - keep);
        return;
      }
      this.pending += this.raw.slice(0, start);
      this.raw = this.raw.slice(start + OPEN.length);
      this.inThink = true;
    }
  }

  private cut(final: boolean): string[] {
    const out: string[] = [];
    for (;;) {
      const idx = this.findBoundary(final);
      if (idx === -1) break;
      const sentence = sanitizeForSpeech(this.pending.slice(0, idx + 1));
      this.pending = this.pending.slice(idx + 1);
      if (sentence) {
        out.push(sentence);
        this.emitted++;
      }
    }
    if (final) {
      const rest = sanitizeForSpeech(this.pending);
      this.pending = "";
      if (rest) out.push(rest);
    }
    return out;
  }

  private findBoundary(final: boolean): number {
    const s = this.pending;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      const next = s[i + 1];
      const len = sanitizeForSpeech(s.slice(0, i + 1)).length;
      const long = len >= this.sentenceMin;
      if (STRONG.has(c)) {
        if (long || c === "\n") return i;
        continue;
      }
      if (c === "." && long) {
        // "3.5" and "e.g." must not split; a real stop is followed by whitespace.
        if (next !== undefined && /\s/.test(next)) return i;
        if (next === undefined && final) return i;
      }
      if (this.emitted === 0 && (c === "," || c === "，" || c === ";") && len >= this.commaMin && next !== undefined && /\s|\P{ASCII}/u.test(next)) {
        return i;
      }
    }
    return -1;
  }
}
