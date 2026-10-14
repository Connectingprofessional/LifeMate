# LifeMate — independent Gemini branch

This branch (\`chatgpt-free-gemini\`) adds an independent \`/free-gemini\` implementation without changing the existing \`/\` LifeMate experience.

## Runtime architecture

- Browser UI and avatar: local React/CSS renderer.
- Conversation brain + native speech: Gemini Live API.
- Authentication: server-side \`/api/gemini-token\` mints a one-use, short-lived Gemini ephemeral token.
- Transport: browser WebSocket directly to Gemini Live; no HeyGen, LiveAvatar, LiveKit, or HeyGen avatar catalog is used by this route.
- Voice catalog: the current Gemini Live native-audio voices are exposed as selectable options.
- Avatar catalog: LifeMate-owned procedural avatar presets. No third-party avatar files are copied into the repository.

## Environment

Set \`GEMINI_API_KEY\` on the server/Vercel project used for this branch. \`GOOGLE_API_KEY\` is accepted as a fallback.

Optional: \`GEMINI_LIVE_MODEL\` defaults to \`gemini-3.8-live\`.

The Gemini API free tier is quota-limited; this branch does not claim unlimited free usage.

## Why this is independent

The new route does not call the existing \`src/lib/liveavatar.ts\` module and does not import \`livekit-client\`. The original root route is deliberately left intact on this branch so the two implementations can be validated side-by-side before any production cutover.

## Licensing

The avatar renderer and LifeMate integration code in this branch are new code authored for this repository. No HeyGen proprietary avatar or voice assets are copied. Gemini voices are selected from Google's service and are not stored or redistributed by LifeMate.
