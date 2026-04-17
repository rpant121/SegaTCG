/**
 * COMBAT
 * Damage application, attack resolution, blocking.
 * No DOM. Pure state mutations.
 */

import { opponent } from './state.js';
import { drawCards } from './actions.js';

// ---------------------------------------------------------------------------
// Win condition check
// ---------------------------------------------------------------------------
export function checkWin(state) {
  for (const [p, player] of state.players.entries()) {
    if (player.leader.currentHp <= 0) return p; // p is the loser
  }
  return null;
}

// ---------------------------------------------------------------------------
// Effective damage calculation (recalculated fresh before every attack)
// ---------------------------------------------------------------------------
export function calcEffectiveDamage(state, attackerP) {
  const leader = state.players[attackerP].leader;
  let base = leader.damage;

  // Shadow passive: doubles base damage per Shadow on bench
  for (const unit of state.players[attackerP].bench) {
    if (unit.id === 'shadow' && !unit.exhausted && unit.passive?.type === 'shadow_boost') {
      base *= 2;
    }
  }

  const boosts = state.players[attackerP].bench.reduce((sum, unit) => {
    if (!unit.exhausted && unit.passive?.type === 'attack_boost') sum += unit.passive.amount;
    return sum;
  }, 0);

  return base
    + boosts
    + (state.chaosEmeraldBuff?.[attackerP] ?? 0)
    + (state.powerGloveBuff?.[attackerP] ?? 0);
}

// ---------------------------------------------------------------------------
// Apply damage to a Leader.
// unblockable = true bypasses Elemental Shield reduction.
// ---------------------------------------------------------------------------
export function applyDamageToLeader(state, targetP, rawDamage, log, unblockable = false) {
  let reduction = 0;
  if (!unblockable) {
    // Cream-style passive reduction
    for (const unit of state.players[targetP].bench) {
      if (!unit.exhausted && unit.passive?.type === 'damage_reduction') {
        reduction += unit.passive.amount;
      }
    }
    // Elemental Shield: flat reduction to next damage event
    if (state.shieldReduction?.[targetP] > 0) {
      const absorbed = Math.min(state.shieldReduction[targetP], rawDamage);
      reduction += absorbed;
      state.shieldReduction[targetP] = Math.max(0, state.shieldReduction[targetP] - rawDamage);
      log(`Shield reduced ${absorbed} damage for Player ${targetP + 1}!`, 'heal');
    }
  }

  const finalDmg = Math.max(0, rawDamage - reduction);
  if (finalDmg <= 0) return;

  state.players[targetP].leader.currentHp -= finalDmg;
  log(`${finalDmg} damage to Player ${targetP + 1}'s Leader!`, 'damage');

  // Vector passive: draw 1 per damage event on own Leader
  const vector = state.players[targetP].bench.find(u => u.id === 'vector' && !u.exhausted);
  if (vector) {
    _vectorDraw(state, targetP, log);
  }
}

function _vectorDraw(state, p, log) {
  if (state.players[p].deck.length > 0) {
    const card = state.players[p].deck.shift();
    state.players[p].hand.push(card);
    state.missedDraws[p] = 0;
    log(`Vector: draws ${card.name} (Leader took damage)`, 'draw');
  }
}

// ---------------------------------------------------------------------------
// Leader attacks opponent Leader directly.
// ---------------------------------------------------------------------------
export function attackLeader(state, attackerP, defenderP, log) {
  const dmg = calcEffectiveDamage(state, attackerP);
  log(`Player ${attackerP + 1} attacks Player ${defenderP + 1}'s Leader for ${dmg}!`, 'damage');
  applyDamageToLeader(state, defenderP, dmg, log);
  _triggerMightyPassive(state, attackerP, dmg, log);
}

// ---------------------------------------------------------------------------
// Leader attacks a bench unit.
// ---------------------------------------------------------------------------
export function applyDamageToUnit(state, attackerP, targetP, unitIdx, log) {
  const unit = state.players[targetP].bench[unitIdx];
  if (!unit) return;

  const dmg = calcEffectiveDamage(state, attackerP);
  unit.currentHp -= dmg;
  log(`${unit.name} took ${dmg} damage (${unit.currentHp}/${unit.hp} HP)`, 'damage');
  _triggerMightyPassive(state, attackerP, dmg, log);

  if (unit.currentHp <= 0) {
    state.players[targetP].bench.splice(unitIdx, 1);
    state.players[targetP].discard.push(unit);
    // Track for Polaris Pact condition
    if (!state.supportDiedLastTurn) state.supportDiedLastTurn = [false, false];
    state.supportDiedLastTurn[targetP] = true;
    const koPenalty = state.activeStage?.id === 'midnight_carnival' ? 0 : 20;
    if (koPenalty > 0) {
      log(`${unit.name} KO'd! +${koPenalty} damage penalty to Player ${targetP + 1}`, 'damage');
      applyDamageToLeader(state, targetP, koPenalty, log);
    } else {
      log(`${unit.name} KO'd! (Midnight Carnival: no penalty)`, 'damage');
    }
  }
}

// Mighty passive: if damage dealt >= 3 and Mighty is not exhausted, draw 1.
function _triggerMightyPassive(state, p, dmg, log) {
  if (dmg < 3) return;
  const mighty = state.players[p].bench.find(u => u.id === 'mighty' && !u.exhausted);
  if (!mighty) return;
  if (state.players[p].deck.length > 0) {
    const card = state.players[p].deck.shift();
    state.players[p].hand.push(card);
    state.missedDraws[p] = 0;
    log(`Mighty: draws ${card.name} (damage dealt)`, 'draw');
  }
}

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------
export function resolveBlock(state, attackerP, defenderP, blockerIdx, log) {
  const unit = state.players[defenderP].bench[blockerIdx];
  if (!unit) return;

  const dmg = calcEffectiveDamage(state, attackerP);
  unit.currentHp -= dmg;
  log(`${unit.name} blocks for Player ${defenderP + 1}! Takes ${dmg} damage (${Math.max(0,unit.currentHp)}/${unit.hp} HP)`, 'damage');
  _triggerMightyPassive(state, attackerP, dmg, log);

  if (unit.currentHp <= 0) {
    state.players[defenderP].bench.splice(blockerIdx, 1);
    state.players[defenderP].discard.push(unit);
    if (!state.supportDiedLastTurn) state.supportDiedLastTurn = [false, false];
    state.supportDiedLastTurn[defenderP] = true;
    const koPenalty = state.activeStage?.id === 'midnight_carnival' ? 0 : 20;
    if (koPenalty > 0) {
      log(`${unit.name} KO'd while blocking! +${koPenalty} damage to Player ${defenderP + 1}`, 'damage');
      applyDamageToLeader(state, defenderP, koPenalty, log);
    } else {
      log(`${unit.name} KO'd while blocking! (Midnight Carnival: no penalty)`, 'damage');
    }
  }
}