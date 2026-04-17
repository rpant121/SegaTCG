# Sega Card Game — Online Multiplayer Setup

## Quick Start (Local Dev)

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm run dev        # auto-restarts on file changes
# or
npm start

# 3. Open in browser
# Player 1: http://localhost:3000
# Player 2: http://localhost:3000  (different browser or incognito)
```

## How to Activate Online Mode

In `index.html`, find the script tag at the bottom and swap it:

```html
<!-- LOCAL (current) -->
<script type="module" src="main.js"></script>

<!-- ONLINE — change to this -->
<script type="module" src="main.online.js"></script>
```

That's it. The deck builder, renderer, and all game HTML stay unchanged.

## File Structure

```
project-root/
├── package.json
├── server/
│   ├── index.js          ← Express + Socket.io entry point
│   └── gameRoom.js       ← Per-game state manager
├── engine/               ← Shared engine (used by server unchanged)
│   ├── actions.js
│   ├── cards.js
│   ├── combat.js
│   ├── phases.js
│   └── state.js
├── client/               ← (or just root — wherever your HTML lives)
│   ├── main.online.js    ← NEW: online lobby entry point
│   └── ui/
│       ├── handlers.online.js   ← NEW: socket-based handlers
│       ├── handlers.js          ← original local handlers (untouched)
│       └── renderer.js          ← unchanged
├── index.html
└── deck-builder.html
```

## How the Online Flow Works

```
P1 opens site → Build deck → Create Room → gets code "WXYZ"
P2 opens site → Build deck → Enter "WXYZ" → Join

Server: both players seated → createInitialState() → broadcast state_update to each

Each turn:
  Active player clicks something → handlers.online.js calls act('ACTION_TYPE', payload)
  → socket.emit('action', { roomCode, type, payload })
  → server validates → mutates state → sanitizes per player → broadcasts state_update
  → each client receives their view → renderer.js re-renders
```

## Deploying to Railway (Recommended for Free Hosting)

1. Push this repo to GitHub.
2. Go to https://railway.app → New Project → Deploy from GitHub.
3. Select your repo. Railway auto-detects `package.json` and runs `npm start`.
4. Set environment variable if needed: `PORT` (Railway sets this automatically).
5. Get your public URL (e.g. `https://sega-tcg.up.railway.app`).
6. In `main.online.js`, the `SERVER_URL` auto-detects: same origin in production,
   `localhost:3000` in dev. No changes needed.

## Deploying to Render

1. New Web Service → connect GitHub repo.
2. Build command: `npm install`
3. Start command: `npm start`
4. Done — free tier supports WebSockets.

## Security Notes for Production

- In `server/index.js`, restrict CORS: change `origin: '*'` to your domain.
- Add rate limiting to the 'action' event handler.
- Validate card IDs server-side against the known UNIT_DATA/EQUIP_DATA lists
  to prevent clients injecting custom cards.

## Known Limitations of This PoC

- No reconnect: if a player refreshes mid-game, they lose their slot
  (60s window before room cleanup). True reconnect requires session tokens.
- No spectator mode.
- Room codes expire when both players disconnect.
- Polaris Pact requires the *target* player (not the active player) to
  respond — both players need to be on the page simultaneously.
