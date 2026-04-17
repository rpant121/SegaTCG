# INSTALL GUIDE — Online Multiplayer

This zip contains the **online multiplayer additions** for the Sega Card Game TCG.
Your existing project files (engine/, ui/, index.html, etc.) are untouched.

---

## What's in this zip

```
sega-card-game-online/
├── INSTALL.md              ← this file
├── README.md               ← full setup & deployment docs
├── package.json            ← npm dependencies (express, socket.io)
├── server/
│   ├── index.js            ← Express + Socket.io server entry point
│   └── gameRoom.js         ← Per-game state manager & action dispatcher
├── ui/
│   └── handlers.online.js  ← Drop-in online replacement for ui/handlers.js
└── main.online.js          ← Online lobby entry point (replaces main.js)
```

---

## Step 1 — Copy files into your project

Copy each file to the matching path in your existing project root:

```
YOUR PROJECT ROOT/
├── package.json            ← COPY HERE (or merge if you have one)
├── main.online.js          ← COPY HERE (sits next to your main.js)
├── server/
│   ├── index.js            ← COPY HERE (new folder)
│   └── gameRoom.js         ← COPY HERE
└── ui/
    └── handlers.online.js  ← COPY HERE (next to your handlers.js)
```

Your existing files (`engine/`, `ui/handlers.js`, `ui/renderer.js`,
`ui/styles.css`, `index.html`, `deck-builder.html`, `main.js`) stay
exactly as they are — nothing is overwritten.

---

## Step 2 — Install dependencies

```bash
npm install
```

This installs `express` and `socket.io`.

---

## Step 3 — Activate online mode in index.html

Open `index.html` and find the **last script tag** at the bottom. Change:

```html
<script type="module" src="main.js"></script>
```

to:

```html
<script type="module" src="main.online.js"></script>
```

That's the only change to any existing file.

> To switch back to local pass-and-play, just swap it back.

---

## Step 4 — Start the server

```bash
npm start
# or for auto-restart during development:
npm run dev
```

The server runs on `http://localhost:3000` by default.

---

## Step 5 — Play

1. Both players open `http://localhost:3000` in their own browser.
2. Player 1 clicks **"Create Room"** → gets a 4-letter code (e.g. `WXYZ`).
3. Player 2 enters the code and clicks **"Join"**.
4. Both players need a saved deck (built in the Deck Builder).
5. Game starts automatically once both players are connected.

---

## Deploying online (so players don't need to be on the same network)

**Railway (recommended — free tier, ~2 min setup):**
1. Push your project to a GitHub repo.
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub.
3. Railway auto-detects `package.json` and runs `npm start`.
4. Share the generated URL with your opponent.

**Render:**
1. New Web Service → connect repo.
2. Build command: `npm install`
3. Start command: `npm start`
4. Free tier includes WebSocket support.

The server URL is auto-detected in `main.online.js`:
- Same origin when deployed (production)
- `localhost:3000` when running locally

---

## File roles at a glance

| File | What it does |
|---|---|
| `server/index.js` | Express server + Socket.io lobby. Creates rooms, routes connections. |
| `server/gameRoom.js` | Owns the live `gameState` for one game. Validates & dispatches all actions. Sanitizes state before sending to each player so hands stay hidden. |
| `main.online.js` | Lobby UI overlay (Create/Join room). Connects socket, waits for `game_start`, then hands off to `handlers.online.js`. |
| `ui/handlers.online.js` | Replaces `handlers.js` for the online build. Every click emits an action to the server instead of calling the engine directly. Renderer is unchanged. |

---

## Troubleshooting

**"Room not found"** — Make sure both players are connecting to the same server URL.

**"Invalid deck"** — Each player needs a saved deck from the Deck Builder before joining. The deck is read from `sessionStorage` (`deck_p1` or `deck_p2`).

**Blank screen after joining** — Check browser console for import errors. The `engine/` path in `handlers.online.js` imports from `../engine/` — confirm your file paths match.

**Socket not connecting locally** — Make sure `npm start` is running and you're opening `http://localhost:3000`, not opening the HTML file directly with `file://`.
