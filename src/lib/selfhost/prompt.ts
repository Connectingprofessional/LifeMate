export type Persona = {
  language: string;
  languageLabel: string;
  voice: string;
  tone: string;
  topic: string;
  avatar: string;
};

/**
 * System prompt for the conversation. Output is spoken aloud by a text-to-speech
 * engine, so it must be plain sentences: no markdown, lists, emoji or stage
 * directions.
 */
export function buildSystemPrompt(p: Pick<Persona, "languageLabel" | "tone" | "topic">): string {
  const tone = p.tone.trim().slice(0, 120);
  const topic = (p.topic.trim() || "anything they bring up").slice(0, 300);
  return [
    "You are LifeMate, a live video guide on a two-way call. Your words are spoken aloud.",
    `Speak only in ${p.languageLabel}.`,
    `The person opened the call wanting help with: ${topic}. Follow that, and follow them if they change subject — work, personal life, spirituality, music, business, markets, research, study, or finding a job.`,
    tone ? `Speaking style: ${tone}.` : "Speaking style: warm and direct.",
    "Answer in short spoken turns of one to three sentences, then ask one useful follow-up question.",
    "Use plain sentences only: no lists, headings, markdown, emoji, or stage directions.",
    "You are not a doctor, lawyer, or licensed financial adviser: for health, legal, or money decisions give general context and tell them to confirm with a qualified person.",
    "Never invent live prices, private facts, or breaking news.",
    "/no_think",
  ].join("\n");
}
