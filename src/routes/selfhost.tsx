import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, PhoneOff, Sparkles, UserRound, Video } from "lucide-react";
import { LANGUAGES, TOPICS } from "@/lib/selfhost/languages";
import type { VoiceInfo } from "@/lib/selfhost/languages";
import { startMic } from "@/lib/selfhost/mic";
import type { MicHandle } from "@/lib/selfhost/mic";

export const Route = createFileRoute("/selfhost")({ component: Home });

type Avatar = { id: string; name: string; preview_url?: string; voice?: string };
type Voice = VoiceInfo;
type IceServer = { urls: string | string[]; username?: string; credential?: string };

const LANGS = LANGUAGES.map((l) => ({ value: l.code, label: l.label }));

/** Wait until the browser has gathered its network candidates (the server does not trickle). */
function waitForIce(pc: RTCPeerConnection, ms = 4000): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const finish = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    const timer = setTimeout(finish, ms);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MicHandle | null>(null);
  const sidRef = useRef("");
  const iceRef = useRef<IceServer[]>([]);
  const playingRef = useRef(false);
  const videoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The microphone is ignored while the avatar talks, so it never hears itself.
  const speakingRef = useRef(false);
  const busyRef = useRef(false);
  const quietUntilRef = useRef(0);

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

  const selected = avatars.find((a) => a.id === avatarId);

  const filtered = useMemo(() => {
    const q = tone.trim().toLowerCase();
    const inLang = voices.filter((v) => v.language === lang);
    const byGender = inLang.filter((v) => !gender || v.gender === gender);
    const byTone = q ? byGender.filter((v) => v.name.toLowerCase().includes(q)) : byGender;
    return byTone.length ? byTone : byGender.length ? byGender : inLang;
  }, [voices, lang, gender, tone]);

  async function load() {
    setBusy("load");
    setStatus("Loading avatars and voices…");
    try {
      const res = await fetch("/api/catalog");
      if (!res.ok) throw new Error(`Could not load the catalog (HTTP ${res.status}).`);
      const data = (await res.json()) as {
        avatars: Avatar[];
        voices: Voice[];
        iceServers?: IceServer[];
        warnings?: string[];
      };
      setAvatars(data.avatars);
      setVoices(data.voices);
      iceRef.current = data.iceServers ?? [];
      const warn = data.warnings?.length ? ` Not ready: ${data.warnings.join("; ")}.` : "";
      setStatus(`${data.avatars.length} avatars · ${data.voices.length} voices. Pick a face, then start.${warn}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not load the catalog.");
    } finally {
      setBusy(null);
    }
  }

  function clearTimers() {
    if (videoTimerRef.current) clearTimeout(videoTimerRef.current);
    videoTimerRef.current = null;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  async function end(auto = false, message?: string) {
    clearTimers();
    micRef.current?.stop();
    micRef.current = null;
    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        /* already gone */
      }
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    const sid = sidRef.current;
    sidRef.current = "";
    if (sid) {
      void fetch("/api/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionid: sid }),
      }).catch(() => undefined);
    }
    playingRef.current = false;
    speakingRef.current = false;
    busyRef.current = false;
    setLive(false);
    setHasVideo(false);
    setMuted(false);
    setStatus(message ?? (auto ? "The call ended." : "Ended."));
  }

  /** Send one spoken sentence group to the server and show the transcript as it streams back. */
  async function sendTurn(wav: Uint8Array) {
    const sid = sidRef.current;
    if (!sid) return;
    busyRef.current = true;
    try {
      const res = await fetch(`/api/turn?sessionid=${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "content-type": "audio/wav" },
        body: new Blob([wav as BlobPart]),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `The server could not answer (HTTP ${res.status}).`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let reply = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as { type: string; text?: string; message?: string };
          if (ev.type === "user") setStatus(`You: ${ev.text}`);
          else if (ev.type === "assistant") {
            reply = reply ? `${reply} ${ev.text}` : (ev.text ?? "");
            setStatus(`LifeMate: ${reply}`);
          } else if (ev.type === "error") setStatus(ev.message ?? "Something went wrong.");
        }
      }
    } catch (e) {
      if (sidRef.current === sid) setStatus(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      busyRef.current = false;
      quietUntilRef.current = Date.now() + 700;
    }
  }

  async function start() {
    setBusy("start");
    setStatus("Opening the video call… allow the microphone when asked.");
    try {
      if (!avatarId) throw new Error("Pick an avatar first. Load the list if it is empty.");
      const pc = new RTCPeerConnection({ iceServers: iceRef.current });
      pcRef.current = pc;
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.ontrack = (ev) => {
        if (ev.track.kind === "video" && videoRef.current) videoRef.current.srcObject = ev.streams[0];
        else if (ev.track.kind === "audio" && audioRef.current) audioRef.current.srcObject = ev.streams[0];
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") void end(true);
      };

      await pc.setLocalDescription(await pc.createOffer());
      await waitForIce(pc);
      const res = await fetch("/api/offer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sdp: pc.localDescription?.sdp,
          type: "offer",
          avatar: avatarId,
          language: lang,
          voice: voiceId || selected?.voice || "",
          tone,
          topic,
        }),
      });
      const answer = (await res.json().catch(() => ({}))) as {
        sdp?: string;
        type?: RTCSdpType;
        sessionid?: string;
        error?: string;
      };
      if (!res.ok || !answer.sdp || !answer.sessionid) {
        throw new Error(answer.error || `Could not start the call (HTTP ${res.status}).`);
      }
      sidRef.current = answer.sessionid;
      await pc.setRemoteDescription({ type: answer.type ?? "answer", sdp: answer.sdp });

      setLive(true);
      setStatus("Connected. Waiting for the avatar’s video… then just talk.");
      videoTimerRef.current = setTimeout(() => {
        if (!playingRef.current) {
          void end(false, "Connected, but the avatar's video never arrived. Check that the avatar server is running and its network ports are open.");
        }
      }, 25000);

      // Follow whether the avatar is speaking, so the microphone can wait its turn.
      pollRef.current = setInterval(() => {
        const sid = sidRef.current;
        if (!sid) return;
        fetch(`/api/status?sessionid=${encodeURIComponent(sid)}`)
          .then((r) => r.json())
          .then((s: { active?: boolean; speaking?: boolean }) => {
            if (s.active === false) {
              void end(true, "The call ended.");
              return;
            }
            if (speakingRef.current && !s.speaking) quietUntilRef.current = Date.now() + 700;
            speakingRef.current = !!s.speaking;
          })
          .catch(() => undefined);
      }, 400);

      try {
        micRef.current = await startMic({
          onUtterance: (wav) => void sendTurn(wav),
          isPaused: () => speakingRef.current || busyRef.current || Date.now() < quietUntilRef.current,
        });
      } catch {
        setStatus("Connected, but the microphone is unavailable. Allow it in the browser to talk to the avatar.");
      }
    } catch (e) {
      await end(false, e instanceof Error ? e.message : "Could not start the call.");
    } finally {
      setBusy(null);
    }
  }

  function toggleMute() {
    if (!micRef.current) return;
    const next = !muted;
    micRef.current.setMuted(next);
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
            <video ref={videoRef} autoPlay playsInline onPlaying={() => { playingRef.current = true; setHasVideo(true); setStatus("On a video call. Speak naturally. The avatar listens and answers."); }} className={`absolute inset-0 h-full w-full object-cover ${hasVideo ? "block" : "hidden"}`} />
            {!hasVideo && (
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
          <audio ref={audioRef} autoPlay />
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
                  {[v.name, LANGS.find((l) => l.value === v.language)?.label, v.gender].filter(Boolean).join(" · ")}
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
              onClick={() => toggleMute()}
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
