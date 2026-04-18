/**
 * PHASES
 * Turn structure: Big Scry → Draw → Energy → Main → Attack → End.
 * No DOM. Communicates with UI via emit(eventName, payload).
 */

import { opponent } from './state.js';
import { drawCards } from './actions.js';
import { checkWin } from './combat.js';

export { drawCards };

export function startTurn(state, log, emit) {
  if (checkWin(state) !== null) return;
  const p = state.activePlayer;
  log(`── Turn ${state.turn} · Player ${p + 1} ──`, 'phase');

  state.activesUsedThisTurn          = 0;
  state.equipmentPlayedThisTurn[p]   = 0;
  state.energySpentThisTurn[p]       = 0;
  state.leaderDamageTakenThisTurn[p] = false;
  if (state.rougeUsedThisTurn)  state.rougeUsedThisTurn[p]  = false;
  if (state.leaderUsedThisTurn) state.leaderUsedThisTurn[p] = false;
  state.usedActivesThisTurn = [];
  if (state.supportDiedLastTurn) state.supportDiedLastTurn[p] = false;

  for (const u of state.players[p].bench) {
    if (u.exhausted) { u.exhausted = false; log(`${u.name} recovered`, 'phase'); }
  }

  const hasBig = state.players[p].bench.some(u => u.id === 'big' && !u.exhausted);
  if (hasBig && state.players[p].deck.length > 0) {
    state.phase = 'big_scry';
    state.pendingBigScry = { playerIdx: p, card: state.players[p].deck[0] };
    emit('scry_prompt', state.pendingBigScry);
    return;
  }
  runDrawPhase(state, log, emit);
}

export function resolveBigScry(state, shouldDiscard, log, emit) {
  const { playerIdx } = state.pendingBigScry;
  if (shouldDiscard) {
    const card = state.players[playerIdx].deck.shift();
    state.players[playerIdx].discard.push(card);
    log(`Big: discarded ${card.name}`, 'play');
  } else {
    log(`Big: kept top card`, 'phase');
  }
  state.pendingBigScry = null;
  runDrawPhase(state, log, emit);
}

function runDrawPhase(state, log, emit) {
  state.phase = 'draw';
  const p = state.activePlayer;

  const espio = state.players[p].bench.find(u => u.id === 'espio' && !u.exhausted);
  const espioBonus = espio
    ? Math.min(2, state.players[p].discard.filter(c => c.type === 'Equipment' || c.type === 'Genesis').length)
    : 0;
  const stageBonus = (state.activeStage?.id === 'green_hill_zone' || state.activeStage?.id === 'shibuya_crossing') ? 1 : 0;
  const totalDraw = 1 + stageBonus + espioBonus;

  if (state.players[p].deck.length === 0) {
    state.missedDraws[p]++;
    const penalty = state.missedDraws[p];
    log(`Player ${p + 1} has no cards! Takes ${penalty} damage.`, 'damage');
    state.players[p].leader.currentHp -= penalty;
    if (checkWin(state) !== null) { emit('phase_changed', state.phase); return; }
  } else {
    drawCards(state, p, totalDraw, log);
    state.missedDraws[p] = 0;
  }
  if (espioBonus > 0) log(`Espio: +${espioBonus} draw`, 'draw');

  runEnergyPhase(state, log, emit);
}

function runEnergyPhase(state, log, emit) {
  state.phase = 'energy';
  const p = state.activePlayer;
  state.energyMax[p] = (state.energyMax[p] ?? 0) + 1;

  if (state.activeStage?.id === 'radical_highway') {
    state.energy[0] = state.energyMax[0] + 1;
    state.energy[1] = state.energyMax[1] + 1;
    log(`Radical Highway: each player +1 energy`, 'phase');
  } else {
    state.energy[p] = state.energyMax[p];
  }

  if (state.activeStage?.id === 'palace_infiltration_route') {
    for (let pi = 0; pi <= 1; pi++) {
      state.players[pi].leader.currentHp = Math.max(0, state.players[pi].leader.currentHp - 10);
      log(`Palace Infiltration Route: 10 damage to Player ${pi + 1}`, 'damage');
    }
    if (checkWin(state) !== null) { emit('phase_changed', state.phase); return; }
  }

  log(`Player ${p + 1} energy: ${state.energy[p]}/${state.energyMax[p]}`, 'phase');
  runMainPhase(state, log, emit);
}

function runMainPhase(state, log, emit) {
  state.phase = 'main';
  log(`[Main Phase] — Player ${state.activePlayer + 1}`, 'phase');
  emit('phase_changed', state.phase);
}

export function enterAttackPhase(state, log, emit) {
  if (checkWin(state) !== null) return;
  state.phase = 'attack';
  log(`[Attack Phase] — choose a target`, 'phase');
  emit('phase_changed', state.phase);
}

export function enterEndPhase(state, log, emit) {
  if (checkWin(state) !== null) return;
  state.phase = 'end';
  const p = state.activePlayer;

  const tails = state.players[p].bench.find(u => u.id === 'tails' && !u.exhausted);
  if (tails) { log(`Tails: draws 1`, 'draw'); drawCards(state, p, 1, log); }

  const blaze = state.players[p].bench.find(u => u.id === 'blaze' && !u.exhausted);
  if (blaze && state.players[p].discard.length >= 5) {
    const leader = state.players[p].leader;
    if (leader.currentHp < leader.hp) {
      leader.currentHp = Math.min(leader.currentHp + 10, leader.hp);
      log(`Blaze: heals Leader 10 HP (${leader.currentHp}/${leader.hp})`, 'heal');
    }
  }

  const futaba = state.players[p].bench.find(u => u.id === 'futaba_sakura' && !u.exhausted);
  if (futaba && state.players[p].deck.length > 0) {
    state.pendingBigScry = { playerIdx: p, card: state.players[p].deck[0], isFutaba: true };
  }

  state.chaosEmeraldBuff[p]          = 0;
  state.powerGloveBuff[p]            = 0;
  state.masterEmeraldActive           = false;
  state.activesUsedThisTurn           = 0;
  state.equipmentPlayedThisTurn[p]   = 0;
  state.energySpentThisTurn[p]       = 0;
  state.leaderDamageTakenThisTurn[p] = false;
  state.rougeUsedThisTurn[p]         = false;
  state.leaderUsedThisTurn[p]        = false;
  state.usedActivesThisTurn           = [];
  if (state.shieldReduction)  state.shieldReduction[p]  = 0;
  delete state._genesisPlayedBy;

  emit('phase_changed', state.phase);
  emit('request_pass', opponent(p) + 1);
}

export function advanceTurn(state, log, emit) {
  state.activePlayer = opponent(state.activePlayer);
  if (state.activePlayer === state._firstPlayer) state.turn++;
  state.phase = 'big_scry';
  startTurn(state, log, emit);
}