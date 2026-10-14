import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, PhoneOff, Sparkles, UserRound, Video } from "lucide-react";
import type { Avatar, Voice } from "@/lib/liveavatar";
import { listCatalog, startSession, stopSession } from "@/lib/liveavatar";
import { VOICES as FREE_VOICES } from "@/lib/free/catalog";
import type { AvatarStage } from "@/lib/free/avatar";
import type { LiveCall } from "@/lib/free/live";

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

function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<{ disconnect: () => void } | null>(null);
  const sidRef = useRef("");
  const videoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Free fallback call (Gemini voice + in-browser 3D avatar), used only when HeyGen cannot connect.
  const freeStageRef = useRef<HTMLDivElement>(null);
  const freeAvatarRef = useRef<AvatarStage | null>(null);
  const freeCallRef = useRef<LiveCall | null>(null);

  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [avatarId, setAvatarId] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [lang, setLang] = useState("en");
  const [gender, setGender] = useState("");
  const [tone, setTone] = useState("");
  const [topic, setTopic] = useState("Anything");
  const [status, setStatus] = useState("Load avatars, then start a video call.");
  const [busy, setBusy] = useState<"load" | "start" | null>(null);
  const [live, setLive] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [muted, setMuted] = useState(false);
  const [freeMode, setFreeMode] = useState(false);

  const selected = avatars.find((a) => a.id === avatarId);

  const filtered = useMemo(() => {
    const label = LANGS.find((l) => l.value === lang)?.label.toLowerCase() ?? "";
    const q = tone.trim().toLowerCase();
    const match = voices.filter((v) => {
      const l = (v.language || "").toLowerCase();
      const langOk = l === lang || l.startsWith(lang + "-") || l.startsWith(lang + "_") || l.includes(label);
      const gOk = !gender || (v.gender || "").toLowerCase() === gender;
      const blob = JSON.stringify([v.name, v.tags, v.description]).toLowerCase();
      const qOk = !q || blob.includes(q);
      return langOk && gOk && qOk;
    });
    return match.length ? match : voices;
  }, [voices, lang, gender, tone]);

  async function load() {
    setBusy("load");
    setStatus("Loading public avatars and your account avatars…");
    try {
      const data = await listCatalog();
      setAvatars(data.avatars);
      setVoices(data.voices);
      setStatus(`${data.avatars.length} avatars · ${data.voices.length} voices. Pick a face, then start.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not load the catalog.");
    } finally {
      setBusy(null);
    }
  }

  function cleanupAudio() {
    document.querySelectorAll("audio[data-live-audio]").forEach((el) => el.remove());
  }

  function clearVideoTimer() {
    if (videoTimerRef.current) {
      clearTimeout(videoTimerRef.current);
      videoTimerRef.current = null;
    }
  }

  function stopFree() {
    freeCallRef.current?.close();
    freeCallRef.current = null;
    freeAvatarRef.current?.destroy();
    freeAvatarRef.current = null;
    setFreeMode(false);
  }

  // Free fallback: same page, same controls, but Gemini speaks and a 3D avatar is drawn in the browser.
  async function startFree(reason: string) {
    const stage = freeStageRef.current;
    if (!stage) throw new Error(reason);
    const langName = LANGS.find((l) => l.value === lang)?.label || "English";
    const heygenVoice = voices.find((v) => v.id === (voiceId || selected?.default_voice?.id));
    const wantGender = (gender || heygenVoice?.gender || "female").toLowerCase();
    const voice = (FREE_VOICES.find((v) => v.gender === wantGender) ?? FREE_VOICES[0]).id;
    setStatus("HeyGen is not available right now. Switching to the free call…");
    const res = await fetch("/api/free-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: lang, languageName: langName, voice, topic }),
    });
    const tok = (await res.json()) as { token?: string; model?: string; error?: string };
    if (!res.ok || !tok.token || !tok.model) {
      throw new Error(`${reason} The free call could not start either: ${tok.error || "no token"}`);
    }
    const catalog = (await fetch("/avatars/catalog.json").then((r) => r.json())) as import("@/lib/free/catalog").FreeAvatar[];
    const pick = catalog.find((a) => (a.body === "M") === (wantGender === "male")) ?? catalog[0];
    setFreeMode(true);
    const { createAvatarStage } = await import("@/lib/free/avatar");
    const avatarStage = await createAvatarStage(stage, pick, { onSpeaking: () => undefined });
    freeAvatarRef.current = avatarStage;
    const { startLiveCall } = await import("@/lib/free/live");
    const call = await startLiveCall(
      { token: tok.token, model: tok.model },
      {
        onAudio: (pcm) => avatarStage.speak(pcm),
        onTurnComplete: () => avatarStage.endOfReply(),
        onInterrupted: () => avatarStage.interrupt(),
        onCaption: () => undefined,
        onClose: (why) => {
          if (freeCallRef.current) void end(true, why);
        },
      },
    );
    freeCallRef.current = call;
    setLive(true);
    setStatus("Free call (Gemini). Speak naturally. The avatar listens and answers.");
  }

  // `message` lets the caller say why the call ended; without it the status
  // would be overwritten with a generic "Ended." and the real error lost.
  async function end(auto = false, message?: string) {
    clearVideoTimer();
    const room = roomRef.current;
    roomRef.current = null;
    try {
      room?.disconnect();
    } catch {
      /* already gone */
    }
    cleanupAudio();
    stopFree();
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    const sid = sidRef.current;
    sidRef.current = "";
    if (sid) void stopSession({ data: { session_id: sid } });
    setLive(false);
    setHasVideo(false);
    setMuted(false);
    setStatus(message ?? (auto ? "The call ended." : "Ended."));
  }

  async function start() {
    setBusy("start");
    setStatus("Opening the video call… allow the microphone when asked.");
    try {
      if (!avatarId) throw new Error("Pick an avatar first. Load the list if it is empty.");
      const langName = LANGS.find((l) => l.value === lang)?.label || "English";
      const fallbackVoice = selected?.default_voice?.id || "";
      let session: Awaited<ReturnType<typeof startSession>>;
      try {
        session = await startSession({
          data: {
            language: lang,
            language_name: langName,
            avatar_id: avatarId,
            voice_id: voiceId || fallbackVoice || undefined,
            topic,
          },
        });
      } catch (heygenError) {
        const why = heygenError instanceof Error ? heygenError.message : "HeyGen could not start the call.";
        await startFree(why);
        return;
      }
      const { Room, RoomEvent, Track } = await import("livekit-client");
      const room = new Room({ adaptiveStream: true });
      roomRef.current = room;
      sidRef.current = session.session_id;
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Video && videoRef.current) {
          clearVideoTimer();
          track.attach(videoRef.current);
          setHasVideo(true);
          setStatus(
            session.sandbox
              ? "On a video call. Speak naturally — this sandbox line ends in about a minute."
              : "On a video call. Speak naturally. The avatar listens and answers.",
          );
        } else if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.dataset.liveAudio = "1";
          document.body.appendChild(el);
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        void end(
          true,
          session.sandbox
            ? "The call ended. Sandbox calls last about a minute."
            : "The call ended.",
        );
      });
      await room.connect(session.livekit_url, session.token);
      setLive(true);
      setStatus("Connected. Waiting for the avatar’s video… then just talk.");
      // If the avatar never publishes video, say so instead of waiting forever.
      videoTimerRef.current = setTimeout(() => {
        const why = "Connected, but the avatar's video never arrived. Check the LiveAvatar account (credits, plan) and try again.";
        // Drop the HeyGen room, then try the free call before giving up.
        void end(false, why).then(async () => {
          setBusy("start");
          try {
            await startFree(why);
          } catch (e) {
            await end(false, e instanceof Error ? e.message : why);
          } finally {
            setBusy(null);
          }
        });
      }, 25000);
      // Audio playback and the microphone are best-effort: the avatar's video
      // should still show if the browser blocks either one.
      let note = "";
      try {
        await room.startAudio();
      } catch {
        note = " Your browser blocked audio playback — click the page once to allow sound.";
      }
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch {
        note += " Microphone unavailable — allow it in the browser to talk to the avatar.";
      }
      // Only while still waiting for video; otherwise keep the "on a call" status.
      if (note && videoTimerRef.current) setStatus("Connected." + note);
    } catch (e) {
      await end(false, e instanceof Error ? e.message : "Could not start the call.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleMute() {
    if (freeCallRef.current) {
      const next = !muted;
      freeCallRef.current.setMuted(next);
      setMuted(next);
      return;
    }
    const room = roomRef.current as { localParticipant?: { setMicrophoneEnabled: (on: boolean) => Promise<void> } } | null;
    if (!room?.localParticipant) return;
    const next = !muted;
    await room.localParticipant.setMicrophoneEnabled(!next);
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
            <video ref={videoRef} autoPlay playsInline className={`absolute inset-0 h-full w-full object-cover ${hasVideo ? "block" : "hidden"}`} />
            <div ref={freeStageRef} className={`absolute inset-0 ${freeMode ? "block" : "hidden"}`} />
            {!hasVideo && !freeMode && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
                {selected?.preview_url ? (
                  <img
                    src={selected.preview_url}
                    alt={selected.name || "Avatar preview"}
                    className="h-36 w-36 rounded-2xl object-cover"
                  />
                ) : (
                  <span className="grid h-20 w-20 place-items-center rounded-2xl border border-border bg-surface text-muted">
                    <UserRound className="h-8 w-8" strokeWidth={1.5} />
                  </span>
                )}
                <div>
                  <p className="font-display text-2xl text-fg">{selected?.name || "Video call"}</p>
                  <p className="mt-1 text-sm text-muted">
                    {live ? "Waiting for the avatar’s picture…" : "Pick a face, a language, and a topic, then start the call."}
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
            onClick={() => void load()}
            disabled={busy !== null}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-fg disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4 text-primary" />
            {busy === "load" ? "Loading…" : "Load avatars & voices"}
          </button>

          <Field label="Avatar">
            <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)} className={fieldClass}>
              <option value="">Select an avatar…</option>
              {avatars.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.id}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Language">
              <select value={lang} onChange={(e) => setLang(e.target.value)} className={fieldClass}>
                {LANGS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Gender">
              <select value={gender} onChange={(e) => setGender(e.target.value)} className={fieldClass}>
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
            />
          </Field>

          <Field label="Guide on">
            <select value={topic} onChange={(e) => setTopic(e.target.value)} className={fieldClass}>
              {TOPICS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Voice">
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className={fieldClass}>
              <option value="">Voice: avatar default</option>
              {filtered.map((v) => (
                <option key={v.id} value={v.id}>
                  {[v.name, v.language, v.gender].filter(Boolean).join(" · ")}
                </option>
              ))}
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
