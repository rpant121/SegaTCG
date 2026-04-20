/**
 * GAME ROOM — gameRoom.js
 * Manages one live game between two players.
 * Owns the canonical gameState; validates and dispatches all actions.
 * Broadcasts sanitized state to each player after every mutation.
 *
 * Changes applied:
 *  #6  — taunt enforced server-side in ATTACK case
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
// Sanitize
// ---------------------------------------------------------------------------
function sanitizeLogForPlayer(logEntries, viewerIdx, activePlayer) {
  return logEntries.map(entry => {
    if (!entry.msg) return entry;
    const drawMatch = entry.msg.match(/^(.+Player )(\d+)( draws )(.+)$/u);
    if (drawMatch) {
      const pIdx = parseInt(drawMatch[2], 10) - 1;
      if (pIdx !== viewerIdx) {
        return { ...entry, msg: drawMatch[1] + drawMatch[2] + drawMatch[3] + 'a card' };
      }
    }
    const passiveDrawMatch = entry.msg.match(/^(.+: draws )([^(]+)(.*)$/u);
    if (passiveDrawMatch && typeof activePlayer === 'number' && activePlayer !== viewerIdx) {
      return { ...entry, msg: passiveDrawMatch[1] + 'a card' + (passiveDrawMatch[3] ? ' ' + passiveDrawMatch[3].trim() : '') };
    }
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
          bench: isSetup ? p.bench.map(() => ({ hidden: true, type: 'Unit' })) : p.bench,
        };
      }
      return p;
    }),
  };
}

// ---------------------------------------------------------------------------
// Log collector
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
  constructor(roomCode, io) {
    this.roomCode   = roomCode;
    this.io         = io;
    this.sockets    = [null, null];
    this.decks      = [null, null];
    this.leaderIds  = ['sonic', 'sonic'];
    this.deckNames  = ['Custom Deck', 'Custom Deck'];
    this.state      = null;
    this.log        = makeLog();
    this._gameOver  = false;
  }

  join(socket, deck, deckName, leaderId = 'sonic') {
    const slot = this.sockets.indexOf(null);
    if (slot === -1) throw new Error('Room is full');
    this.sockets[slot]   = socket.id;
    this.decks[slot]     = deck;
    this.deckNames[slot] = deckName;
    this.leaderIds[slot] = leaderId;
    socket.join(this.roomCode);
    if (this.isFull()) this._startGame();
    return slot;
  }

  isFull()      { return this.sockets.every(Boolean); }
  isEmpty()     { return this.sockets.every(s => !s); }
  hasSocket(id) { return this.sockets.includes(id); }

  _startGame() {
    this.state = createInitialState(this.decks[0], this.decks[1], this.leaderIds[0], this.leaderIds[1]);
    this.state.phase = 'setup';
    this.state._setupReady = [false, false];
    delete this.state._setupPlayer;
    this.sockets.forEach((socketId, idx) => {
      this.io.to(socketId).emit('game_start', {
        playerIdx:    idx,
        roomCode:     this.roomCode,
        deckNames:    this.deckNames,
        firstPlayer:  this.state.activePlayer,
        initialState: this._sanitizeForPlayer(this.state, idx),
        logEntries:   [{ msg: '=== GAME START ===', type: 'phase' }],
      });
    });
  }

  handleAction(socket, type, payload) {
    if (this._gameOver || !this.state) return;
    const playerIdx = this.sockets.indexOf(socket.id);
    if (playerIdx === -1) return;
    const state = this.state;
    const log   = this.log;
    try {
      const asyncActions = new Set([
        'RESOLVE_POLARIS_PACT', 'REQUEST_STATE', 'SETUP_DONE',
        'RESOLVE_INTERCEPT', 'RESOLVE_ARSENE', 'RESOLVE_LEBLANC', 'RESOLVE_GUARD_PERSONA',
      ]);
      if (state.phase === 'setup' && type === 'PLAY_CARD') {
        const card = state.players[playerIdx].hand[payload.handIdx];
        if (!card) throw new Error('No card at that hand index.');
        if (card.type !== 'Unit') throw new Error('Only units can be deployed during setup.');
        if (state.players[playerIdx].bench.length >= 3) throw new Error('Bench is full.');
        state.players[playerIdx].hand.splice(payload.handIdx, 1);
        state.players[playerIdx].bench.push({ ...card, currentHp: card.hp, exhausted: false });
        log(`__setup_deploy__:${playerIdx}:${card.name}`, 'play');
        this._broadcast({ logEntries: log.flush() });
        return;
      }
      if (!asyncActions.has(type) && playerIdx !== state.activePlayer) {
        if (type !== 'RESOLVE_INTERCEPT' || !state.pendingIntercept) {
          socket.emit('action_error', { message: "It's not your turn." });
          return;
        }
        const defenderIdx = state.pendingIntercept.defenderP;
        if (playerIdx !== defenderIdx) {
          socket.emit('action_error', { message: "You are not the defending player." });
          return;
        }
      }
      this._dispatch(type, payload, playerIdx, log);
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
    const emit  = () => {};

    switch (type) {

      case 'SETUP_DONE': {
        if (!state._setupReady) state._setupReady = [false, false];
        state._setupReady[playerIdx] = true;
        log(`Player ${playerIdx + 1} ready`, 'phase');
        if (state._setupReady[0] && state._setupReady[1]) {
          delete state._setupReady;
          state.phase = 'big_scry';
          startTurn(state, log, emit);
        }
        break;
      }

      case 'PLAY_CARD': {
        const { handIdx } = payload;
        playCardFromHand(state, handIdx, log);
        break;
      }

      case 'USE_LEADER_ACTIVE': {
        const { handIdx } = payload;
        const leaderId = state.players[playerIdx].leader.id;
        if (leaderId === 'kiryu') {
          const leader = state.players[playerIdx].leader;
          if (!canAfford(state, leader.activeCost)) throw new Error('Not enough energy for Kiryu active.');
          spendEnergy(state, leader.activeCost);
          state.powerGloveBuff[playerIdx] = (state.powerGloveBuff[playerIdx] ?? 0) + 10;
          log('Kazuma Kiryu: +10 attack this turn!', 'play');
        } else if (leaderId === 'joker') {
          const { benchIdx } = payload;
          if (benchIdx === undefined || benchIdx === null) throw new Error('Joker: no bench unit selected.');
          const unit = state.players[playerIdx].bench[benchIdx];
          if (!unit) throw new Error('Joker: no unit at that bench slot.');
          if (state.leaderUsedThisTurn[playerIdx]) throw new Error('Joker active already used this turn.');
          const unitBaseCost = unit.activeCost ?? 0;
          const jokerCost = unitBaseCost >= 4 ? 2 : 1;
          if (!canAfford(state, jokerCost)) throw new Error(`Not enough energy. Joker needs ${jokerCost} energy.`);
          spendEnergy(state, jokerCost);
          state.leaderUsedThisTurn[playerIdx] = true;
          log(`Joker: copies ${unit.name}'s active (paid ${jokerCost}⚡)`, 'play');
          this._dispatchUnitActive(state, playerIdx, benchIdx, payload, log);
        } else {
          sonicActive(state, handIdx, log);
        }
        break;
      }

      case 'USE_UNIT_ACTIVE': {
        const { benchIdx, targetType, targetBenchIdx, discardIdx } = payload;
        const unit = state.players[playerIdx].bench[benchIdx];
        if (!unit) throw new Error('No unit at that bench slot.');
        if (state.justineDisabledUid === unit.uid) throw new Error(`${unit.name}'s active is disabled by Justine+Caroline.`);
        this._dispatchUnitActive(state, playerIdx, benchIdx, payload, log);
        // Justine+Caroline passive: disable the unit just used
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

      case 'RESOLVE_BIG_SCRY': {
        const { shouldDiscard } = payload;
        resolveBigScry(state, shouldDiscard, log, emit);
        break;
      }

      case 'RESOLVE_INTERCEPT': {
        const { interceptBenchIdx: blockBenchIdx } = payload;
        const { attackerP, defenderP, isMighty } = state.pendingIntercept;
        state.pendingIntercept = null;
        if (blockBenchIdx === null || blockBenchIdx === undefined) {
          attackLeader(state, attackerP, defenderP, log);
        } else {
          resolveIntercept(state, attackerP, defenderP, blockBenchIdx, log);
        }
        if (checkWin(state) !== null) break;
        if (isMighty) { state.phase = 'main'; } else { enterEndPhase(state, log, emit); }
        break;
      }

      case 'RESOLVE_EXTREME_GEAR': {
        const { handIndices } = payload;
        if (!state.pendingExtremeGear) throw new Error('No pending Extreme Gear.');
        resolveExtremeGear(state, handIndices ?? [], log);
        break;
      }

      case 'RESOLVE_DRAGONS_EYE': {
        const { deckIdx } = payload;
        if (!state.pendingDragonsEye) throw new Error("No pending Dragon's Eye.");
        const { playerIdx: pi, cards } = state.pendingDragonsEye;
        const card = cards[deckIdx];
        if (!card) throw new Error("Invalid deck index for Dragon's Eye.");
        state.players[pi].deck = state.players[pi].deck.filter(c => c.uid !== card.uid);
        state.players[pi].hand.push(card);
        log(`Dragon's Eye: ${card.name} taken into hand`, 'draw');
        state.pendingDragonsEye = null;
        break;
      }

      case 'RESOLVE_RAY': {
        const { deckIdx } = payload;
        if (!state.pendingRayActive) throw new Error('No pending Ray active.');
        const { playerIdx: pi, cards } = state.pendingRayActive;
        const card = cards[deckIdx];
        if (!card) throw new Error('Invalid index for Ray active.');
        state.players[pi].deck = state.players[pi].deck.filter(c => c.uid !== card.uid);
        state.players[pi].discard.push(card);
        log(`Ray: ${card.name} sent to discard`, 'play');
        const rouge = state.players[pi].bench.find(u => u.id === 'rouge' && !u.exhausted);
        if (rouge && state.players[pi].deck.length > 0) {
          const drawn = state.players[pi].deck.shift();
          state.players[pi].hand.push(drawn);
          state.missedDraws[pi] = 0;
          log(`Rouge: draws ${drawn.name} (Ray discard event)`, 'draw');
        }
        state.pendingRayActive = null;
        break;
      }

      case 'RESOLVE_POLARIS_PACT': {
        const { targetHandIdx } = payload;
        if (!state.pendingPolarisPact) throw new Error('No pending Polaris Pact.');
        const { opponentIdx } = state.pendingPolarisPact;
        if (playerIdx !== opponentIdx) throw new Error('You are not the target of Polaris Pact.');
        const hand = state.players[opponentIdx].hand;
        if (targetHandIdx < 0 || targetHandIdx >= hand.length) throw new Error('Invalid hand index.');
        const disc = hand.splice(targetHandIdx, 1)[0];
        state.players[opponentIdx].discard.push(disc);
        log(`Polaris Pact: P${opponentIdx + 1} discards ${disc.name}`, 'damage');
        state.pendingPolarisPact = null;
        break;
      }

      case 'ENTER_ATTACK_PHASE': {
        if (state.phase !== 'main') throw new Error('Not in Main Phase.');
        enterAttackPhase(state, log, emit);
        break;
      }

      case 'ATTACK': {
        if (state.phase !== 'attack' && !state.pendingMightyAttack) throw new Error('Not in Attack Phase.');

        const { targetType, targetBenchIdx } = payload;
        const opp = opponent(playerIdx);

        // #6 — enforce taunt server-side
        const tauntUid = state.tauntUnit?.[opp];
        if (tauntUid) {
          const tauntUnit = state.players[opp].bench.find(u => u.uid === tauntUid);
          if (tauntUnit) {
            // Taunting unit still alive — validate the target
            if (targetType === 'leader')
              throw new Error('Taunt is active — you must attack the taunting unit.');
            const targetUnit = state.players[opp].bench[targetBenchIdx];
            if (!targetUnit || targetUnit.uid !== tauntUid)
              throw new Error('Taunt is active — you must attack the taunting unit.');
          } else {
            // Taunting unit was already KO'd — clear the stale flag
            state.tauntUnit[opp] = null;
          }
        }

        if (state.pendingMightyAttack) {
          state.pendingMightyAttack = false;
          if (targetType === 'leader') {
            const canBlock = state.players[opp].bench.some(u => !u.exhausted);
            if (canBlock) {
              state.pendingIntercept = { attackerP: playerIdx, defenderP: opp, isMighty: true };
            } else {
              attackLeader(state, playerIdx, opp, log);
              if (checkWin(state) !== null) break;
            }
          } else if (targetType === 'unit') {
            applyDamageToUnit(state, playerIdx, opp, targetBenchIdx, log);
            if (checkWin(state) !== null) break;
          } else {
            throw new Error(`Unknown attack target type: ${targetType}`);
          }
          state.phase = 'main';
          break;
        }

        if (state.phase !== 'attack') throw new Error('Not in Attack Phase.');
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
        if (state.phase === 'attack') {
          enterEndPhase(state, log, emit);
        } else {
          throw new Error('Cannot skip to end phase from ' + state.phase);
        }
        break;
      }

      case 'SKIP_ATTACK': {
        if (state.phase !== 'attack') throw new Error('Not in attack phase.');
        enterEndPhase(state, log, emit);
        break;
      }

      case 'RESOLVE_YUSUKE': {
        if (!state.pendingYusukeTarget) throw new Error('No pending Yusuke target.');
        const { p: yp, targetIdx } = state.pendingYusukeTarget;
        state.pendingYusukeTarget = null;
        const targetUnit = state.players[yp].bench[targetIdx];
        if (!targetUnit) throw new Error('Yusuke: target unit not found.');
        log(`Yusuke: fires ${targetUnit.id}'s active`, 'play');
        this._dispatchUnitActive(state, yp, targetIdx, payload, log);
        break;
      }

      case 'RESOLVE_ARSENE': {
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
        state.justineDisabledUid = null;
        advanceTurn(state, log, emit);
        break;
      }

      case 'REQUEST_STATE':
        break;

      default:
        throw new Error(`Unknown action type: "${type}"`);
    }
  }

  // Shared unit-active dispatcher used by USE_UNIT_ACTIVE, Joker, and Yusuke
  _dispatchUnitActive(state, playerIdx, benchIdx, payload, log) {
    const { targetType, targetBenchIdx, discardIdx } = payload;
    const unit = state.players[playerIdx].bench[benchIdx];
    if (!unit) throw new Error('No unit at that bench slot.');
    switch (unit.id) {
      case 'tails':            tailsActive(state, playerIdx, benchIdx, discardIdx, log);                          break;
      case 'knuckles':         knucklesActive(state, playerIdx, benchIdx, targetBenchIdx, log);                   break;
      case 'amy':              amyActive(state, playerIdx, benchIdx, log);                                        break;
      case 'cream':            creamActive(state, playerIdx, benchIdx, targetType, targetBenchIdx, log);          break;
      case 'big':              bigActive(state, playerIdx, benchIdx, log);                                        break;
      case 'silver':           silverActive(state, playerIdx, benchIdx, targetBenchIdx, log);                     break;
      case 'shadow':           shadowActive(state, playerIdx, benchIdx, log);                                     break;
      case 'mighty':
        mightyActive(state, playerIdx, benchIdx, log);
        break;
      case 'rouge':            rougeActive(state, playerIdx, benchIdx, log);                                      break;
      case 'blaze':            blazeActive(state, playerIdx, benchIdx, log);                                      break;
      case 'ray':              rayActive(state, playerIdx, benchIdx, log);                                        break;
      case 'charmy':           charmyActive(state, playerIdx, benchIdx, log);                                     break;
      case 'espio':            espioActive(state, playerIdx, benchIdx, log);                                      break;
      case 'vector':           vectorActive(state, playerIdx, benchIdx, log);                                     break;
      case 'caroline':         carolineActive(state, playerIdx, benchIdx, log);                                   break;
      case 'justine':          justineActive(state, playerIdx, benchIdx, log);                                    break;
      case 'tae_takumi':       taeTakumiActive(state, playerIdx, benchIdx, log);                                  break;
      case 'sojiro_sakura':    sojiroSakuraActive(state, playerIdx, benchIdx, log);                               break;
      case 'sae_niijima':      saeNiijimaActive(state, playerIdx, benchIdx, log);                                 break;
      case 'sadayo_kawakami':  sadayoKawakamiActive(state, playerIdx, benchIdx, log);                             break;
      case 'suguru_kamoshida': suguruKamoshidaActive(state, playerIdx, benchIdx, log);                            break;
      case 'ryuji_sakamoto':   ryujiSakamotoActive(state, playerIdx, benchIdx, log);                              break;
      case 'ann_takamaki':     annTakamakiActive(state, playerIdx, benchIdx, log);                                break;
      case 'morgana':          morganaActive(state, playerIdx, benchIdx, targetBenchIdx, log);                    break;
      case 'yusuke_kitagawa':  yusukeKitagawaActive(state, playerIdx, benchIdx, targetBenchIdx, log);             break;
      case 'makoto_niijima':   makotoNiijimaActive(state, playerIdx, benchIdx, log);                              break;
      case 'futaba_sakura':    futabaSakuraActive(state, playerIdx, benchIdx, log);                               break;
      case 'haru_okumura':     haruOkumuraActive(state, playerIdx, benchIdx, log);                                break;
      case 'sumire_yoshizawa': sumireYoshizawaActive(state, playerIdx, benchIdx, targetBenchIdx, log);            break;
      default: throw new Error(`Unknown unit active: ${unit.id}`);
    }
  }

  handleDisconnect(socketId) {
    const idx = this.sockets.indexOf(socketId);
    if (idx === -1) return;
    console.log(`[Room ${this.roomCode}] P${idx + 1} disconnected`);
    const oppIdx = opponent(idx);
    const oppId  = this.sockets[oppIdx];
    if (oppId) {
      this.io.to(oppId).emit('opponent_disconnected', {
        message: `Player ${idx + 1} disconnected. Waiting 60s for reconnect...`,
      });
    }
    this.sockets[idx] = null;
  }

  _broadcast(extra = {}) {
    this.sockets.forEach((socketId, idx) => {
      if (!socketId) return;
      const payload = {
        state:      sanitizeForPlayer(this.state, idx),
        logEntries: sanitizeLogForPlayer(extra.logEntries ?? [], idx, this.state.activePlayer),
        pendingIntercept: this.state.pendingIntercept
          ? (idx === this.state.pendingIntercept.defenderP ? this.state.pendingIntercept : null)
          : null,
      };
      if (extra.winner !== undefined) payload.winner = extra.winner;
      this.io.to(socketId).emit('state_update', payload);
    });
  }

  _sanitizeForPlayer(state, viewerIdx) {
    return sanitizeForPlayer(state, viewerIdx);
  }
}