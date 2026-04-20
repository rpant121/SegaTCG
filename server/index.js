/**
 * SERVER — index.js
 * Express + Socket.io entry point.
 *
 * Changes:
 *  - Added 'rejoin_room' handler so clients that reconnect (new socket.id)
 *    are re-seated in their existing GameRoom. This fixes the silent drop
 *    of all actions after a transport-level reconnect during setup.
 */

import express    from 'express';
import http       from 'http';
import { Server } from 'socket.io';
import path       from 'path';
import { fileURLToPath } from 'url';
import { GameRoom } from './gameRoom.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT      = process.env.PORT ?? 3000;

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  // Give clients a longer window to reconnect before the room is cleaned up
  pingTimeout:  60000,
  pingInterval: 25000,
});

app.use(express.static(path.resolve(__dirname, '..')));
app.get('*', (_req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'deck-builder.html'));
});

// ---------------------------------------------------------------------------
// Lobby state
// ---------------------------------------------------------------------------
/** @type {Map<string, GameRoom>} roomCode → GameRoom */
const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateCode() : code;
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
  });

  // ── REJOIN ROOM ──────────────────────────────────────────────────────────
  // Fired by the client on reconnect (new socket.id, same roomCode + playerIdx).
  // We swap the old socket.id for the new one so handleAction recognises it again.
  socket.on('rejoin_room', ({ roomCode, playerIdx } = {}) => {
    const code = (roomCode ?? '').toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) {
      console.log(`[Lobby] rejoin_room: room ${code} not found`);
      socket.emit('error', { message: `Room "${code}" not found. The game may have ended.` });
      return;
    }

    const ok = room.rejoin(socket, playerIdx);
    if (!ok) {
      console.log(`[Lobby] rejoin_room: slot ${playerIdx} could not be reseated in ${code}`);
      socket.emit('error', { message: 'Could not rejoin room.' });
      return;
    }

    console.log(`[Lobby] ${socket.id} reseated as P${playerIdx + 1} in room ${code}`);
    // Re-broadcast the current state to the rejoining player so they're in sync
    room.broadcastStateTo(playerIdx);
  });

  // ── GAME ACTIONS ─────────────────────────────────────────────────────────
  socket.on('action', ({ roomCode, type, payload } = {}) => {
    const room = rooms.get(roomCode);
    if (!room) return socket.emit('error', { message: 'Room not found.' });
    room.handleAction(socket, type, payload ?? {});
  });

  // ── DISCONNECT ───────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[Lobby] Disconnected: ${socket.id}`);
    for (const [code, room] of rooms.entries()) {
      if (room.hasSocket(socket.id)) {
        room.handleDisconnect(socket.id);
        // Give 60s for reconnect before deleting the room
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