import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, PhoneOff, Sparkles, UserRound, Video } from "lucide-react";
import { AVATARS, LANGS, VOICES } from "@/lib/avatar-catalog";
import { startAvatarEngine, type AvatarEngineSession } from "@/lib/avatar-engine";
import { startGeminiSession, type GeminiSession } from "@/lib/free-gemini";

export const Route = createFileRoute("/")({ component: Home });

const TOPICS = ["Anything","Professional","Personal","Spiritual","Music","Business","Markets","Research","Education","Job search"];

function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const avatarRef = useRef<AvatarEngineSession | null>(null);
  const geminiRef = useRef<GeminiSession | null>(null);
  const [avatarId, setAvatarId] = useState(AVATARS[0]?.id || "");
  const [voiceId, setVoiceId] = useState(VOICES[0]?.id || "");
  const [lang, setLang] = useState("English");
  const [gender, setGender] = useState("");
  const [tone, setTone] = useState("");
  const [topic, setTopic] = useState("Anything");
  const [status, setStatus] = useState("Choose an avatar, voice and language, then start the video call.");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);

  const selected = AVATARS.find((a) => a.id === avatarId) || AVATARS[0];
  const voices = useMemo(
    () => VOICES.filter((v) => (!gender || v.gender === gender) && (lang === "English" || v.language === lang)),
    [gender, lang],
  );

  useEffect(() => () => { void stopCall(); }, []);

  function addTranscript(role: "user" | "assistant", text: string) {
    if (!text) return;
    setTranscript((items) => {
      const last = items[items.length - 1];
      if (last?.role === role) return [...items.slice(0, -1), { role, text: last.text + text }];
      return [...items, { role, text }];
    });
  }

  async function start() {
    if (live || busy || !selected || !videoRef.current) return;
    setBusy(true);
    setTranscript([]);
    setStatus("Opening independent avatar video and Gemini Live…");
    try {
      const avatar = await startAvatarEngine({ avatarId: selected.id, voice: voiceId, video: videoRef.current });
      avatarRef.current = avatar;
      setHasVideo(true);

      const gemini = await startGeminiSession({
        language: lang,
        topic,
        tone: tone || "warm, natural",
        avatarName: selected.name,
        onStatus: setStatus,
        onTranscript: addTranscript,
        onAssistantText: async (text) => {
          try {
            await avatarRef.current?.speak(text, voiceId);
            setStatus("LifeMate is speaking…");
          } catch (error) {
            setStatus(error instanceof Error ? error.message : "Avatar speech failed.");
          }
        },
      });
      geminiRef.current = gemini;
      setLive(true);
      setStatus("Connected. Speak naturally.");
    } catch (error) {
      await stopCall();
      setStatus(error instanceof Error ? error.message : "Could not start the video call.");
    } finally {
      setBusy(false);
    }
  }

  async function stopCall() {
    const gemini = geminiRef.current;
    geminiRef.current = null;
    gemini?.close();
    const avatar = avatarRef.current;
    avatarRef.current = null;
    if (avatar) await avatar.close();
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
    setHasVideo(false);
    setMuted(false);
  }

  async function toggleMute() {
    const next = !muted;
    await geminiRef.current?.setMicrophoneEnabled(!next);
    setMuted(next);
    setStatus(next ? "Microphone muted." : "Microphone on.");
  }

  const filteredAvatars = gender ? AVATARS.filter((a) => a.gender === gender) : AVATARS;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.22em] text-muted uppercase">Live conversation</p>
          <h1 className="font-display text-4xl leading-none text-fg sm:text-5xl">LifeMate</h1>
        </div>
        <p className="hidden max-w-xs text-right text-sm text-muted sm:block">Independent realtime avatar video with Gemini Live.</p>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)]">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="relative aspect-square w-full bg-surface-2">
            <video ref={videoRef} autoPlay playsInline className={`absolute inset-0 h-full w-full object-cover ${hasVideo ? "block" : "hidden"}`} />
            {!hasVideo && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
                <span className="grid h-20 w-20 place-items-center rounded-2xl border border-border bg-surface text-muted"><UserRound className="h-8 w-8" strokeWidth={1.5} /></span>
                <div><p className="font-display text-2xl text-fg">{selected?.name || "Video call"}</p><p className="mt-1 text-sm text-muted">The independent avatar server supplies realtime video.</p></div>
              </div>
            )}
            <div className="absolute left-4 right-4 top-4 max-h-32 overflow-hidden rounded-xl bg-black/35 p-3 text-xs text-white/90">
              {transcript.slice(-4).map((item, i) => <div key={i}><b>{item.role === "user" ? "You" : selected?.name}</b>: {item.text}</div>)}
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-border px-4 py-3"><span className={`h-2 w-2 rounded-full ${live ? "bg-primary" : "bg-border"}`} /><p className="min-h-5 flex-1 text-sm text-muted">{status}</p></div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-fg"><Sparkles className="h-4 w-4 text-primary" />{AVATARS.length}+ independent avatar slots · {VOICES.length} voices</div>
          <Field label="Avatar"><select value={avatarId} onChange={(e) => setAvatarId(e.target.value)} disabled={live} className={fieldClass}>{filteredAvatars.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.gender}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Language"><select value={lang} onChange={(e) => setLang(e.target.value)} disabled={live} className={fieldClass}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select></Field>
            <Field label="Gender"><select value={gender} onChange={(e) => setGender(e.target.value)} disabled={live} className={fieldClass}><option value="">Any gender</option><option value="female">Female</option><option value="male">Male</option></select></Field>
          </div>
          <Field label="Tone"><input value={tone} onChange={(e) => setTone(e.target.value)} disabled={live} placeholder="calm, warm, young…" className={fieldClass} /></Field>
          <Field label="Guide on"><select value={topic} onChange={(e) => setTopic(e.target.value)} disabled={live} className={fieldClass}>{TOPICS.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Voice"><select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} disabled={live} className={fieldClass}>{(voices.length ? voices : VOICES).map((v) => <option key={v.id} value={v.id}>{v.name} · {v.language} · {v.gender}</option>)}</select></Field>
          <div className="mt-1 grid grid-cols-3 gap-2">
            <button type="button" onClick={() => void start()} disabled={busy || live} className="col-span-3 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-ink disabled:opacity-50"><Video className="h-4 w-4" />{busy ? "Connecting…" : "Start video call"}</button>
            <button type="button" onClick={() => void toggleMute()} disabled={!live} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface text-sm text-fg disabled:opacity-40">{muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}{muted ? "Unmute" : "Mute"}</button>
            <button type="button" onClick={() => void stopCall()} disabled={!live} className="col-span-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface text-sm text-danger disabled:opacity-40"><PhoneOff className="h-4 w-4" />End</button>
          </div>
          <p className="text-xs leading-5 text-muted">Gemini Live handles the conversation. A LiveTalking/MuseTalk-compatible GPU WebRTC server handles independent avatar video and TTS. No HeyGen or LiveKit session is used.</p>
        </section>
      </div>
    </main>
  );
}

const fieldClass = "min-h-12 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm text-fg outline-none focus:border-primary";
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex flex-col gap-1.5"><span className="text-xs font-medium tracking-wide text-muted uppercase">{label}</span>{children}</label>;
}
