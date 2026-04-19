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
import { attackLeader, applyDamageToUnit, resolveIntercept } from '../engine/combat.js';
import {
  playCardFromHand, resolveExtremeGear,
  canAfford, spendEnergy,
  tailsActive, knucklesActive, amyActive, creamActive, bigActive,
  silverActive, shadowActive, mightyActive, rougeActive, blazeActive,
  rayActive, charmyActive, espioActive, vectorActive, sonicActive,
  carolineActive, justineActive, taeTakumiActive, sojiroSakuraActive,
  saeNiijimaActive, sadayoKawakamiActive, suguruKamoshidaActive,
  ryujiSakamotoActive, annTakamakiActive, morganaActive,
  yusukeKitagawaActive, makotoNiijimaActive, futabaSakuraActive,
  haruOkumuraActive, sumireYoshizawaActive,
} from '../engine/actions.js';
import {
  startTurn, resolveBigScry,
  enterAttackPhase, enterEndPhase, advanceTurn,
  drawCards,
} from '../engine/phases.js';

// ---------------------------------------------------------------------------
// Sanitize: hide opponent's hand and deck contents from each client
// ---------------------------------------------------------------------------
// Redact opponent card names from draw log entries so neither player
// can see what the other drew.
// Affected patterns:
//   "📄 Player N draws CardName"  → "📄 Player N draws a card"  (for opponent)
//   "📄 Player N draws CardName"  → unchanged                   (for self)
function sanitizeLogForPlayer(logEntries, viewerIdx, activePlayer) {
  return logEntries.map(entry => {
    if (!entry.msg) return entry;

    // Redact "📄 Player N draws CardName" for opponent.
    // NOTE: emoji like 📄 are 2 code units in JS without /u flag, so use .+ not . for prefix.
    const drawMatch = entry.msg.match(/^(.+Player )(\d+)( draws )(.+)$/u);
    if (drawMatch) {
      const pIdx = parseInt(drawMatch[2], 10) - 1;
      if (pIdx !== viewerIdx) {
        return { ...entry, msg: drawMatch[1] + drawMatch[2] + drawMatch[3] + 'a card' };
      }
    }

    // Redact passive draw logs (Rouge, Vector, Mighty, Tails, etc.)
    // These happen on the active player's turn; hide the card name from the opponent.
    const passiveDrawMatch = entry.msg.match(/^(.+: draws )([^(]+)(.*)$/u);
    if (passiveDrawMatch && typeof activePlayer === 'number' && activePlayer !== viewerIdx) {
      return { ...entry, msg: passiveDrawMatch[1] + 'a card' + (passiveDrawMatch[3] ? ' ' + passiveDrawMatch[3].trim() : '') };
    }

    // Redact setup deployment card names for opponent
    const deployMatch = entry.msg.match(/^__setup_deploy__:(\d+):(.+)$/);
    if (deployMatch) {
      const pIdx = parseInt(deployMatch[1], 10);
      if (pIdx === viewerIdx) {
        return { ...entry, msg: 'You deployed ' + deployMatch[2], type: 'play' };
      } else {
        return { ...entry, msg: 'Opponent deployed a unit', type: 'play' };
      }
    }

    return entry;
  });
}

function sanitizeForPlayer(state, viewerIdx) {
  const isSetup = state.phase === 'setup';
  return {
    ...state,
    players: state.players.map((p, i) => {
      if (i !== viewerIdx) {
        return {
          ...p,
          hand: p.hand.map(() => ({ hidden: true })),
          deck: p.deck.map(() => ({ hidden: true })),
          // During setup: send bench count as face-down placeholders so client
          // knows how many units opponent deployed without seeing which ones
          bench: isSetup ? p.bench.map(() => ({ hidden: true, type: 'Unit' })) : p.bench,
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
        'SETUP_DONE',
        'RESOLVE_INTERCEPT',       // answered by defender (non-active player)
        'RESOLVE_ARSENE',      // active player chooses target
        'RESOLVE_LEBLANC',     // active player chooses card to discard
        'RESOLVE_GUARD_PERSONA', // server-driven, but must be triggerable
      ]);

      // During setup, both players can deploy units freely
      if (state.phase === 'setup' && type === 'PLAY_CARD') {
        const card = state.players[playerIdx].hand[payload.handIdx];
        if (!card) throw new Error('No card at that hand index.');
        if (card.type !== 'Unit') throw new Error('Only units can be deployed during setup.');
        if (state.players[playerIdx].bench.length >= 3) throw new Error('Bench is full.');
        state.players[playerIdx].hand.splice(payload.handIdx, 1);
        state.players[playerIdx].bench.push({ ...card, currentHp: card.hp, exhausted: false });
        // Log generically — each player gets a sanitized version via _broadcast
        log(`__setup_deploy__:${playerIdx}:${card.name}`, 'play');
        this._broadcast({ logEntries: log.flush() });
        return;
      }

      // For most actions, enforce active-player turn ownership
      if (!asyncActions.has(type) && playerIdx !== state.activePlayer) {
        // Special: pendingIntercept is answered by the DEFENDING player
        if (type !== 'RESOLVE_INTERCEPT' || !state.pendingIntercept) {
          socket.emit('action_error', { message: "It's not your turn." });
          return;
        }
        // Validate defending player owns the block response
        const defenderIdx = state.pendingIntercept.defenderP;
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
        const leaderId = state.players[playerIdx].leader.id;
        if (leaderId === 'kiryu') {
          // Kiryu: +10 attack this turn, may be used multiple times
          const leader = state.players[playerIdx].leader;
          if (!canAfford(state, leader.activeCost)) throw new Error('Not enough energy for Kiryu active.');
          spendEnergy(state, leader.activeCost);
          state.powerGloveBuff[playerIdx] = (state.powerGloveBuff[playerIdx] ?? 0) + 10;
          // Note: leaderUsedThisTurn NOT set so Kiryu can activate multiple times
          log('Kazuma Kiryu: +10 attack this turn!', 'play');
        } else if (leaderId === 'joker') {
          // Joker: activate any bench unit's active
          // Cost: 1 energy for unit actives with base cost ≤3, 2 energy for cost ≥4
          const { benchIdx } = payload;
          if (benchIdx === undefined || benchIdx === null) throw new Error('Joker: no bench unit selected.');
          const unit = state.players[playerIdx].bench[benchIdx];
          if (!unit) throw new Error('Joker: no unit at that bench slot.');
          if (state.leaderUsedThisTurn[playerIdx]) throw new Error('Joker active already used this turn.');
          const unitBaseCost = unit.activeCost ?? 0;
          const jokerCost = unitBaseCost >= 4 ? 2 : 1;
          if (!canAfford(state, jokerCost)) throw new Error(`Not enough energy. Joker needs ${jokerCost} energy to copy a cost-${unitBaseCost} active.`);
          spendEnergy(state, jokerCost);
          state.leaderUsedThisTurn[playerIdx] = true;
          log(`Joker: copies ${unit.name}'s active (cost ${unitBaseCost} → paid ${jokerCost}⚡)`, 'play');
          // Fire the copied unit's active via RESOLVE_YUSUKE-style dispatch
          switch (unit.id) {
            case 'tails':    tailsActive(state, playerIdx, benchIdx, payload.discardIdx, log);            break;
            case 'knuckles': knucklesActive(state, playerIdx, benchIdx, payload.targetBenchIdx, log);     break;
            case 'amy':      amyActive(state, playerIdx, benchIdx, log);                                  break;
            case 'cream':    creamActive(state, playerIdx, benchIdx, payload.targetType, payload.targetBenchIdx, log); break;
            case 'big':      bigActive(state, playerIdx, benchIdx, log);                                  break;
            case 'silver':   silverActive(state, playerIdx, benchIdx, payload.targetBenchIdx, log);       break;
            case 'shadow':   shadowActive(state, playerIdx, benchIdx, log);                               break;
            case 'mighty':   mightyActive(state, playerIdx, benchIdx, log);                               break;
            case 'rouge':    rougeActive(state, playerIdx, benchIdx, log);                                break;
            case 'blaze':    blazeActive(state, playerIdx, benchIdx, log);                                break;
            case 'ray':      rayActive(state, playerIdx, benchIdx, log);                                  break;
            case 'charmy':   charmyActive(state, playerIdx, benchIdx, log);                               break;
            case 'espio':    espioActive(state, playerIdx, benchIdx, log);                                break;
            case 'vector':   vectorActive(state, playerIdx, benchIdx, log);                               break;
            case 'caroline':         carolineActive(state, playerIdx, benchIdx, log);          break;
            case 'justine':          justineActive(state, playerIdx, benchIdx, log);           break;
            case 'tae_takumi':       taeTakumiActive(state, playerIdx, benchIdx, log);         break;
            case 'sojiro_sakura':    sojiroSakuraActive(state, playerIdx, benchIdx, log);      break;
            case 'sae_niijima':      saeNiijimaActive(state, playerIdx, benchIdx, log);        break;
            case 'sadayo_kawakami':  sadayoKawakamiActive(state, playerIdx, benchIdx, log);    break;
            case 'suguru_kamoshida': suguruKamoshidaActive(state, playerIdx, benchIdx, log);   break;
            case 'ryuji_sakamoto':   ryujiSakamotoActive(state, playerIdx, benchIdx, log);     break;
            case 'ann_takamaki':     annTakamakiActive(state, playerIdx, benchIdx, log);       break;
            case 'morgana':          morganaActive(state, playerIdx, benchIdx, payload.targetBenchIdx, log); break;
            case 'yusuke_kitagawa':  yusukeKitagawaActive(state, playerIdx, benchIdx, payload.targetBenchIdx, log); break;
            case 'makoto_niijima':   makotoNiijimaActive(state, playerIdx, benchIdx, log);     break;
            case 'futaba_sakura':    futabaSakuraActive(state, playerIdx, benchIdx, log);       break;
            case 'haru_okumura':     haruOkumuraActive(state, playerIdx, benchIdx, log);        break;
            case 'sumire_yoshizawa': sumireYoshizawaActive(state, playerIdx, benchIdx, payload.targetBenchIdx, log); break;
            default: throw new Error('Joker cannot copy: ' + unit.id);
          }
        } else {
          // Sonic (default): discard 1 card from hand, draw 2
          sonicActive(state, handIdx, log);
        }
        break;
      }

      // ── Unit Actives ──────────────────────────────────────────────────────
      case 'USE_UNIT_ACTIVE': {
        const { benchIdx, targetType, targetBenchIdx, discardIdx, handIndices } = payload;
        const unit = state.players[playerIdx].bench[benchIdx];
        if (!unit) throw new Error('No unit at that bench slot.');
        if (state.justineDisabledUid === unit.uid) throw new Error(`${unit.name}'s active is disabled by Justine+Caroline until next turn.`);

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
            // pendingMightyAttack = true: client will show target selection modal.
            // The attack resolves via the ATTACK action below (isMightyAttack flag).
            // We stay in main phase — do NOT call enterAttackPhase here.
            break;
          case 'rouge':    rougeActive(state, playerIdx, benchIdx, log);                                      break;
          case 'blaze':    blazeActive(state, playerIdx, benchIdx, log);                                      break;
          case 'ray':      rayActive(state, playerIdx, benchIdx, log);                                        break;
          case 'charmy':   charmyActive(state, playerIdx, benchIdx, log);                                     break;
          case 'espio':    espioActive(state, playerIdx, benchIdx, log);                                      break;
          case 'vector':   vectorActive(state, playerIdx, benchIdx, log);                                     break;

          // ── Persona 5 Units ─────────────────────────────────────────────
          case 'caroline':          carolineActive(state, playerIdx, benchIdx, log);                                break;
          case 'justine':           justineActive(state, playerIdx, benchIdx, log);                                 break;
          case 'tae_takumi':        taeTakumiActive(state, playerIdx, benchIdx, log);                               break;
          case 'sojiro_sakura':     sojiroSakuraActive(state, playerIdx, benchIdx, log);                            break;
          case 'sae_niijima':       saeNiijimaActive(state, playerIdx, benchIdx, log);                              break;
          case 'sadayo_kawakami':   sadayoKawakamiActive(state, playerIdx, benchIdx, log);                          break;
          case 'suguru_kamoshida':  suguruKamoshidaActive(state, playerIdx, benchIdx, log);                         break;
          case 'ryuji_sakamoto':    ryujiSakamotoActive(state, playerIdx, benchIdx, log);                           break;
          case 'ann_takamaki':      annTakamakiActive(state, playerIdx, benchIdx, log);                             break;
          case 'morgana':           morganaActive(state, playerIdx, benchIdx, payload.targetBenchIdx, log);         break;
          case 'yusuke_kitagawa':   yusukeKitagawaActive(state, playerIdx, benchIdx, payload.targetBenchIdx, log);  break;
          case 'makoto_niijima':    makotoNiijimaActive(state, playerIdx, benchIdx, log);                           break;
          case 'futaba_sakura':     futabaSakuraActive(state, playerIdx, benchIdx, log);                            break;
          case 'haru_okumura':      haruOkumuraActive(state, playerIdx, benchIdx, log);                             break;
          case 'sumire_yoshizawa':  sumireYoshizawaActive(state, playerIdx, benchIdx, payload.targetBenchIdx, log); break;

          default: throw new Error(`Unknown unit active: ${unit.id}`);
        }
        // Justine+Caroline passive: if opponent has both on bench, disable the unit just used
        {
          const oppIdx = opponent(playerIdx);
          const hasCaroline = state.players[oppIdx].bench.some(u => u.id === 'caroline' && !u.exhausted);
          const hasJustine  = state.players[oppIdx].bench.some(u => u.id === 'justine'  && !u.exhausted);
          if (hasCaroline && hasJustine) {
            state.justineDisabledUid = unit.uid;
            log(`Justine+Caroline: ${unit.name}'s active is disabled until next turn`, 'phase');
          }
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
      case 'RESOLVE_INTERCEPT': {
        const { interceptBenchIdx: blockBenchIdx } = payload; // null = take the hit
        const { attackerP, defenderP, isMighty } = state.pendingIntercept;
        state.pendingIntercept = null;
        if (blockBenchIdx === null || blockBenchIdx === undefined) {
          attackLeader(state, attackerP, defenderP, log);
        } else {
          resolveIntercept(state, attackerP, defenderP, blockBenchIdx, log);
        }
        if (checkWin(state) !== null) break;
        // Mighty second attack: return to main phase, not end phase
        if (isMighty) {
          state.phase = 'main';
        } else {
          enterEndPhase(state, log, emit);
        }
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
        if (state.phase !== 'attack' && !state.pendingMightyAttack) throw new Error('Not in Attack Phase.');

        // ── Mighty second attack (fires from main phase) ──────────────────
        if (state.pendingMightyAttack) {
          state.pendingMightyAttack = false;
          const { targetType, targetBenchIdx } = payload;
          const opp = opponent(playerIdx);
          if (targetType === 'leader') {
            const canBlock = state.players[opp].bench.some(u => !u.exhausted);
            if (canBlock) {
              state.pendingIntercept = { attackerP: playerIdx, defenderP: opp, isMighty: true };
            } else {
              attackLeader(state, playerIdx, opp, log);
              // Win check — if game continues, return to main phase (don't enter end phase)
              if (checkWin(state) !== null) break;
            }
          } else if (targetType === 'unit') {
            applyDamageToUnit(state, playerIdx, opp, targetBenchIdx, log);
            if (checkWin(state) !== null) break;
          } else {
            throw new Error(`Unknown attack target type: ${targetType}`);
          }
          // Stay in main phase after Mighty second attack
          state.phase = 'main';
          break;
        }

        // ── Normal attack phase ───────────────────────────────────────────
        if (state.phase !== 'attack') throw new Error('Not in Attack Phase.');
        const { targetType, targetBenchIdx } = payload;
        const opp = opponent(playerIdx);
        if (targetType === 'leader') {
          const isUnblockable = !!(state.unblockableAttack?.[playerIdx]);
          const canBlock = !isUnblockable && state.players[opp].bench.some(u => !u.exhausted);
          if (isUnblockable) {
            state.unblockableAttack[playerIdx] = false;
            log('Sae Niijima: attack cannot be intercepted!', 'play');
          }
          if (canBlock) {
            state.pendingIntercept = { attackerP: playerIdx, defenderP: opp };
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

      // ── Async resolution: Yusuke — copy target unit's active ────────────────
      case 'RESOLVE_YUSUKE': {
        if (!state.pendingYusukeTarget) throw new Error('No pending Yusuke target.');
        const { p: yp, targetIdx } = state.pendingYusukeTarget;
        state.pendingYusukeTarget = null;
        const targetUnit = state.players[yp].bench[targetIdx];
        if (!targetUnit) throw new Error('Yusuke: target unit not found.');
        // Fire the copied unit's active — use the same dispatch
        log(`Yusuke: fires ${targetUnit.id}'s active`, 'play');
        // Dispatch the copy as if that unit used its active
        switch (targetUnit.id) {
          case 'tails':    tailsActive(state, yp, targetIdx, payload.discardIdx, log);            break;
          case 'knuckles': knucklesActive(state, yp, targetIdx, payload.targetBenchIdx, log);     break;
          case 'amy':      amyActive(state, yp, targetIdx, log);                                  break;
          case 'cream':    creamActive(state, yp, targetIdx, payload.targetType, payload.targetBenchIdx, log); break;
          case 'big':      bigActive(state, yp, targetIdx, log);                                  break;
          case 'rouge':    rougeActive(state, yp, targetIdx, log);                                break;
          case 'blaze':    blazeActive(state, yp, targetIdx, log);                                break;
          case 'ray':      rayActive(state, yp, targetIdx, log);                                  break;
          case 'charmy':   charmyActive(state, yp, targetIdx, log);                               break;
          case 'espio':    espioActive(state, yp, targetIdx, log);                                break;
          case 'vector':   vectorActive(state, yp, targetIdx, log);                               break;
          case 'tae_takumi':       taeTakumiActive(state, yp, targetIdx, log);                    break;
          case 'sojiro_sakura':    sojiroSakuraActive(state, yp, targetIdx, log);                 break;
          case 'sae_niijima':      saeNiijimaActive(state, yp, targetIdx, log);                   break;
          case 'sadayo_kawakami':  sadayoKawakamiActive(state, yp, targetIdx, log);               break;
          case 'suguru_kamoshida': suguruKamoshidaActive(state, yp, targetIdx, log);              break;
          case 'ryuji_sakamoto':   ryujiSakamotoActive(state, yp, targetIdx, log);               break;
          case 'ann_takamaki':     annTakamakiActive(state, yp, targetIdx, log);                  break;
          case 'morgana':          morganaActive(state, yp, targetIdx, payload.targetBenchIdx, log); break;
          case 'makoto_niijima':   makotoNiijimaActive(state, yp, targetIdx, log);               break;
          case 'futaba_sakura':    futabaSakuraActive(state, yp, targetIdx, log);                 break;
          case 'haru_okumura':     haruOkumuraActive(state, yp, targetIdx, log);                  break;
          case 'sumire_yoshizawa': sumireYoshizawaActive(state, yp, targetIdx, payload.targetBenchIdx, log); break;
          default: log(`Yusuke: cannot copy ${targetUnit.id}`, 'damage');
        }
        break;
      }

      case 'RESOLVE_ARSENE': {
        // playerIdx choosing which leader to halve
        const { targetPlayerIdx } = payload;
        if (!state.pendingArsene) throw new Error('No pending Arsène Unleashed.');
        const targetLeader = state.players[targetPlayerIdx].leader;
        targetLeader.currentHp = Math.max(1, Math.floor(targetLeader.hp / 2));
        log(`Arsène Unleashed: Player ${targetPlayerIdx+1}'s leader set to ${targetLeader.currentHp} HP`, 'damage');
        state.pendingArsene = null;
        break;
      }

      case 'RESOLVE_LEBLANC': {
        const { handIdx } = payload;
        if (!state.pendingLeblanc) throw new Error('No pending LeBlanc.');
        const pi = state.pendingLeblanc.playerIdx;
        if (handIdx !== null && handIdx !== undefined && state.players[pi].hand[handIdx]) {
          const card = state.players[pi].hand.splice(handIdx, 1)[0];
          state.players[pi].discard.push(card);
          drawCards(state, pi, 1, log);
          log(`LeBlanc Coffee: discarded ${card.name}, drew 1`, 'play');
        }
        state.pendingLeblanc = null;
        break;
      }

      case 'RESOLVE_GUARD_PERSONA': {
        // Opponent discards 1 after Guard Persona turn ends
        if (!state.pendingGuardPersona) throw new Error('No pending Guard Persona.');
        const { targetIdx } = state.pendingGuardPersona;
        if (state.players[targetIdx].hand.length > 0) {
          const idx = Math.floor(Math.random() * state.players[targetIdx].hand.length);
          const card = state.players[targetIdx].hand.splice(idx, 1)[0];
          state.players[targetIdx].discard.push(card);
          log(`Guard Persona aftermath: Player ${targetIdx+1} discards ${card.name}`, 'damage');
        }
        state.pendingGuardPersona = null;
        break;
      }

      case 'ADVANCE_TURN': {
        if (state.phase !== 'end') throw new Error('Not in End Phase.');
        state.justineDisabledUid = null; // clear Justine disable on turn advance
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
        logEntries:   sanitizeLogForPlayer(extra.logEntries ?? [], idx, this.state.activePlayer),
        pendingIntercept: this.state.pendingIntercept
          ? (idx === this.state.pendingIntercept.defenderP
              ? this.state.pendingIntercept
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