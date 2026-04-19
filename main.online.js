/**
 * MAIN.ONLINE.JS
 * Entry point for the online build.
 *
 * Replaces main.js. Instead of reading decks from sessionStorage and
 * calling initHandlers(), this module:
 *   1. Shows the lobby UI (create/join room).
 *   2. Waits for the opponent to connect.
 *   3. Receives 'game_start' from the server.
 *   4. Calls initOnlineHandlers(socket, roomCode, playerIdx).
 *
 * HOW TO ACTIVATE IN index.html:
 *   Change: <script type="module" src="main.js"></script>
 *   To:     <script type="module" src="main.online.js"></script>
 *
 * The lobby overlay is injected dynamically below so no HTML changes
 * are needed in index.html.
 */

import { io }                  from 'https://cdn.socket.io/4.7.5/socket.io.esm.min.js';
import { addLog }              from './ui/renderer.js';
import { initOnlineHandlers }  from './ui/handlers.online.js';

// ---------------------------------------------------------------------------
// Inject lobby overlay into the DOM
// ---------------------------------------------------------------------------
const lobbyHTML = `
<div id="lobby-overlay" style="
  position:fixed; inset:0; z-index:500;
  background:#05111e;
  display:flex; flex-direction:column;
  align-items:center; justify-content:center;
  gap:20px; font-family:'Orbitron',sans-serif;
">
  <div style="font-size:28px;color:#0099ff;letter-spacing:4px;text-shadow:0 0 30px #0066cc;">
    SEGA CARD GAME
  </div>
  <div style="font-size:10px;color:#557799;letter-spacing:3px;">ONLINE MULTIPLAYER</div>

  <!-- Status line -->
  <div id="lobby-status" style="
    min-height:20px;font-size:11px;color:#ffd700;letter-spacing:1px;text-align:center;
  "></div>

  <!-- Deck requirement notice -->
  <div id="lobby-deck-notice" style="
    font-size:9px;color:#cc4444;display:none;
    border:1px solid #cc4444;padding:8px 16px;border-radius:4px;text-align:center;
    max-width:320px;line-height:1.6;
  ">
    ⚠ No deck found. Please build your deck first.
    <br><a href="deck-builder-online.html" style="color:#ffd700;">Go to Deck Builder →</a>
  </div>

  <!-- Buttons -->
  <div id="lobby-buttons" style="display:flex;flex-direction:column;gap:10px;width:260px;">
    <button id="btn-create-room" class="action-btn gold" style="
      font-size:12px;padding:14px;letter-spacing:2px;
    ">✦ CREATE ROOM</button>

    <div style="display:flex;gap:8px;align-items:center;">
      <input id="room-code-input" placeholder="ROOM CODE" maxlength="4" style="
        flex:1; background:#0a1a2e; border:1px solid #1a3a5e;
        color:#ffffff; font-family:'Orbitron',sans-serif;
        font-size:14px; padding:10px 12px; border-radius:4px;
        text-transform:uppercase; letter-spacing:3px; text-align:center;
        outline:none;
      ">
      <button id="btn-join-room" class="action-btn" style="
        font-size:11px;padding:10px 14px;white-space:nowrap;
      ">JOIN →</button>
    </div>
  </div>

  <!-- Room code display (after creation) -->
  <div id="room-code-display" style="display:none;text-align:center;">
    <div style="font-size:10px;color:#557799;letter-spacing:2px;margin-bottom:6px;">YOUR ROOM CODE</div>
    <div id="room-code-value" style="
      font-size:36px;color:#ffd700;letter-spacing:8px;
      text-shadow:0 0 20px #ffd700;
    "></div>
    <div style="font-size:9px;color:#557799;margin-top:8px;">Share this with your opponent</div>
  </div>

  <!-- Waiting spinner -->
  <div id="lobby-waiting" style="display:none;font-size:10px;color:#557799;letter-spacing:2px;">
    ● WAITING FOR OPPONENT ●
  </div>

  <a href="deck-builder.html" style="
    font-size:8px;color:#334455;letter-spacing:2px;
    text-decoration:none;border-bottom:1px solid #334455;
    margin-top:8px;
  ">DECK BUILDER</a>
</div>
`;

document.body.insertAdjacentHTML('afterbegin', lobbyHTML);

// ---------------------------------------------------------------------------
// Read saved deck from sessionStorage (set by deck-builder)
// ---------------------------------------------------------------------------
function getSavedDeck() {
  const raw = sessionStorage.getItem('deck_p1') ?? sessionStorage.getItem('deck_p2');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Connect socket
// ---------------------------------------------------------------------------
// Server URL priority:
//   1. Set by home.html via sessionStorage (when ONLINE_SERVER_URL is configured)
//   2. localhost:3000 in local dev
//   3. Same origin (when server and client are deployed together)
const SERVER_URL = sessionStorage.getItem('online_server_url')
  || (window.location.hostname === 'localhost' ? 'http://localhost:3000' : window.location.origin);

// Ensure the nav deck-builder button routes correctly even if home.html wasn't used
sessionStorage.setItem('online_server_url', SERVER_URL);

const socket = io(SERVER_URL, { autoConnect: false });

// ---------------------------------------------------------------------------
// Lobby logic
// ---------------------------------------------------------------------------
let _roomCode    = null;
let _playerIdx   = null;

const $status      = () => document.getElementById('lobby-status');
const $buttons     = () => document.getElementById('lobby-buttons');
const $codeDisplay = () => document.getElementById('room-code-display');
const $codeValue   = () => document.getElementById('room-code-value');
const $waiting     = () => document.getElementById('lobby-waiting');
const $deckNotice  = () => document.getElementById('lobby-deck-notice');

function setStatus(msg, color = '#ffd700') {
  const el = $status();
  if (!el) return; // lobby overlay may have been removed after game_start
  el.textContent = msg;
  el.style.color = color;
}

function lockButtons() {
  const el = $buttons();
  if (el) el.style.display = 'none';
}

document.getElementById('btn-create-room').addEventListener('click', () => {
  const saved = getSavedDeck();
  if (!saved) { $deckNotice().style.display = 'block'; return; }
  $deckNotice().style.display = 'none';
  socket.connect();
  setStatus('Connecting…');
  socket.once('connect', () => {
    socket.emit('create_room', { deck: saved.deck, deckName: saved.deckName ?? 'Custom Deck', leaderId: saved.leaderId ?? 'sonic' });
  });
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  const code  = document.getElementById('room-code-input').value.toUpperCase().trim();
  if (code.length !== 4) { setStatus('Enter a 4-character room code.', '#cc4444'); return; }
  const saved = getSavedDeck();
  if (!saved) { $deckNotice().style.display = 'block'; return; }
  $deckNotice().style.display = 'none';
  socket.connect();
  setStatus('Connecting…');
  socket.once('connect', () => {
    socket.emit('join_room', { roomCode: code, deck: saved.deck, deckName: saved.deckName ?? 'Custom Deck', leaderId: saved.leaderId ?? 'sonic' });
  });
});

// Force uppercase in code input
document.getElementById('room-code-input').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase();
});

// ── Server responses ─────────────────────────────────────────────────────────

socket.on('room_created', ({ roomCode, playerIdx }) => {
  _roomCode  = roomCode;
  _playerIdx = playerIdx;
  lockButtons();
  $codeValue().textContent = roomCode;
  $codeDisplay().style.display = 'block';
  $waiting().style.display = 'block';
  setStatus('Room created! Waiting for opponent…');
});

socket.on('room_joined', ({ roomCode, playerIdx }) => {
  _roomCode  = roomCode;
  _playerIdx = playerIdx;
  lockButtons();
  setStatus('Joined! Starting game…');
});

socket.on('game_start', ({ playerIdx, roomCode: gameRoomCode, firstPlayer, deckNames, initialState, logEntries }) => {
  _playerIdx = playerIdx;
  // Use roomCode from game_start payload — for Player 2, room_joined may not
  // have arrived yet so _roomCode could still be null at this point.
  if (gameRoomCode) _roomCode = gameRoomCode;
  setStatus('Game starting!', '#00ff66');

  document.getElementById('lobby-overlay').remove();
  addLog('=== SEGA CARD GAME TCG — ONLINE ===', 'phase');
  addLog(`P1: ${deckNames[0]}  |  P2: ${deckNames[1]}`, 'phase');
  addLog(`Coin flip → Player ${firstPlayer + 1} goes first!`, 'phase');
  initOnlineHandlers(socket, _roomCode, _playerIdx);
  
  setTimeout(() => {
    socket.emit('action', { roomCode: _roomCode, type: 'REQUEST_STATE', payload: {} });
  }, 50);
});


socket.on('error', ({ message }) => {
  setStatus(`Error: ${message}`, '#cc4444');
  // Re-show buttons so player can retry (elements may not exist if game already started)
  const btns    = $buttons();
  const waiting = $waiting();
  if (btns)    btns.style.display    = 'flex';
  if (waiting) waiting.style.display = 'none';
});

socket.on('disconnect', () => {
  setStatus('Disconnected from server.', '#cc4444');
});