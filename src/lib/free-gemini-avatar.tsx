import { useEffect, useRef } from "react";

export type AvatarPreset = {
  id: string;
  name: string;
  skin: string;
  hair: string;
  outfit: string;
  accent: string;
};

export const AVATARS: AvatarPreset[] = [
  { id: "maya", name: "Maya", skin: "#b8754f", hair: "#241b18", outfit: "#7c5cff", accent: "#bda9ff" },
  { id: "aria", name: "Aria", skin: "#e0aa83", hair: "#4b2e21", outfit: "#0f766e", accent: "#8de1d9" },
  { id: "leo", name: "Leo", skin: "#c88962", hair: "#171717", outfit: "#2563eb", accent: "#93c5fd" },
  { id: "zara", name: "Zara", skin: "#8e5a3c", hair: "#14110f", outfit: "#db2777", accent: "#f9a8d4" },
  { id: "noah", name: "Noah", skin: "#f0bc91", hair: "#8b5a2b", outfit: "#ea580c", accent: "#fdba74" },
  { id: "lina", name: "Lina", skin: "#d59a73", hair: "#3a2520", outfit: "#059669", accent: "#86efac" },
  { id: "dev", name: "Dev", skin: "#a86d49", hair: "#201512", outfit: "#475569", accent: "#cbd5e1" },
  { id: "sana", name: "Sana", skin: "#c9825d", hair: "#30201b", outfit: "#0891b2", accent: "#67e8f9" },
];

type Props = { avatar: AvatarPreset; speakingLevel: number };

export function FreeGeminiAvatar({ avatar, speakingLevel }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rootRef.current?.style.setProperty("--voice-level", String(speakingLevel));
  }, [speakingLevel]);

  return (
    <div
      ref={rootRef}
      className="free-avatar"
      style={
        {
          "--skin": avatar.skin,
          "--hair": avatar.hair,
          "--outfit": avatar.outfit,
          "--accent": avatar.accent,
        } as React.CSSProperties
      }
      aria-label={avatar.name + " 3D-style avatar"}
      role="img"
    >
      <div className="free-avatar__halo" />
      <div className="free-avatar__body">
        <div className="free-avatar__neck" />
        <div className="free-avatar__head">
          <div className="free-avatar__hair" />
          <div className="free-avatar__ear free-avatar__ear--left" />
          <div className="free-avatar__ear free-avatar__ear--right" />
          <div className="free-avatar__eye free-avatar__eye--left" />
          <div className="free-avatar__eye free-avatar__eye--right" />
          <div className="free-avatar__nose" />
          <div className="free-avatar__mouth" />
          <div className="free-avatar__shine" />
        </div>
        <div className="free-avatar__torso">
          <div className="free-avatar__collar" />
          <div className="free-avatar__badge">LM</div>
        </div>
      </div>
      <div className="free-avatar__floor" />
    </div>
  );
}
