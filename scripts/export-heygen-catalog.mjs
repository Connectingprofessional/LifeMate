// Saves a plain-JSON snapshot of the HeyGen LiveAvatar catalog (avatar and voice
// LISTS: ids, names, languages, genders, preview links) so the list is kept in
// this repo and can be used to shape our own free catalog.
//
// It copies metadata only. It does not download avatar videos, preview images or
// voice audio: those belong to HeyGen and stay on HeyGen's servers.
// The key is read from LIVEAVATAR_API_KEY and is never printed or written.
import { writeFileSync, mkdirSync } from "node:fs";

const API = "https://api.liveavatar.com/v1";
const key = process.env.LIVEAVATAR_API_KEY;
if (!key) { console.error("FAIL: LIVEAVATAR_API_KEY is not available."); process.exit(2); }
const headers = { "X-API-KEY": key };

const inner = (d) => (d && d.data ? d.data : d) || {};
async function pages(path, extra = {}) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const q = new URLSearchParams({ page: String(page), page_size: "100", ...extra });
    const r = await fetch(`${API}${path}?${q}`, { headers });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}: ${JSON.stringify(d).slice(0, 200)}`);
    const batch = Array.isArray(inner(d).results) ? inner(d).results : [];
    all.push(...batch);
    if (!inner(d).next || !batch.length) break;
  }
  return all;
}

const publicAvatars = await pages("/avatars/public");
const myAvatars = await pages("/avatars");
const voices = await pages("/voices", { voice_type: "public" });

const out = {
  exportedAt: new Date().toISOString(),
  note: "Metadata only. Avatar video and voice audio are HeyGen's and are not copied.",
  counts: { publicAvatars: publicAvatars.length, myAvatars: myAvatars.length, voices: voices.length },
  publicAvatars, myAvatars, voices,
};
mkdirSync("catalog", { recursive: true });
writeFileSync("catalog/heygen-catalog.json", JSON.stringify(out, null, 2) + "\n");
console.log("Saved catalog/heygen-catalog.json", JSON.stringify(out.counts));
