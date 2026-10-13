# LifeMate, self-hosted

A live video call with an AI avatar that runs entirely on **your own GPU server**.
No per-minute avatar fees, no vendor credits, and no call-time limit in the code.
The screen is the same LifeMate screen you already use; open it at `/selfhost`.
(The original LiveAvatar version at `/` is untouched.)

```
 browser ──https──► Caddy ──► LifeMate (this repo)
    ▲                           │ speech ► Whisper (speaches)   speech-to-text
    │ WebRTC video + audio      │ words  ► Ollama + Qwen3       language model
    │                           │ voice  ► Kokoro               text-to-speech
    └───────────────────────── LiveTalking ◄── audio ───────────┘   talking-face video
```

## What you need

- A Linux server with an **NVIDIA GPU** (LiveTalking recommends an RTX 3060 or better
  for the `wav2lip` avatar and an RTX 3080 Ti or better for `musetalk`; the language
  model, Whisper and Kokoro share the same card, so more VRAM is better).
- Docker with the NVIDIA Container Toolkit.
- A domain name pointing at the server (browsers only allow the microphone on https).
- Open ports: TCP 80 and 443, and **UDP** (WebRTC uses a wide range, LiveTalking asks for
  UDP 1-65535). Port 8010 only needs to be reachable from the server itself.

## Set it up

1. **Download the avatar model.** From the links in
   [LiveTalking's README](https://github.com/lipku/LiveTalking#21-download-models) get
   `wav2lip256.pth` and `wav2lip256_avatar1.tar.gz`, then:
   ```bash
   cd deploy/livetalking
   mkdir -p models data/avatars
   cp wav2lip256.pth models/wav2lip.pth
   tar -xzf wav2lip256_avatar1.tar.gz -C data/avatars
   ```
2. **Configure.** `cp .env.example .env` (in `deploy/`) and set `DOMAIN`.
3. **Start everything.** `docker compose up -d --build`
4. **Pull the language model once.**
   `docker compose exec ollama ollama pull qwen3:8b`
5. **Check it.** Open `https://YOUR_DOMAIN/api/health`. Every service should say `ok`.
   (The first call is slow: Whisper downloads its model the first time it is used.)
6. **Open `https://YOUR_DOMAIN/selfhost`**, press *Load avatars & voices*, pick a face,
   language and voice, and press *Start video call*.

## More avatars

LiveTalking creates an avatar from a short video: open `http://127.0.0.1:8010/avatar.html`
on the server (use an SSH tunnel). Each avatar becomes a folder in
`deploy/livetalking/data/avatars`. Add an optional `meta.json` next to it to set the name
shown on screen:

```json
{ "name": "Asha", "gender": "female", "voice": "hf_alpha" }
```

Only create avatars from video of people who agreed to it, or from footage you hold the
rights to.

## How the pieces map to what you tested

| LifeMate control | Self-hosted behaviour |
|---|---|
| Avatar | A LiveTalking avatar folder |
| Language | Whisper listens in it, the model answers in it, the voice speaks it |
| Voice / Gender | Kokoro voices for that language (read live from the voice server) |
| Tone | Written into the model's instructions (speaking style) |
| Guide on | Written into the model's instructions (topic) |
| Mute / End | Mutes the microphone / ends the call |

There is no timer anywhere in this code. How many calls fit at once is set by
`MAX_SESSIONS` and, in practice, by your GPU: watch LiveTalking's log, where `inferfps`
and `finalfps` must both stay at 25 or above.

## Languages

Whisper understands about 99 languages, but the voice is the limit. Kokoro has voices for
**English, Hindi, Spanish, French, Italian, Portuguese, Japanese and Chinese**, so those are
the languages offered. To add one (Bengali, Tamil, Telugu, Urdu, Arabic ...) you need a voice
engine that speaks it: add a row to `src/lib/selfhost/languages.ts` and point `TTS_BASE_URL`
at a server that has those voices.

## Things to know

- **The microphone waits while the avatar talks**, so the avatar never hears itself and
  answers its own voice. Interrupting mid-sentence is not supported yet.
- **Licences are yours to check before commercial use.** LiveTalking is Apache-2.0 and
  Kokoro is Apache-2.0. Speaches is MIT. The wav2lip model weights come from a research
  project and may be non-commercial; the `musetalk` option is an alternative. I could
  not confirm Qwen3's licence from the page I checked.
- **Strict networks** (some offices and mobile carriers) may need a TURN server: set
  `ICE_SERVERS_JSON` in `.env`.

## What has and has not been tested

Tested (no GPU needed): the sentence cutting, speech detection, the whole conversation
pipeline and every server route, run against stand-in speech, language, voice and avatar
servers (`npm run test:selfhost`, then `NITRO_PRESET=node-server npm run build` and
`npm run test:selfhost:e2e`). The Docker Compose file validates.

**Not tested** (needs your GPU server): the Docker images building, LiveTalking running with
the models, the real Whisper / Qwen3 / Kokoro servers answering exactly as the stand-ins do
(the speaches image tag and model name, Kokoro's `pcm` output, Hindi lip movement), and
the browser's WebRTC video and microphone. Expect a short first-run shake-down; the
`/api/health` page and the server log name whichever service is the problem.
