import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Mic, MicOff, PhoneOff, Sparkles, UserRound, Video } from "lucide-react";
import { AVATARS, FreeGeminiAvatar } from "@/lib/free-gemini-avatar";
import { startGeminiSession, type GeminiSession } from "@/lib/free-gemini";

export const Route = createFileRoute("/")({ component: Home });

const LANGS = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "bn", label: "Bengali" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "ur", label: "Urdu" },
  { value: "ar", label: "Arabic" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "it", label: "Italian" },
  { value: "nl", label: "Dutch" },
  { value: "pl", label: "Polish" },
  { value: "ru", label: "Russian" },
  { value: "tr", label: "Turkish" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "id", label: "Indonesian" },
  { value: "vi", label: "Vietnamese" },
  { value: "th", label: "Thai" },
  { value: "sv", label: "Swedish" },
];

const TOPICS = [
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

const VOICES = [
  ["Zephyr", "Bright"], ["Puck", "Upbeat"], ["Charon", "Informative"], ["Kore", "Firm"],
  ["Fenrir", "Excitable"], ["Leda", "Youthful"], ["Orus", "Firm"], ["Aoede", "Breezy"],
  ["Callirrhoe", "Easy-going"], ["Autonoe", "Bright"], ["Enceladus", "Breathy"], ["Iapetus", "Clear"],
  ["Umbriel", "Easy-going"], ["Algieba", "Smooth"], ["Despina", "Smooth"], ["Erinome", "Clear"],
  ["Algenib", "Gravelly"], ["Rasalgethi", "Informative"], ["Laomedeia", "Upbeat"], ["Achernar", "Soft"],
  ["Alnilam", "Firm"], ["Schedar", "Even"], ["Gacrux", "Mature"], ["Pulcherrima", "Forward"],
  ["Achird", "Friendly"], ["Zubenelgenubi", "Casual"], ["Vindemiatrix", "Gentle"],
  ["Sadachbia", "Lively"], ["Sadaltager", "Knowledgeable"], ["Sulafat", "Warm"],
] as const;

type CatalogAvatar = {
  id: string;
  name: string;
  presetId: string;
};

function Home() {
  const [avatars, setAvatars] = useState<CatalogAvatar[]>([]);
  const [voices, setVoices] = useState<Array<{ id: string; name: string; quality: string }>>([]);
  const [avatarId, setAvatarId] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [lang, setLang] = useState("en");
  const [gender, setGender] = useState("");
  const [tone, setTone] = useState("");
  const [topic, setTopic] = useState("Anything");
  const [status, setStatus] = useState("Load avatars, then start a video call.");
  const [busy, setBusy] = useState<"load" | "start" | null>(null);
  const [live, setLive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speakingLevel, setSpeakingLevel] = useState(0);
  const [session, setSession] = useState<GeminiSession | null>(null);

  const selected = avatars.find((a) => a.id === avatarId);
  const selectedPreset = AVATARS.find((a) => a.id === selected?.presetId) || AVATARS[0];

  const filtered = useMemo(() => {
    const label = LANGS.find((l) => l.value === lang)?.label.toLowerCase() ?? "";
    const q = tone.trim().toLowerCase();
    const match = voices.filter((v) => {
      const blob = v.name.toLowerCase() + " " + v.quality.toLowerCase();
      const langOk = !label || blob.includes(label) || !q;
      const toneOk = !q || blob.includes(q);
      return langOk && toneOk;
    });
    return match.length ? match : voices;
  }, [voices, lang, tone]);

  function load() {
    setBusy("load");
    setStatus("Loading the LifeMate avatar and voice catalog…");
    const localAvatars = AVATARS.map((a) => ({ id: a.id, name: a.name, presetId: a.id }));
    const localVoices = VOICES.map(([name, quality]) => ({ id: name, name, quality }));
    setAvatars(localAvatars);
    setVoices(localVoices);
    setAvatarId((current) => current || localAvatars[0]?.id || "");
    setVoiceId((current) => current || localVoices.find((v) => v.id === "Aoede")?.id || localVoices[0]?.id || "");
    setStatus(`${localAvatars.length} avatars · ${localVoices.length} voices. Pick a face, then start.`);
    setBusy(null);
  }

  async function end(auto = false, message?: string) {
    const active = session;
    setSession(null);
    try {
      active?.close();
    } catch {
      /* already closed */
    }
    setLive(false);
    setMuted(false);
    setSpeakingLevel(0);
    setStatus(message ?? (auto ? "The call ended." : "Ended."));
  }

  async function start() {
    setBusy("start");
    setStatus("Opening the video call… allow the microphone when asked.");
    try {
      if (!avatarId) throw new Error("Pick an avatar first. Load the list if it is empty.");
      const voice = voiceId || "Aoede";
      const langName = LANGS.find((l) => l.value === lang)?.label || "English";
      const active = await startGeminiSession({
        voice,
        language: langName,
        topic,
        tone: tone || "warm, natural",
        avatarName: selected?.name || selectedPreset.name,
        onStatus: setStatus,
        onAudioLevel: setSpeakingLevel,
        onTranscript: () => {},
      });
      setSession(active);
      setLive(true);
      setStatus("Connected. Speak naturally.");
    } catch (error) {
      await end(false, error instanceof Error ? error.message : "Could not start the call.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleMute() {
    if (!session) return;
    const next = !muted;
    await session.setMicrophoneEnabled(!next);
    setMuted(next);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.22em] text-muted uppercase">Live conversation</p>
          <h1 className="font-display text-4xl leading-none text-fg sm:text-5xl">LifeMate</h1>
        </div>
        <p className="hidden max-w-xs text-right text-sm text-muted sm:block">
          A two-way video call. The avatar listens, answers, and follows the topic you choose.
        </p>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)]">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="relative aspect-square w-full bg-surface-2">
            {live ? (
              <div className="absolute inset-0 grid place-items-center">
                <FreeGeminiAvatar avatar={selectedPreset} speakingLevel={speakingLevel} />
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
                <span className="grid h-20 w-20 place-items-center rounded-2xl border border-border bg-surface text-muted">
                  <UserRound className="h-8 w-8" strokeWidth={1.5} />
                </span>
                <div>
                  <p className="font-display text-2xl text-fg">{selected?.name || "Video call"}</p>
                  <p className="mt-1 text-sm text-muted">
                    Pick a face, a language, and a topic, then start the call.
                  </p>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-border px-4 py-3">
            <span className={`h-2 w-2 rounded-full ${live ? "bg-primary" : "bg-border"}`} />
            <p className="min-h-5 flex-1 text-sm text-muted">{status}</p>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <button
            type="button"
            onClick={load}
            disabled={busy !== null || live}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-fg disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4 text-primary" />
            {busy === "load" ? "Loading…" : "Load avatars & voices"}
          </button>

          <Field label="Avatar">
            <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)} className={fieldClass} disabled={live}>
              <option value="">Select an avatar…</option>
              {avatars.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Language">
              <select value={lang} onChange={(e) => setLang(e.target.value)} className={fieldClass} disabled={live}>
                {LANGS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </Field>
            <Field label="Gender">
              <select value={gender} onChange={(e) => setGender(e.target.value)} className={fieldClass} disabled={live}>
                <option value="">Any gender</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </Field>
          </div>

          <Field label="Tone">
            <input
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              placeholder="calm, warm, young…"
              className={fieldClass}
              disabled={live}
            />
          </Field>

          <Field label="Guide on">
            <select value={topic} onChange={(e) => setTopic(e.target.value)} className={fieldClass} disabled={live}>
              {TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>

          <Field label="Voice">
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className={fieldClass} disabled={live}>
              <option value="">Voice: avatar default</option>
              {filtered.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.quality}</option>)}
            </select>
          </Field>

          <div className="mt-1 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => void start()}
              disabled={busy !== null || live}
              className="col-span-3 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-ink disabled:opacity-50"
            >
              <Video className="h-4 w-4" />
              {busy === "start" ? "Connecting…" : "Start video call"}
            </button>
            <button
              type="button"
              onClick={() => void toggleMute()}
              disabled={!live}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface text-sm text-fg disabled:opacity-40"
            >
              {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              onClick={() => void end(false)}
              disabled={!live}
              className="col-span-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface text-sm text-danger disabled:opacity-40"
            >
              <PhoneOff className="h-4 w-4" />
              End
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

const fieldClass =
  "min-h-12 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm text-fg outline-none focus:border-primary";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium tracking-wide text-muted uppercase">{label}</span>
      {children}
    </label>
  );
}
