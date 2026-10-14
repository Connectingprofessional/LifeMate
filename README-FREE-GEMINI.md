# LifeMate — independent Gemini branch

This branch (`chatgpt-free-gemini`) keeps the existing LifeMate root frame and controls while replacing the HeyGen/LiveKit session internals with an independent Gemini Live implementation.

## Runtime architecture

- The existing LifeMate page remains the primary UI.
- Conversation brain + native speech: Gemini Live API.
- Authentication: server-side `/api/gemini-token` mints a one-use, short-lived Gemini ephemeral token.
- Transport: browser WebSocket directly to Gemini Live.
- Voice selection: Gemini Live native-audio voices.
- Avatar rendering: LifeMate-owned local renderer; no proprietary HeyGen avatar files are copied into the repository.
- The application itself adds no HeyGen-style credit counter or artificial usage meter.

## Environment

Set `GEMINI_API_KEY` on the server/Vercel project used for this branch. `GOOGLE_API_KEY` is accepted as a fallback.

Optional: `GEMINI_LIVE_MODEL` defaults to `gemini-3.8-live`.

Gemini service quotas/rate limits still apply; the app does not claim unlimited provider capacity.

## Isolation

Only the `chatgpt-free-gemini` branch contains these changes. `main` and the existing production deployment are not changed.

## Licensing

The avatar renderer and LifeMate integration code are new code authored for this repository. No HeyGen proprietary avatar or voice assets are copied or redistributed.
