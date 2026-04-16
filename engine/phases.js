/**
 * PHASES
 * Turn structure: Big Scry → Draw → Energy → Main → Attack → End.
 * No DOM. Communicates with UI via emit(eventName, payload).
 */

import { opponent } from './state.js';
import { drawCards, triggerRougePassive } from './actions.js';
import { checkWin } from './combat.js';

export { drawCards };

// ---------------------------------------------------------------------------
// Turn entry point — called after pass-screen continue
// ---------------------------------------------------------------------------
export function startTurn(state, log, emit) {
  if (checkWin(state) !== null) return;
  const p = state.activePlayer;
  log(`── Turn ${state.turn} · Player ${p + 1} ──`, 'phase');

  // Reset per-turn tracking for the active player
  state.activesUsedThisTurn           = 0;
  state.equipmentPlayedThisTurn[p]    = 0;
  state.energySpentThisTurn[p]        = 0;
  state.leaderDamageTakenThisTurn[p]  = false;
  if (state.rougeUsedThisTurn) state.rougeUsedThisTurn[p] = false;
  if (state.leaderUsedThisTurn) state.leaderUsedThisTurn[p] = false;

  // Recover all exhausted units for the active player (except Omega-locked ones)
  for (const u of state.players[p].bench) {
    if (u.exhausted) {
      u.exhausted = false;
      log(`✅ ${u.name} recovered`, 'phase');
    }
  }

  // Phase 0: Big Scry
  const hasBig = state.players[p].bench.some(u => u.id === 'big' && !u.exhausted);
  if (hasBig && state.players[p].deck.length > 0) {
    state.phase = 'big_scry';
    state.pendingBigScry = { playerIdx: p, card: state.players[p].deck[0] };
    emit('scry_prompt', state.pendingBigScry);
    return;
  }

  runDrawPhase(state, log, emit);
}

function _resolveOmegaUnlocks(state, p, log) {
  const locks = state.persistentExhaust[p];
  const bench = state.players[p].bench;
  for (const uid of Object.keys(locks)) {
    if (locks[uid] <= state.turn) {
      const unit = bench.find(u => u.uid === uid);
      if (unit) {
        unit.exhausted = false;
        log(`🤖 Omega lock expired — ${unit.name} is no longer exhausted`, 'phase');
      }
      delete locks[uid];
    }
  }
}

// ---------------------------------------------------------------------------
// Big Scry resolution (called by UI)
// ---------------------------------------------------------------------------
export function resolveBigScry(state, shouldDiscard, log, emit) {
  const { playerIdx } = state.pendingBigScry;
  if (shouldDiscard) {
    const card = state.players[playerIdx].deck.shift();
    state.players[playerIdx].discard.push(card);
    log(`🐟 Big discards ${card.name} from top of deck`, 'phase');
    triggerRougePassive(state, playerIdx, log);
  } else {
    log(`🐟 Big keeps top card`, 'phase');
  }
  state.pendingBigScry = null;
  runDrawPhase(state, log, emit);
}

// ---------------------------------------------------------------------------
// Phase 1: Draw
// ---------------------------------------------------------------------------
function runDrawPhase(state, log, emit) {
  state.phase = 'draw';
  log(`[Draw Phase]`, 'phase');
  const p = state.activePlayer;

  if (state.firstTurn) {
    log(`Player ${p + 1} skips draw (first turn rule)`, 'phase');
    state.firstTurn = false;
  } else {
    let count = 1;
    if (state.activeStage?.id === 'green_hill_zone') count++;
    drawCards(state, p, count, log);
  }

  // Espio passive: after Draw Phase, draw 1 per equipment in discard (max 2)
  const espio = state.players[p].bench.find(u => u.id === 'espio' && !u.exhausted);
  if (espio) {
    const equipInDiscard = state.players[p].discard.filter(
      c => c.type === 'Equipment' || c.type === 'Genesis' || c.type === 'Stage'
    ).length;
    const extra = Math.min(2, equipInDiscard);
    if (extra > 0) {
      log(`🦎 Espio: draws ${extra} extra card(s) (${equipInDiscard} equipment in discard)`, 'draw');
      drawCards(state, p, extra, log);
    }
  }

  runEnergyPhase(state, log, emit);
}

// ---------------------------------------------------------------------------
// Phase 2: Energy
// ---------------------------------------------------------------------------
function runEnergyPhase(state, log, emit) {
  state.phase = 'energy';
  log(`[Energy Phase]`, 'phase');
  const p = state.activePlayer;
  state.energyMax[p] += 1;
  state.energy[p] = state.energyMax[p];

  // Radical Highway: +1 energy for active player
  if (state.activeStage?.id === 'radical_highway') {
    state.energy[p] += 1;
    log(`🛣 Radical Highway: +1 Energy (now ${state.energy[p]})`, 'phase');
  }

  log(`Player ${p + 1} energy: ${state.energy[p]}/${state.energyMax[p]}`, 'phase');
  runMainPhase(state, log, emit);
}

// ---------------------------------------------------------------------------
// Phase 3: Main
// ---------------------------------------------------------------------------
function runMainPhase(state, log, emit) {
  state.phase = 'main';
  log(`[Main Phase] — Player ${state.activePlayer + 1}`, 'phase');
  emit('phase_changed', state.phase);
}

// ---------------------------------------------------------------------------
// Phase 4: Attack
// ---------------------------------------------------------------------------
export function enterAttackPhase(state, log, emit) {
  if (checkWin(state) !== null) return;
  state.phase = 'attack';
  log(`[Attack Phase] — choose a target`, 'phase');
  emit('phase_changed', state.phase);
}

// ---------------------------------------------------------------------------
// Phase 5: End
// ---------------------------------------------------------------------------
export function enterEndPhase(state, log, emit) {
  if (checkWin(state) !== null) return;
  state.phase = 'end';
  log(`[End Phase]`, 'phase');
  const p = state.activePlayer;

  // Tails passive: draw 1 at end of turn
  const tails = state.players[p].bench.find(u => u.id === 'tails' && !u.exhausted);
  if (tails) {
    log(`🦊 Tails: draws 1 (end of turn)`, 'draw');
    drawCards(state, p, 1, log);
  }

  // Blaze passive: heal 1 if discard has 5+ cards
  const blaze = state.players[p].bench.find(u => u.id === 'blaze' && !u.exhausted);
  if (blaze && state.players[p].discard.length >= 5) {
    const leader = state.players[p].leader;
    const healed = Math.min(1, leader.hp - leader.currentHp);
    if (healed > 0) {
      leader.currentHp += healed;
      log(`🔥 Blaze: heals Leader 1 HP (${leader.currentHp}/${leader.hp})`, 'heal');
    }
  }

  // NOTE: exhausted units recover at the START of the player's NEXT turn, not here.

  // Clear per-turn buffs
  state.chaosEmeraldBuff[p]          = 0;
  state.powerGloveBuff[p]            = 0;
  state.masterEmeraldActive           = false;
  state.activesUsedThisTurn           = 0;
  state.equipmentPlayedThisTurn[p]   = 0;
  state.energySpentThisTurn[p]       = 0;
  state.leaderDamageTakenThisTurn[p] = false;
  state.rougeUsedThisTurn[p]         = false;
  state.leaderUsedThisTurn[p]        = false;

  emit('phase_changed', state.phase);
  emit('request_pass', opponent(p) + 1);
}

// ---------------------------------------------------------------------------
// Advance to next player's turn
// ---------------------------------------------------------------------------
export function advanceTurn(state, log, emit) {
  state.activePlayer = opponent(state.activePlayer);
  if (state.activePlayer === state._firstPlayer) state.turn++;
  state.phase = 'big_scry';
  startTurn(state, log, emit);
}
