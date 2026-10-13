/**
 * Languages the default stack can both understand (Whisper) and speak
 * (Kokoro). Kokoro picks the language from the first letter of a voice name,
 * so a language is "speakable" only if the TTS service has voices for it.
 *
 * To add a language, run a TTS server that has voices for it, add a row here,
 * and point TTS_BASE_URL at it.
 */
export type Language = {
  /** Whisper / ISO 639-1 code sent to speech-to-text. */
  code: string;
  label: string;
  /** First letters of the TTS voice names that speak this language. */
  voicePrefixes: string[];
  /** Used when the TTS service cannot list its voices. */
  fallbackVoices: string[];
};

export const LANGUAGES: Language[] = [
  { code: "en", label: "English", voicePrefixes: ["a", "b"], fallbackVoices: ["af_heart", "af_bella", "am_adam", "bf_emma", "bm_george"] },
  { code: "hi", label: "Hindi", voicePrefixes: ["h"], fallbackVoices: ["hf_alpha", "hf_beta", "hm_omega", "hm_psi"] },
  { code: "es", label: "Spanish", voicePrefixes: ["e"], fallbackVoices: ["ef_dora", "em_alex"] },
  { code: "fr", label: "French", voicePrefixes: ["f"], fallbackVoices: ["ff_siwis"] },
  { code: "it", label: "Italian", voicePrefixes: ["i"], fallbackVoices: ["if_sara", "im_nicola"] },
  { code: "pt", label: "Portuguese", voicePrefixes: ["p"], fallbackVoices: ["pf_dora", "pm_alex"] },
  { code: "ja", label: "Japanese", voicePrefixes: ["j"], fallbackVoices: ["jf_alpha", "jm_kumo"] },
  { code: "zh", label: "Chinese", voicePrefixes: ["z"], fallbackVoices: ["zf_xiaobei", "zm_yunjian"] },
];

export const TOPICS = [
  "Anything",
  "Professional",
  "Personal",
  "Spiritual",
  "Music",
  "Business",
  "Markets",
  "Research",
  "Education",
  "Job search",
];

export function findLanguage(code: string | undefined): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

export type VoiceInfo = {
  id: string;
  name: string;
  gender: "female" | "male" | "";
  language: string;
};

/** Describe a Kokoro-style voice id such as "hf_alpha" (Hindi, female, "Alpha"). */
export function describeVoice(id: string): VoiceInfo | null {
  const m = /^([a-z])([fm])_(.+)$/.exec(id);
  if (!m) return null;
  const lang = LANGUAGES.find((l) => l.voicePrefixes.includes(m[1]));
  if (!lang) return null;
  const name = m[3].replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  return { id, name, gender: m[2] === "f" ? "female" : "male", language: lang.code };
}

export function voicesForLanguage(code: string, ids: string[]): VoiceInfo[] {
  return ids
    .map(describeVoice)
    .filter((v): v is VoiceInfo => v !== null && v.language === code);
}
