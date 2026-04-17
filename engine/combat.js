/**
 * COMBAT
 * Damage calculation, attack resolution, win-condition check.
 * No DOM. All functions are pure state mutators.
 */

import { opponent } from './state.js';

// ---------------------------------------------------------------------------
// Effective damage — recalculated fresh before every attack, never cached.
// Shadow passive: base becomes 2 if he is on bench and not exhausted.
// ---------------------------------------------------------------------------
export function calcEffectiveDamage(state, p) {
  const { total } = calcDamageBreakdown(state, p);
  return total;
}

// Returns a breakdown object for display purposes
export function calcDamageBreakdown(state, p) {
  const base = state.players[p].leader.damage;
  const shadowCount = state.players[p].bench.filter(u => u.id === 'shadow' && !u.exhausted).length;
  const multiplier  = Math.pow(2, shadowCount);
  const baseAfterShadow = base * multiplier;

  let boost = 0;
  const boostSources = [];
  for (const unit of state.players[p].bench) {
    if (!unit.exhausted && unit.passive?.type === 'attack_boost') {
      boost += unit.passive.amount;
      boostSources.push(`${unit.name} +${unit.passive.amount}`);
    }
  }
  if (state.chaosEmeraldBuff[p] > 0) {
    boost += state.chaosEmeraldBuff[p];
    boostSources.push(`Chaos Emerald +${state.chaosEmeraldBuff[p]}`);
  }
  if (state.powerGloveBuff[p] > 0) {
    boost += state.powerGloveBuff[p];
    boostSources.push(`Power Glove +${state.powerGloveBuff[p]}`);
  }

  return { base, multiplier, shadowCount, baseAfterShadow, boost, boostSources, total: baseAfterShadow + boost };
}

// ---------------------------------------------------------------------------
// Apply damage to a Leader.
// Shield absorbs ALL damage and clears. Cream-style reduction applies after.
// triggerVectorPassive is called here so Vector fires on every damage event.
// ---------------------------------------------------------------------------
export function applyDamageToLeader(state, targetP, rawDamage, log, unblockable = false) {
  if (!unblockable && state.shieldActive[targetP]) {
    state.shieldActive[targetP] = false;
    log(`🛡 Shield absorbed ${rawDamage} damage to Player ${targetP + 1}'s Leader!`, 'heal');
    return;
  }

  let reduction = 0;
  if (!unblockable) {
    for (const unit of state.players[targetP].bench) {
      if (!unit.exhausted && unit.passive?.type === 'damage_reduction') {
        reduction += unit.passive.amount;
      }
    }
  }

  const finalDmg = Math.max(0, rawDamage - reduction);
  if (finalDmg <= 0) return;

  state.players[targetP].leader.currentHp -= finalDmg;
  log(`💥 ${finalDmg} damage to Player ${targetP + 1}'s Leader!`, 'damage');

  // Vector passive: draw 1 per damage event on own Leader
  const vector = state.players[targetP].bench.find(u => u.id === 'vector' && !u.exhausted);
  if (vector) {
    _vectorDraw(state, targetP, log);
  }

  // Mighty passive: after Leader is attacked, if damage ≥ 3 draw 1
  // (handled in attackLeader / applyDamageToUnit callers, not here, to avoid
  //  triggering on KO-penalty damage)
}

function _vectorDraw(state, p, log) {
  if (state.players[p].deck.length > 0) {
    const card = state.players[p].deck.shift();
    state.players[p].hand.push(card);
    state.missedDraws[p] = 0;
    log(`🐊 Vector: draws ${card.name} (Leader took damage)`, 'draw');
  }
}

// ---------------------------------------------------------------------------
// Leader attacks opponent Leader directly.
// ---------------------------------------------------------------------------
export function attackLeader(state, attackerP, defenderP, log) {
  if (state.shieldActive[defenderP]) {
    state.shieldActive[defenderP] = false;
    log(`🛡 Shield blocked Leader attack on Player ${defenderP + 1}!`, 'heal');
    _triggerMightyPassive(state, attackerP, 0, log); // 0 dmg — no draw
    return;
  }
  const dmg = calcEffectiveDamage(state, attackerP);
  log(`⚔ Player ${attackerP + 1} attacks Player ${defenderP + 1}'s Leader for ${dmg}!`, 'damage');
  applyDamageToLeader(state, defenderP, dmg, log);
  _triggerMightyPassive(state, attackerP, dmg, log);
}

// ---------------------------------------------------------------------------
// Leader attacks a bench unit.
// ---------------------------------------------------------------------------
export function applyDamageToUnit(state, attackerP, targetP, unitIdx, log) {
  const unit = state.players[targetP].bench[unitIdx];
  if (!unit) return;

  if (state.shieldActive[targetP]) {
    state.shieldActive[targetP] = false;
    log(`🛡 Shield blocked attack on ${unit.name}!`, 'heal');
    _triggerMightyPassive(state, attackerP, 0, log);
    return;
  }

  const dmg = calcEffectiveDamage(state, attackerP);
  unit.currentHp -= dmg;
  log(`⚔ ${unit.name} took ${dmg} damage (${unit.currentHp}/${unit.hp} HP)`, 'damage');
  _triggerMightyPassive(state, attackerP, dmg, log);

  if (unit.currentHp <= 0) {
    state.players[targetP].bench.splice(unitIdx, 1);
    state.players[targetP].discard.push(unit);
    const koPenalty = state.activeStage?.id === 'midnight_carnival' ? 0 : 20;
    if (koPenalty > 0) {
      log(`💀 ${unit.name} KO'd! +${koPenalty} damage penalty to Player ${targetP + 1}`, 'damage');
      applyDamageToLeader(state, targetP, koPenalty, log);
    } else {
      log(`💀 ${unit.name} KO'd! (Midnight Carnival: no penalty)`, 'damage');
    }
  }
}

// Mighty passive: if damage dealt ≥ 3 and Mighty is not exhausted, draw 1.
function _triggerMightyPassive(state, p, dmg, log) {
  if (dmg < 3) return;
  const mighty = state.players[p].bench.find(u => u.id === 'mighty' && !u.exhausted);
  if (!mighty) return;
  if (state.players[p].deck.length > 0) {
    const card = state.players[p].deck.shift();
    state.players[p].hand.push(card);
    state.missedDraws[p] = 0;
    log(`🦔 Mighty: draws ${card.name} (≥3 damage dealt)`, 'draw');
  }
}

// ---------------------------------------------------------------------------
// Blocking — called when defender chooses a bench unit to absorb a Leader attack.
// Shield priority is handled upstream (no shield = block modal shown).
// Cream reduction does NOT apply — Cream protects the Leader, not a blocker.
// Mighty passive fires on attacker side based on damage dealt.
// ---------------------------------------------------------------------------
export function resolveBlock(state, attackerP, defenderP, blockerIdx, log) {
  const unit = state.players[defenderP].bench[blockerIdx];
  if (!unit) return;

  const dmg = calcEffectiveDamage(state, attackerP);
  unit.currentHp -= dmg;
  log(`🛡 ${unit.name} blocks for Player ${defenderP + 1}! Takes ${dmg} damage (${Math.max(0,unit.currentHp)}/${unit.hp} HP)`, 'damage');
  _triggerMightyPassive(state, attackerP, dmg, log);

  if (unit.currentHp <= 0) {
    state.players[defenderP].bench.splice(blockerIdx, 1);
    state.players[defenderP].discard.push(unit);
    const koPenalty = state.activeStage?.id === 'midnight_carnival' ? 0 : 20;
    if (koPenalty > 0) {
      log(`💀 ${unit.name} KO'd while blocking! +${koPenalty} penalty to Player ${defenderP + 1}`, 'damage');
      applyDamageToLeader(state, defenderP, koPenalty, log, true); // unblockable KO penalty
    } else {
      log(`💀 ${unit.name} KO'd! (Midnight Carnival: no penalty)`, 'damage');
    }
  }
}

// ---------------------------------------------------------------------------
// Win condition — returns losing player index or null.
// ---------------------------------------------------------------------------
export function checkWin(state) {
  for (let p = 0; p < 2; p++) {
    if (state.players[p].leader.currentHp <= 0) return p;
  }
  return null;
}
