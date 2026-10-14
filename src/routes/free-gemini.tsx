import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FreeGeminiAvatar, AVATARS } from "@/lib/free-gemini-avatar";
import { startGeminiSession } from "@/lib/free-gemini";

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

const LANGUAGES = [
  "English", "Hindi", "Bengali", "Tamil", "Telugu", "Marathi", "Gujarati", "Kannada",
  "Malayalam", "Urdu", "Arabic", "Spanish", "French", "German", "Portuguese", "Italian",
  "Dutch", "Polish", "Russian", "Turkish", "Chinese", "Japanese", "Korean", "Indonesian",
];

export const Route = createFileRoute("/free-gemini")({ component: FreeGeminiPage });

function FreeGeminiPage() {
  const [avatarId, setAvatarId] = useState(AVATARS[0].id);
  const [voice, setVoice] = useState("Aoede");
  const [language, setLanguage] = useState("English");
  const [topic, setTopic] = useState("Anything");
  const [tone, setTone] = useState("warm, intelligent, natural");
  const [status, setStatus] = useState("Ready — choose an avatar and start.");
  const [transcript, setTranscript] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [live, setLive] = useState(false);
  const [level, setLevel] = useState(0);
  const sessionRef = useRef<{ close: () => void } | null>(null);

  const avatar = useMemo(() => AVATARS.find((item) => item.id === avatarId) || AVATARS[0], [avatarId]);

  useEffect(() => () => sessionRef.current?.close(), []);

  async function start() {
    if (sessionRef.current) return;
    setTranscript([]);
    setStatus("Requesting a secure Gemini session and microphone access…");
    try {
      const session = await startGeminiSession({
        voice,
        language,
        topic,
        tone,
        avatarName: avatar.name,
        onStatus: setStatus,
        onAudioLevel: setLevel,
        onTranscript: (role, text) => {
          setTranscript((current) => {
            const last = current[current.length - 1];
            if (last?.role === role) return [...current.slice(0, -1), { role, text: last.text + text }];
            return [...current, { role, text }];
          });
        },
      });
      sessionRef.current = session;
      setLive(true);
      setStatus("Connected. Speak naturally.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not start LifeMate.");
      setLive(false);
      setLevel(0);
    }
  }

  function stop() {
    sessionRef.current?.close();
    sessionRef.current = null;
    setLive(false);
    setLevel(0);
    setStatus("Session stopped.");
  }

  return (
    <main className="free-gemini-shell">
      <section className="free-gemini-card">
        <header className="free-gemini-header">
          <div>
            <p className="free-eyebrow">INDEPENDENT LIVE AVATAR</p>
            <h1>LifeMate <span>· Gemini</span></h1>
            <p className="free-subtitle">No HeyGen. No LiveKit. No vendor video session. The avatar is rendered in your browser.</p>
          </div>
          <a href="/" className="free-back">Back to LifeMate</a>
        </header>

        <div className="free-gemini-grid">
          <section className="free-stage">
            <div className="free-stage__topline">
              <span className={live ? "free-dot free-dot--live" : "free-dot"} />
              <span>{live ? "LIVE" : "READY"}</span>
              <span className="free-stage__model">Gemini Live · ephemeral token</span>
            </div>

            <div className="free-stage__avatar"><FreeGeminiAvatar avatar={avatar} speakingLevel={level} /></div>

            <div className="free-stage__caption">
              <strong>{avatar.name}</strong>
              <span>{status}</span>
            </div>

            <div className="free-transcript" aria-live="polite">
              {transcript.slice(-5).map((item, index) => (
                <div key={item.role + "-" + index} className={"free-line free-line--" + item.role}>
                  <b>{item.role === "user" ? "You" : avatar.name}</b>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </section>

          <aside className="free-controls">
            <div className="free-control-group">
              <label>Avatar</label>
              <select value={avatarId} onChange={(e) => setAvatarId(e.target.value)} disabled={live}>
                {AVATARS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>

            <div className="free-control-group">
              <label>Gemini voice</label>
              <select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={live}>
                {VOICES.map(([name, quality]) => <option key={name} value={name}>{name} · {quality}</option>)}
              </select>
              <small>30 built-in voices; the voice is generated by Gemini, not stored in LifeMate.</small>
            </div>

            <div className="free-control-row">
              <div className="free-control-group">
                <label>Language preference</label>
                <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={live}>
                  {LANGUAGES.map((item) => <option key={item}>{item}</option>)}
                </select>
              </div>
              <div className="free-control-group">
                <label>Topic</label>
                <select value={topic} onChange={(e) => setTopic(e.target.value)} disabled={live}>
                  {["Anything", "Professional", "Personal", "Spiritual", "Music", "Business", "Markets", "Research", "Education", "Job search"].map((item) => <option key={item}>{item}</option>)}
                </select>
              </div>
            </div>

            <div className="free-control-group">
              <label>Tone</label>
              <input value={tone} onChange={(e) => setTone(e.target.value)} disabled={live} />
            </div>

            <div className="free-actions">
              {!live ? (
                <button type="button" className="free-primary" onClick={() => void start()}>Start LifeMate</button>
              ) : (
                <button type="button" className="free-stop" onClick={stop}>End conversation</button>
              )}
            </div>

            <div className="free-notes">
              <p><b>What changed:</b> the browser receives a short-lived Gemini token from the LifeMate server, then connects directly to Gemini Live over WebSocket.</p>
              <p><b>What stays untouched:</b> this is a separate <code>/free-gemini</code> route on <code>chatgpt-free-gemini</code>. The existing root and production branch are not replaced.</p>
              <p><b>Free means quota-limited:</b> Gemini currently lists free-tier access for its Live models, but it is not unlimited.</p>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
