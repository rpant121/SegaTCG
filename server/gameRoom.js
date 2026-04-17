/**
 * GAME ROOM — gameRoom.js
 * Manages one live game between two players.
 * Owns the canonical gameState; validates and dispatches all actions.
 * Broadcasts sanitized state to each player after every mutation.
 *
 * The engine is imported from ../engine/* — these are the same files used
 * by the local build, zero modification needed.
 */

import { createInitialState, opponent } from '../engine/state.js';
import { checkWin }                     from '../engine/combat.js';
import { attackLeader, applyDamageToUnit, resolveBlock } from '../engine/combat.js';
import {
  playCardFromHand, resolveExtremeGear,
  tailsActive, knucklesActive, amyActive, creamActive, bigActive,
  silverActive, shadowActive, mightyActive, rougeActive, blazeActive,
  rayActive, charmyActive, espioActive, vectorActive, sonicActive,
} from '../engine/actions.js';
import {
  startTurn, resolveBigScry,
  enterAttackPhase, enterEndPhase, advanceTurn,
} from '../engine/phases.js';

// ---------------------------------------------------------------------------
// Sanitize: hide opponent's hand and deck contents from each client
// ---------------------------------------------------------------------------
// Redact opponent card names from draw log entries so neither player
// can see what the other drew.
// Affected patterns:
//   "📄 Player N draws CardName"  → "📄 Player N draws a card"  (for opponent)
//   "📄 Player N draws CardName"  → unchanged                   (for self)
function sanitizeLogForPlayer(logEntries, viewerIdx) {
  return logEntries.map(entry => {
    if (!entry.msg) return entry;
    // Match draw entries: emoji + "Player N draws <name>"
    const drawMatch = entry.msg.match(/^(📄 Player )(\d+)( draws )(.+)$/);
    if (drawMatch) {
      const playerNum = parseInt(drawMatch[2], 10); // 1-based
      const playerIdx = playerNum - 1;              // 0-based
      if (playerIdx !== viewerIdx) {
        // Redact the card name for the opponent
        return { ...entry, msg: `${drawMatch[1]}${drawMatch[2]}${drawMatch[3]}a card` };
      }
    }
    return entry;
  });
}

function sanitizeForPlayer(state, viewerIdx) {
  return {
    ...state,
    players: state.players.map((p, i) => {
      if (i !== viewerIdx) {
        return {
          ...p,
          hand: p.hand.map(() => ({ hidden: true })),
          deck: p.deck.map(() => ({ hidden: true })),
        };
      }
      return p;
    }),
  };
}

// ---------------------------------------------------------------------------
// Simple log collector — gathered per-action then sent with state broadcast
// ---------------------------------------------------------------------------
function makeLog() {
  const entries = [];
  const fn = (msg, type = 'phase') => entries.push({ msg, type });
  fn.flush = () => entries.splice(0);
  return fn;
}

// ---------------------------------------------------------------------------
// GameRoom
// ---------------------------------------------------------------------------
export class GameRoom {
  /**
   * @param {string} roomCode
   * @param {import('socket.io').Server} io
   */
  constructor(roomCode, io) {
    this.roomCode   = roomCode;
    this.io         = io;
    this.sockets    = [null, null];   // socket.id per playerIdx
    this.decks      = [null, null];   // card id arrays
    this.leaderIds  = ['sonic', 'sonic'];
    this.deckNames  = ['Custom Deck', 'Custom Deck'];
    this.state      = null;
    this.log        = makeLog();
    this._gameOver  = false;
  }

  // ── Membership ────────────────────────────────────────────────────────────

  join(socket, deck, deckName, leaderId = 'sonic') {
    const slot = this.sockets.indexOf(null);
    if (slot === -1) throw new Error('Room is full');

    this.sockets[slot]   = socket.id;
    this.decks[slot]     = deck;
    this.deckNames[slot] = deckName;
    this.leaderIds[slot] = leaderId;

    socket.join(this.roomCode);

    // Both players seated → start the game
    if (this.isFull()) this._startGame();

    return slot;
  }

  isFull()    { return this.sockets.every(Boolean); }
  isEmpty()   { return this.sockets.every(s => !s); }
  hasSocket(id) { return this.sockets.includes(id); }

  // ── Game start ────────────────────────────────────────────────────────────

  _startGame() {
    this.state = createInitialState(this.decks[0], this.decks[1], this.leaderIds[0], this.leaderIds[1]);

    // Concurrent setup: both players deploy simultaneously
    this.state.phase = 'setup';
    this.state._setupReady = [false, false];
    delete this.state._setupPlayer;

    // Emit game_start WITH the initial sanitized state embedded so the client
    // doesn't need a separate REQUEST_STATE round-trip.
    this.sockets.forEach((socketId, idx) => {
      this.io.to(socketId).emit('game_start', {
        playerIdx:   idx,
        roomCode:    this.roomCode,
        deckNames:   this.deckNames,
        firstPlayer: this.state.activePlayer,
        initialState: this._sanitizeForPlayer(this.state, idx),
        logEntries:  [{ msg: '=== GAME START ===', type: 'phase' }],
      });
    });
  }

  // ── Action dispatch ───────────────────────────────────────────────────────

  /**
   * Route an incoming action from a socket to the correct engine function.
   * Validates that it is the sender's turn (except for async prompts that
   * the non-active player must answer, e.g. Polaris Pact target selection).
   */
  handleAction(socket, type, payload) {
    if (this._gameOver || !this.state) return;

    const playerIdx = this.sockets.indexOf(socket.id);
    if (playerIdx === -1) return; // unknown socket

    const state = this.state;
    const log   = this.log;

    try {
      // Actions that ANY player can take (async resolution prompts or utility)
      const asyncActions = new Set([
        'RESOLVE_POLARIS_PACT',
        'REQUEST_STATE',
        'SETUP_DONE',   // both players complete setup independently
      ]);

      // During setup, both players can deploy units freely
      if (state.phase === 'setup' && type === 'PLAY_CARD') {
        const card = state.players[playerIdx].hand[payload.handIdx];
        if (!card) throw new Error('No card at that hand index.');
        if (card.type !== 'Unit') throw new Error('Only units can be deployed during setup.');
        if (state.players[playerIdx].bench.length >= 3) throw new Error('Bench is full.');
        state.players[playerIdx].hand.splice(payload.handIdx, 1);
        state.players[playerIdx].bench.push({ ...card, currentHp: card.hp, exhausted: false });
        log(`📌 Player ${playerIdx + 1} deploys ${card.name}`, 'play');
        this._broadcast({ logEntries: log.flush() });
        return;
      }

      // For most actions, enforce active-player turn ownership
      if (!asyncActions.has(type) && playerIdx !== state.activePlayer) {
        // Special: pendingBlock is answered by the DEFENDING player
        if (type !== 'RESOLVE_BLOCK' || !state.pendingBlock) {
          socket.emit('action_error', { message: "It's not your turn." });
          return;
        }
        // Validate defending player owns the block response
        const defenderIdx = state.pendingBlock.defenderP;
        if (playerIdx !== defenderIdx) {
          socket.emit('action_error', { message: "You are not the defending player." });
          return;
        }
      }

      this._dispatch(type, payload, playerIdx, log);

      // Check win after every action
      const loser = checkWin(state);
      if (loser !== null && !this._gameOver) {
        this._gameOver = true;
        this._broadcast({ logEntries: log.flush(), winner: opponent(loser) });
        return;
      }

      this._broadcast({ logEntries: log.flush() });

    } catch (err) {
      console.error(`[Room ${this.roomCode}] Action error (${type}):`, err.message);
      socket.emit('action_error', { message: err.message });
    }
  }

  _dispatch(type, payload, playerIdx, log) {
    const state = this.state;
    // emit shim: server-side emit drives broadcast, not UI overlays
    const emit  = (event, data) => {
      // 'request_pass' and 'phase_changed' are inferred by the client from state
      // 'scry_prompt' is detected via state.pendingBigScry presence
    };

    switch (type) {

      // ── Setup ────────────────────────────────────────────────────────────
      case 'SETUP_DONE': {
        // Concurrent setup: each player marks themselves ready independently
        if (!state._setupReady) state._setupReady = [false, false];
        state._setupReady[playerIdx] = true;
        log(`Player ${playerIdx + 1} ready`, 'phase');
        // Once both players are ready, start the game
        if (state._setupReady[0] && state._setupReady[1]) {
          delete state._setupReady;
          state.phase = 'big_scry';
          startTurn(state, log, emit);
        }
        break;
      }

      // ── Deploy unit during setup (also works in main phase) ───────────────
      case 'PLAY_CARD': {
        const { handIdx } = payload;
        playCardFromHand(state, handIdx, log);
        break;
      }

      // ── Leader Active (Sonic) ─────────────────────────────────────────────
      case 'USE_LEADER_ACTIVE': {
        const { handIdx } = payload;
        sonicActive(state, handIdx, log);
        break;
      }

      // ── Unit Actives ──────────────────────────────────────────────────────
      case 'USE_UNIT_ACTIVE': {
        const { benchIdx, targetType, targetBenchIdx, discardIdx, handIndices } = payload;
        const unit = state.players[playerIdx].bench[benchIdx];
        if (!unit) throw new Error('No unit at that bench slot.');

        switch (unit.id) {
          case 'tails':    tailsActive(state, playerIdx, benchIdx, discardIdx, log);                          break;
          case 'knuckles': knucklesActive(state, playerIdx, benchIdx, targetBenchIdx, log);                   break;
          case 'amy':      amyActive(state, playerIdx, benchIdx, log);                                        break;
          case 'cream':    creamActive(state, playerIdx, benchIdx, targetType, targetBenchIdx, log);          break;
          case 'big':      bigActive(state, playerIdx, benchIdx, log);                                        break;
          case 'silver':   silverActive(state, playerIdx, benchIdx, targetBenchIdx, log);                     break;
          case 'shadow':   shadowActive(state, playerIdx, benchIdx, log);                                     break;
          case 'mighty':
            mightyActive(state, playerIdx, benchIdx, log);
            // Mighty's effect: grant a second attack phase this turn
            if (state.pendingMightyAttack) {
              state.pendingMightyAttack = false;
              enterAttackPhase(state, log, emit);
            }
            break;
          case 'rouge':    rougeActive(state, playerIdx, benchIdx, log);                                      break;
          case 'blaze':    blazeActive(state, playerIdx, benchIdx, log);                                      break;
          case 'ray':      rayActive(state, playerIdx, benchIdx, log);                                        break;
          case 'charmy':   charmyActive(state, playerIdx, benchIdx, log);                                     break;
          case 'espio':    espioActive(state, playerIdx, benchIdx, log);                                      break;
          case 'vector':   vectorActive(state, playerIdx, benchIdx, log);                                     break;
          default: throw new Error(`Unknown unit active: ${unit.id}`);
        }
        break;
      }

      // ── Async resolution: Big Scry ────────────────────────────────────────
      case 'RESOLVE_BIG_SCRY': {
        const { shouldDiscard } = payload;
        resolveBigScry(state, shouldDiscard, log, emit);
        break;
      }

      // ── Async resolution: block modal ─────────────────────────────────────
      case 'RESOLVE_BLOCK': {
        const { blockBenchIdx } = payload; // null = take the hit
        const { attackerP, defenderP } = state.pendingBlock;
        state.pendingBlock = null;
        if (blockBenchIdx === null || blockBenchIdx === undefined) {
          attackLeader(state, attackerP, defenderP, log);
        } else {
          resolveBlock(state, attackerP, defenderP, blockBenchIdx, log);
        }
        if (checkWin(state) === null) enterEndPhase(state, log, emit);
        break;
      }

      // ── Async resolution: Extreme Gear ────────────────────────────────────
      case 'RESOLVE_EXTREME_GEAR': {
        const { handIndices } = payload;
        if (!state.pendingExtremeGear) throw new Error('No pending Extreme Gear.');
        resolveExtremeGear(state, handIndices ?? [], log);
        break;
      }

      // ── Async resolution: Dragon's Eye ────────────────────────────────────
      case 'RESOLVE_DRAGONS_EYE': {
        const { deckIdx } = payload;
        if (!state.pendingDragonsEye) throw new Error('No pending Dragon\'s Eye.');
        const { playerIdx: pi, cards } = state.pendingDragonsEye;
        const card = cards[deckIdx];
        if (!card) throw new Error('Invalid deck index for Dragon\'s Eye.');
        state.players[pi].deck = state.players[pi].deck.filter(c => c.uid !== card.uid);
        state.players[pi].hand.push(card);
        log(`👁 Dragon's Eye: ${card.name} taken into hand`, 'draw');
        state.pendingDragonsEye = null;
        break;
      }

      // ── Async resolution: Ray active ──────────────────────────────────────
      case 'RESOLVE_RAY': {
        const { deckIdx } = payload;
        if (!state.pendingRayActive) throw new Error('No pending Ray active.');
        const { playerIdx: pi, cards } = state.pendingRayActive;
        const card = cards[deckIdx];
        if (!card) throw new Error('Invalid index for Ray active.');
        state.players[pi].deck = state.players[pi].deck.filter(c => c.uid !== card.uid);
        state.players[pi].discard.push(card);
        log(`🐿 Ray: ${card.name} sent to discard`, 'play');
        // Rouge passive: deck→discard event
        const rouge = state.players[pi].bench.find(u => u.id === 'rouge' && !u.exhausted);
        if (rouge && state.players[pi].deck.length > 0) {
          const drawn = state.players[pi].deck.shift();
          state.players[pi].hand.push(drawn);
          state.missedDraws[pi] = 0;
          log(`🦇 Rouge: draws ${drawn.name} (Ray discard event)`, 'draw');
        }
        state.pendingRayActive = null;
        break;
      }

      // ── Async resolution: Polaris Pact ────────────────────────────────────
      case 'RESOLVE_POLARIS_PACT': {
        const { targetHandIdx } = payload;
        if (!state.pendingPolarisPact) throw new Error('No pending Polaris Pact.');
        const { opponentIdx } = state.pendingPolarisPact;
        // Must be answered by the opponent whose hand is being targeted
        if (playerIdx !== opponentIdx) throw new Error('You are not the target of Polaris Pact.');
        const hand = state.players[opponentIdx].hand;
        if (targetHandIdx < 0 || targetHandIdx >= hand.length) throw new Error('Invalid hand index.');
        const disc = hand.splice(targetHandIdx, 1)[0];
        state.players[opponentIdx].discard.push(disc);
        log(`🌌 Polaris Pact: P${opponentIdx + 1} discards ${disc.name}`, 'damage');
        state.pendingPolarisPact = null;
        break;
      }

      // ── Phase transitions ─────────────────────────────────────────────────
      case 'ENTER_ATTACK_PHASE': {
        if (state.phase !== 'main') throw new Error('Not in Main Phase.');
        enterAttackPhase(state, log, emit);
        break;
      }

      case 'ATTACK': {
        if (state.phase !== 'attack') throw new Error('Not in Attack Phase.');
        const { targetType, targetBenchIdx } = payload;
        const opp = opponent(playerIdx);
        if (targetType === 'leader') {
          const canBlock = state.players[opp].bench.some(u => !u.exhausted);
          if (canBlock) {
            // Store pending block — defender must respond
            state.pendingBlock = { attackerP: playerIdx, defenderP: opp };
          } else {
            attackLeader(state, playerIdx, opp, log);
            if (checkWin(state) === null) enterEndPhase(state, log, emit);
          }
        } else if (targetType === 'unit') {
          applyDamageToUnit(state, playerIdx, opp, targetBenchIdx, log);
          if (checkWin(state) === null) enterEndPhase(state, log, emit);
        } else {
          throw new Error(`Unknown attack target type: ${targetType}`);
        }
        break;
      }

      case 'END_PHASE': {
        // Only valid escape: skip Attack Phase (if allowed by future rule)
        // For now just guard against misuse
        if (state.phase === 'attack') {
          enterEndPhase(state, log, emit);
        } else {
          throw new Error('Cannot skip to end phase from ' + state.phase);
        }
        break;
      }

      case 'ADVANCE_TURN': {
        // Sent after pass screen is acknowledged
        if (state.phase !== 'end') throw new Error('Not in End Phase.');
        advanceTurn(state, log, emit);
        break;
      }

      // ── State resync request (sent by client after game_start) ─────────────
      case 'REQUEST_STATE':
        // Just re-broadcast — no state mutation needed
        break;

      // ── Skip attack (cancel attack phase → end phase) ─────────────────────
      case 'SKIP_ATTACK': {
        if (state.phase !== 'attack') throw new Error('Not in attack phase.');
        enterEndPhase(state, log, emit);
        break;
      }

      default:
        throw new Error(`Unknown action type: "${type}"`);
    }
  }

  // ── Disconnect ────────────────────────────────────────────────────────────

  handleDisconnect(socketId) {
    const idx = this.sockets.indexOf(socketId);
    if (idx === -1) return;
    console.log(`[Room ${this.roomCode}] P${idx + 1} disconnected`);

    // Notify opponent
    const oppIdx = opponent(idx);
    const oppId  = this.sockets[oppIdx];
    if (oppId) {
      this.io.to(oppId).emit('opponent_disconnected', {
        message: `Player ${idx + 1} disconnected. Waiting 60s for reconnect...`,
      });
    }

    this.sockets[idx] = null; // clear slot for potential reconnect
  }

  // ── Broadcast helpers ─────────────────────────────────────────────────────

  /**
   * Send each player their sanitized view of the state.
   * @param {{ logEntries?: Array, winner?: number }} extra
   */
  _broadcast(extra = {}) {
    this.sockets.forEach((socketId, idx) => {
      if (!socketId) return;
      const payload = {
        state:        sanitizeForPlayer(this.state, idx),
        logEntries:   sanitizeLogForPlayer(extra.logEntries ?? [], idx),
        pendingBlock: this.state.pendingBlock
          ? (idx === this.state.pendingBlock.defenderP
              ? this.state.pendingBlock
              : null)
          : null,
      };
      if (extra.winner !== undefined) payload.winner = extra.winner;
      this.io.to(socketId).emit('state_update', payload);
    });
  }

  _sanitizeForPlayer(state, viewerIdx) {
    return sanitizeForPlayer(state, viewerIdx);
  }

  _broadcastToPlayer(idx, event, payload) {
    const socketId = this.sockets[idx];
    if (socketId) this.io.to(socketId).emit(event, payload);
  }
}