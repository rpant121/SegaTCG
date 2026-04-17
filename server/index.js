/**
 * SERVER — index.js
 * Express + Socket.io entry point.
 * Handles lobby, room creation/joining, and routes socket events to GameRoom.
 *
 * Run:
 *   npm install express socket.io
 *   node server/index.js
 *
 * Env vars (optional):
 *   PORT=3000   — default 3000
 */

import express    from 'express';
import http       from 'http';
import { Server } from 'socket.io';
import path       from 'path';
import { fileURLToPath } from 'url';
import { GameRoom } from './gameRoom.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT      = process.env.PORT ?? 3000;

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },   // tighten this in production
});

// Serve the client files from the project root (one level up from server/)
app.use(express.static(path.resolve(__dirname, '..')));

// Fallback: any unknown route → deck-builder (client-side navigation)
app.get('*', (_req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'deck-builder.html'));
});

// ---------------------------------------------------------------------------
// Lobby state
// ---------------------------------------------------------------------------
/** @type {Map<string, GameRoom>} roomCode → GameRoom */
const rooms = new Map();

function generateCode() {
  // 4-character alphanumeric, easy to type
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateCode() : code; // retry on collision (extremely rare)
}

function cleanupRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.isEmpty()) {
    rooms.delete(code);
    console.log(`[Lobby] Room ${code} deleted (empty)`);
  }
}

// ---------------------------------------------------------------------------
// Socket.io events
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  console.log(`[Lobby] Connected: ${socket.id}`);

  // ── CREATE ROOM ──────────────────────────────────────────────────────────
  // Client sends: { deck: string[], deckName: string }
  // Server replies: { roomCode, playerIdx: 0 }
  socket.on('create_room', ({ deck, deckName, leaderId } = {}) => {
    if (!Array.isArray(deck) || deck.length !== 30) {
      return socket.emit('error', { message: 'Invalid deck: must be 30 cards.' });
    }
    const code = generateCode();
    const room = new GameRoom(code, io);
    rooms.set(code, room);

    const idx = room.join(socket, deck, deckName ?? 'Custom Deck', leaderId ?? 'sonic');
    console.log(`[Lobby] Room ${code} created by ${socket.id} (P${idx + 1})`);

    socket.emit('room_created', { roomCode: code, playerIdx: idx });
  });

  // ── JOIN ROOM ────────────────────────────────────────────────────────────
  // Client sends: { roomCode: string, deck: string[], deckName: string }
  // Server replies: { roomCode, playerIdx: 1 } then both players get 'game_start'
  socket.on('join_room', ({ roomCode, deck, deckName, leaderId } = {}) => {
    const code = (roomCode ?? '').toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) {
      return socket.emit('error', { message: `Room "${code}" not found.` });
    }
    if (room.isFull()) {
      return socket.emit('error', { message: `Room "${code}" is already full.` });
    }
    if (!Array.isArray(deck) || deck.length !== 30) {
      return socket.emit('error', { message: 'Invalid deck: must be 30 cards.' });
    }

    const idx = room.join(socket, deck, deckName ?? 'Custom Deck', leaderId ?? 'sonic');
    console.log(`[Lobby] ${socket.id} joined room ${code} (P${idx + 1})`);

    socket.emit('room_joined', { roomCode: code, playerIdx: idx });
    // GameRoom.join() calls startGame() when full, which emits 'game_start' to both
  });

  // ── GAME ACTIONS ─────────────────────────────────────────────────────────
  // Client sends: { roomCode, type, payload }
  socket.on('action', ({ roomCode, type, payload } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) return socket.emit('error', { message: 'Room not found.' });
    room.handleAction(socket, type, payload ?? {});
  });

  // ── DISCONNECT ───────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[Lobby] Disconnected: ${socket.id}`);
    // Notify opponent and mark room for cleanup
    for (const [code, room] of rooms.entries()) {
      if (room.hasSocket(socket.id)) {
        room.handleDisconnect(socket.id);
        // Give 60 s for reconnect before deleting
        setTimeout(() => cleanupRoom(code), 60_000);
        break;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`\n🎮  Sega Card Game server running at http://localhost:${PORT}\n`);
});