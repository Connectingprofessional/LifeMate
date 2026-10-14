import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, PhoneOff, UserRound, Video } from "lucide-react";
import { LANGUAGES, TOPICS, VOICES } from "@/lib/free/catalog";
import type { FreeAvatar } from "@/lib/free/catalog";
import type { AvatarStage } from "@/lib/free/avatar";
import type { LiveCall } from "@/lib/free/live";

export const Route = createFileRoute("/free")({ component: FreeCall });

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

function FreeCall() {
  const stageRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<AvatarStage | null>(null);
  const callRef = useRef<LiveCall | null>(null);

  const [avatars, setAvatars] = useState<FreeAvatar[]>([]);
  const [avatarId, setAvatarId] = useState("");
  const [voice, setVoice] = useState("");
  const [lang, setLang] = useState("en");
  const [gender, setGender] = useState("");
  const [topic, setTopic] = useState("Anything");
  const [status, setStatus] = useState("Pick a face, a language and a topic, then start the call.");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [captions, setCaptions] = useState<{ who: "you" | "avatar"; text: string } | null>(null);

  useEffect(() => {
    fetch("/avatars/catalog.json")
      .then((r) => r.json())
      .then((list: FreeAvatar[]) => {
        setAvatars(list);
        if (list[0]) setAvatarId(list[0].id);
      })
      .catch(() => setStatus("Could not load the avatar list."));
    return () => {
      callRef.current?.close();
      avatarRef.current?.destroy();
    };
  }, []);

  const selected = avatars.find((a) => a.id === avatarId);
  const voices = useMemo(() => VOICES.filter((v) => !gender || v.gender === gender), [gender]);

  async function end(message?: string) {
    callRef.current?.close();
    callRef.current = null;
    avatarRef.current?.destroy();
    avatarRef.current = null;
    setLive(false);
    setSpeaking(false);
    setMuted(false);
    setCaptions(null);
    setStatus(message ?? "Ended.");
  }

  async function start() {
    if (!selected || !stageRef.current) return;
    setBusy(true);
    setStatus("Getting the avatar ready…");
    try {
      const chosenVoice = voice || selected.voice || "Kore";
      const res = await fetch("/api/free-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: lang, voice: chosenVoice, topic }),
      });
      const tok = (await res.json()) as { token?: string; model?: string; error?: string };
      if (!res.ok || !tok.token || !tok.model) throw new Error(tok.error || "Could not start the call.");

      const { createAvatarStage } = await import("@/lib/free/avatar");
      const stage = await createAvatarStage(stageRef.current, selected, {
        onSpeaking: setSpeaking,
        onProgress: (p) => setStatus(`Loading the avatar… ${p}%`),
      });
      avatarRef.current = stage;

      setStatus("Connecting…");
      const { startLiveCall } = await import("@/lib/free/live");
      const call = await startLiveCall(
        { token: tok.token, model: tok.model },
        {
          onAudio: (pcm) => stage.speak(pcm),
          onTurnComplete: () => stage.endOfReply(),
          onInterrupted: () => stage.interrupt(),
          onCaption: (who, text) => setCaptions({ who, text }),
          onClose: (reason) => {
            if (callRef.current) void end(reason);
          },
        },
      );
      callRef.current = call;
      setLive(true);
      setStatus("On a video call. Speak naturally. The avatar listens and answers.");
    } catch (e) {
      const m = e instanceof Error ? e.message : "Could not start the call.";
      await end(/Permission|NotAllowed/i.test(m) ? "Allow the microphone in your browser to talk to the avatar." : m);
    } finally {
      setBusy(false);
    }
  }

  function toggleMute() {
    const next = !muted;
    callRef.current?.setMuted(next);
    setMuted(next);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.22em] text-muted uppercase">Live conversation · free</p>
          <h1 className="font-display text-4xl leading-none text-fg sm:text-5xl">LifeMate</h1>
        </div>
        <p className="hidden max-w-xs text-right text-sm text-muted sm:block">
          A two-way call with a 3D avatar, powered by Gemini. No per-minute credits.
        </p>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)]">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="relative aspect-square w-full bg-surface-2">
            <div ref={stageRef} className="absolute inset-0" />
            {!live && !busy && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
                <span className="grid h-20 w-20 place-items-center rounded-2xl border border-border bg-surface text-muted">
                  <UserRound className="h-8 w-8" strokeWidth={1.5} />
                </span>
                <p className="font-display text-2xl text-fg">{selected?.name || "Video call"}</p>
              </div>
            )}
            {captions && (
              <p className="absolute inset-x-3 bottom-3 rounded-xl bg-black/60 px-3 py-2 text-sm text-white">
                <span className="opacity-70">{captions.who === "you" ? "You: " : ""}</span>
                {captions.text.slice(-220)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-border px-4 py-3">
            <span className={`h-2 w-2 rounded-full ${speaking ? "bg-primary" : live ? "bg-muted" : "bg-border"}`} />
            <p className="min-h-5 flex-1 text-sm text-muted">{status}</p>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Field label="Avatar">
            <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)} disabled={live} className={fieldClass}>
              {avatars.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Language">
              <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={live} className={fieldClass}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Gender">
              <select value={gender} onChange={(e) => setGender(e.target.value)} disabled={live} className={fieldClass}>
                <option value="">Any gender</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </Field>
          </div>

          <Field label="Guide on">
            <select value={topic} onChange={(e) => setTopic(e.target.value)} disabled={live} className={fieldClass}>
              {TOPICS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Voice">
            <select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={live} className={fieldClass}>
              <option value="">Voice: avatar default</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id} · {v.tone} · {v.gender}
                </option>
              ))}
            </select>
          </Field>

          <div className="mt-1 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => void start()}
              disabled={busy || live || !selected}
              className="col-span-3 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-ink disabled:opacity-50"
            >
              <Video className="h-4 w-4" />
              {busy ? "Connecting…" : "Start video call"}
            </button>
            <button
              type="button"
              onClick={toggleMute}
              disabled={!live}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface text-sm text-fg disabled:opacity-40"
            >
              {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              onClick={() => void end()}
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
