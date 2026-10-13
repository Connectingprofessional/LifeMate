# LifeMate

A live video call with an AI avatar. Pick a face, a language, and a topic, then talk. The avatar answers on video.

## Run

Set `LIVEAVATAR_API_KEY` in the environment, then:

```bash
npm install
npm run dev
```

The key stays on the server. Do not commit it.

## Self-hosted version (no LiveAvatar, no per-minute limits)

The same screen also runs on your own GPU server with open-source avatar, speech,
language-model and voice engines. It lives at `/selfhost` and does not change the
LiveAvatar version above. See [deploy/README.md](deploy/README.md).
