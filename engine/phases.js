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
  // Haru shield expires at the start of the PROTECTED player's own turn
  if (state.haruShield) state.haruShield[p] = false;
  // Haru extended exhaust: clear haruShield flag on unit so she can be used again
  state.players[p].bench.forEach(u => { if (u.haruShield) { u.haruShield = false; } });
  // shieldReduction (Elemental Shield / Guard Persona) expires at start of protected player's turn
  if (state.shieldReduction) state.shieldReduction[p] = 0;

  // Activate Kamoshida passive flag for this turn (always, before any early return)
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
    // drawCards handles the missed-draw penalty (scaled x10), call it for 1 draw
    drawCards(state, p, 1, log, true);
    if (checkWin(state) !== null) { emit('phase_changed', state.phase); return; }
    // Draw extra cards (stage/espio bonuses) from empty deck each trigger penalty too
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

  // Active player always gets their energyMax restored
  state.energy[p] = state.energyMax[p];
  if (state.activeStage?.id === 'radical_highway') {
    // Both players gain +10 energy on the active player's turn
    state.energy[0] += 10;
    state.energy[1] += 10;
    log(`Radical Highway: each player +10 energy`, 'phase');
  }

  if (state.activeStage?.id === 'palace_infiltration_route') {
    // Both leaders take 10 damage at start of energy phase
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

  const tails = state.players[p].bench.find(u => u.id === 'tails' && !u.exhausted);
  if (tails) { log(`Tails: draws 1`, 'draw'); drawCards(state, p, 1, log); }

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
  // shieldReduction NOT cleared here — persists into opponent's turn (Guard Persona)
  // P5 per-turn resets
  if (state.healedThisTurn)          state.healedThisTurn[p]          = 0;
  if (state.dmgToEnemyUnitsThisTurn) state.dmgToEnemyUnitsThisTurn[p] = 0;
  if (state.opponentDiscardsThisTurn)state.opponentDiscardsThisTurn[p]= 0;
  if (state.unblockableAttack)       state.unblockableAttack[p]       = false;
  if (state.tauntUnit)               state.tauntUnit[p]               = null;
  // haruShield intentionally NOT cleared here — persists until start of player's NEXT turn
  if (state.kamoshidaPassive)        state.kamoshidaPassive[p]        = false;
  // Haru exhausted state cleared in startTurn when shield expires
  // Caroline/Justine: track whether each died alone this turn for revival condition
  _updateCarolineJustineLock(state, p);
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

// Track Caroline/Justine revival conditions (died alone = other twin wasn't also KO'd this turn)
function _updateCarolineJustineLock(state, p) {
  if (!state.carolineLock) state.carolineLock = [false, false];
  if (!state.justineLock)  state.justineLock  = [false, false];

  const bench   = state.players[p].bench.map(u => u.id);
  const discard = state.players[p].discard.map(u => u.id);

  const carolineInDiscard = discard.includes('caroline');
  const justineInDiscard  = discard.includes('justine');
  const carolineOnBench   = bench.includes('caroline');
  const justineOnBench    = bench.includes('justine');

  // Caroline active unlocked if Justine is in discard but Caroline is still on bench
  state.carolineLock[p] = justineInDiscard && carolineOnBench;
  // Justine active unlocked if Caroline is in discard but Justine is still on bench
  state.justineLock[p]  = carolineInDiscard && justineOnBench;
}