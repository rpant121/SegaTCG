/**
 * PHASES
 * Turn structure: Big Scry → Draw → Energy → Main → Attack → End.
 * No DOM. Communicates with UI via emit(eventName, payload).
 *
 * Fixes applied:
 *  #7  — Caroline/Justine "died alone" condition now uses _twinKOThisTurn flag
 *  #10 — Futaba end-of-turn scry now emits scry_prompt so local mode shows the modal
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
  // #7 — reset twin-KO-same-turn flag at start of each turn
  if (!state._twinKOThisTurn) state._twinKOThisTurn = [false, false];
  state._twinKOThisTurn[p] = false;

  for (const u of state.players[p].bench) {
    if (u.exhausted) { u.exhausted = false; log(`${u.name} recovered`, 'phase'); }
  }
  // Haru shield expires at the start of the PROTECTED player's own turn
  if (state.haruShield) state.haruShield[p] = false;
  state.players[p].bench.forEach(u => { if (u.haruShield) { u.haruShield = false; } });
  // shieldReduction (Elemental Shield / Guard Persona) expires at start of protected player's turn
  if (state.shieldReduction) state.shieldReduction[p] = 0;

  // Activate Kamoshida passive flag for this turn
  if (!state.kamoshidaPassive) state.kamoshidaPassive = [false, false];
  state.kamoshidaPassive[p] = !!state.players[p].bench.find(u => u.id === 'suguru_kamoshida' && !u.exhausted);

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
    drawCards(state, p, 1, log, true);
    if (checkWin(state) !== null) { emit('phase_changed', state.phase); return; }
    for (let i = 1; i < totalDraw; i++) drawCards(state, p, 1, log, true);
  } else {
    drawCards(state, p, totalDraw, log, true);
    state.missedDraws[p] = 0;
  }
  if (espioBonus > 0) log(`Espio: +${espioBonus} draw`, 'draw');

  runEnergyPhase(state, log, emit);
}

function runEnergyPhase(state, log, emit) {
  state.phase = 'energy';
  const p = state.activePlayer;
  state.energyMax[p] = (state.energyMax[p] ?? 0) + 1;
  state.energy[p] = state.energyMax[p];

  if (state.activeStage?.id === 'radical_highway') {
    state.energy[0] += 1;
    state.energy[1] += 1;
    log(`Radical Highway: each player +1 energy`, 'phase');
  }

  if (state.activeStage?.id === 'palace_infiltration_route') {
    state.energy[p] += 1;
    log(`Palace Infiltration Route: +1 energy to Player ${p + 1}`, 'phase');
    for (let pi = 0; pi <= 1; pi++) {
      const ldr = state.players[pi].leader;
      ldr.currentHp = Math.max(0, ldr.currentHp - 10);
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

  // Tails draw
  const tails = state.players[p].bench.find(u => u.id === 'tails' && !u.exhausted);
  if (tails) { log(`Tails: draws 1`, 'draw'); drawCards(state, p, 1, log); }

  // Blaze sustain heal
  const blaze = state.players[p].bench.find(u => u.id === 'blaze' && !u.exhausted);
  if (blaze && state.players[p].discard.length >= 5) {
    const leader = state.players[p].leader;
    if (leader.currentHp < leader.hp) {
      const blazeHeal = Math.min(10, leader.hp - leader.currentHp);
      leader.currentHp += blazeHeal;
      if (!state.healedThisTurn) state.healedThisTurn = [0, 0];
      state.healedThisTurn[p] = (state.healedThisTurn[p] ?? 0) + blazeHeal;
      log(`Blaze: heals Leader ${blazeHeal} HP (${leader.currentHp}/${leader.hp})`, 'heal');
    }
  }

  // #10 — Futaba end-of-turn scry: set pending state AND emit so local mode shows the modal
  const futaba = state.players[p].bench.find(u => u.id === 'futaba_sakura' && !u.exhausted);
  if (futaba && state.players[p].deck.length > 0) {
    state.pendingBigScry = { playerIdx: p, card: state.players[p].deck[0], isFutaba: true };
    // Emit before cleanup so the UI can intercept and show the scry modal before pass
    emit('scry_prompt', state.pendingBigScry);
    // End phase cleanup will happen after scry resolves (resolveBigScry → advanceTurn path)
    return;
  }

  _finishEndPhase(state, log, emit, p);
}

// Called directly, and also after Futaba scry resolves
export function finishEndPhaseAfterScry(state, log, emit) {
  _finishEndPhase(state, log, emit, state.activePlayer);
}

function _finishEndPhase(state, log, emit, p) {
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
  if (state.healedThisTurn)          state.healedThisTurn[p]          = 0;
  if (state.dmgToEnemyUnitsThisTurn) state.dmgToEnemyUnitsThisTurn[p] = 0;
  if (state.opponentDiscardsThisTurn)state.opponentDiscardsThisTurn[p]= 0;
  if (state.unblockableAttack)       state.unblockableAttack[p]       = false;
  if (state.tauntUnit)               state.tauntUnit[p]               = null;
  if (state.kamoshidaPassive)        state.kamoshidaPassive[p]        = false;
  // #7 — reset twin-KO flag
  if (state._twinKOThisTurn)         state._twinKOThisTurn[p]        = false;

  delete state._genesisPlayedBy;

  // #7 — update Caroline/Justine revival locks using the twin-KO-same-turn flag
  _updateCarolineJustineLock(state, p);

  emit('phase_changed', state.phase);
  emit('request_pass', opponent(p) + 1);
}

export function advanceTurn(state, log, emit) {
  state.activePlayer = opponent(state.activePlayer);
  if (state.activePlayer === state._firstPlayer) state.turn++;
  state.phase = 'big_scry';
  startTurn(state, log, emit);
}

// #7 — Track Caroline/Justine revival: only unlock if the OTHER twin died ALONE
// (i.e. was not also KO'd in the same action/turn as the surviving twin)
function _updateCarolineJustineLock(state, p) {
  if (!state.carolineLock) state.carolineLock = [false, false];
  if (!state.justineLock)  state.justineLock  = [false, false];

  const bench   = state.players[p].bench.map(u => u.id);
  const discard = state.players[p].discard.map(u => u.id);

  const carolineInDiscard = discard.includes('caroline');
  const justineInDiscard  = discard.includes('justine');
  const carolineOnBench   = bench.includes('caroline');
  const justineOnBench    = bench.includes('justine');

  // Both died this turn — neither twin "died alone", so no revival lock
  const bothDiedThisTurn = state._twinKOThisTurn?.[p] === true
    && carolineInDiscard && justineInDiscard;

  // Caroline active: Justine died alone (Justine in discard, Caroline still on bench,
  // and NOT both KO'd in the same turn)
  state.carolineLock[p] = justineInDiscard && carolineOnBench && !bothDiedThisTurn;

  // Justine active: Caroline died alone
  state.justineLock[p]  = carolineInDiscard && justineOnBench && !bothDiedThisTurn;
}