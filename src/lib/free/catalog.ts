/**
 * The catalog for the free (Gemini + in-browser 3D avatar) call.
 *
 * Nothing here comes from a paid vendor: avatars are GLB files served from
 * /avatars, and voices are the prebuilt voices of the Gemini Live API.
 * To add an avatar, put a TalkingHead-compatible .glb in public/avatars and
 * list it in public/avatars/catalog.json (see public/avatars/README.md).
 */
export type GeminiVoice = { id: string; gender: "female" | "male"; tone: string };

// Voice ids are the Gemini prebuilt voice names. Gender and tone labels are
// Google's short descriptions as best known; treat them as hints, not promises.
export const VOICES: GeminiVoice[] = [
  { id: "Zephyr", gender: "female", tone: "Bright" },
  { id: "Puck", gender: "male", tone: "Upbeat" },
  { id: "Charon", gender: "male", tone: "Informative" },
  { id: "Kore", gender: "female", tone: "Firm" },
  { id: "Fenrir", gender: "male", tone: "Excitable" },
  { id: "Leda", gender: "female", tone: "Youthful" },
  { id: "Orus", gender: "male", tone: "Firm" },
  { id: "Aoede", gender: "female", tone: "Breezy" },
  { id: "Callirrhoe", gender: "female", tone: "Easy-going" },
  { id: "Autonoe", gender: "female", tone: "Bright" },
  { id: "Enceladus", gender: "male", tone: "Breathy" },
  { id: "Iapetus", gender: "male", tone: "Clear" },
  { id: "Umbriel", gender: "male", tone: "Easy-going" },
  { id: "Algieba", gender: "male", tone: "Smooth" },
  { id: "Despina", gender: "female", tone: "Smooth" },
  { id: "Erinome", gender: "female", tone: "Clear" },
  { id: "Algenib", gender: "male", tone: "Gravelly" },
  { id: "Rasalgethi", gender: "male", tone: "Informative" },
  { id: "Laomedeia", gender: "female", tone: "Upbeat" },
  { id: "Achernar", gender: "female", tone: "Soft" },
  { id: "Alnilam", gender: "male", tone: "Firm" },
  { id: "Schedar", gender: "male", tone: "Even" },
  { id: "Gacrux", gender: "female", tone: "Mature" },
  { id: "Pulcherrima", gender: "female", tone: "Forward" },
  { id: "Achird", gender: "male", tone: "Friendly" },
  { id: "Zubenelgenubi", gender: "male", tone: "Casual" },
  { id: "Vindemiatrix", gender: "female", tone: "Gentle" },
  { id: "Sadachbia", gender: "male", tone: "Lively" },
  { id: "Sadaltager", gender: "male", tone: "Knowledgeable" },
  { id: "Sulafat", gender: "female", tone: "Warm" },
];

export const VOICE_IDS = new Set(VOICES.map((v) => v.id));

/** The model speaks whichever language it is told to; this is the pick-list. */
export const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "bn", label: "Bengali" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "mr", label: "Marathi" },
  { code: "gu", label: "Gujarati" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "pa", label: "Punjabi" },
  { code: "ur", label: "Urdu" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "ar", label: "Arabic" },
  { code: "ru", label: "Russian" },
  { code: "id", label: "Indonesian" },
  { code: "tr", label: "Turkish" },
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

export type FreeAvatar = {
  id: string;
  name: string;
  /** Path under /avatars/ of a TalkingHead-compatible GLB. */
  glb: string;
  body?: "F" | "M";
  /** Optional still image shown in the picker. */
  preview?: string;
  /** Default Gemini voice for this avatar. */
  voice?: string;
  license?: string;
};

export function languageLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? "English";
}

export function buildSystemPrompt(languageName: string, topic: string): string {
  return [
    "You are LifeMate, a live video guide on a two-way call with one person.",
    `Speak only in ${languageName}. Keep every turn short and spoken: one to three sentences, then one useful follow-up question.`,
    `They opened the call wanting help with: ${topic}. Follow that, and follow them if they change subject: work, personal life, spirituality, music, business, markets, research, study, or finding a job.`,
    "Be warm and direct. You are not a doctor, lawyer or licensed financial adviser: for health, legal or money decisions give general context and tell them to confirm with a qualified person.",
    "Never invent live prices, private facts or breaking news. If you do not know, say so.",
    "Greet them briefly when the call starts.",
  ].join(" ");
}
