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
  // Haru Okumura shield: prevent all damage to leader
  if (state.haruShield?.[targetP] && !unblockable) {
    log(`Haru Okumura: damage to Player ${targetP + 1}'s leader prevented!`, 'heal');
    return;
  }
  let reduction = 0;
  if (!unblockable) {
    // Damage reduction passives
    for (const unit of state.players[targetP].bench) {
      if (!unit.exhausted && unit.passive?.type === 'damage_reduction') {
        // Cream always reduces. Tae Takumi and Sojiro only reduce during OPPONENT's attack.
        const alwaysActive = unit.id === 'cream';
        const opponentAttacking = state.activePlayer !== targetP;
        if (alwaysActive || opponentAttacking) {
          reduction += unit.passive.amount;
        }
      }
    }
    // Sae Niijima passive: attacker's Sae reduces opponent's damage reduction by 10
    const attackerP = opponent(targetP);
    const sae = state.players[attackerP]?.bench.find(u => u.id === 'sae_niijima' && !u.exhausted);
    if (sae) reduction = Math.max(0, reduction - 10);
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

  // Kamoshida passive: when the opposing leader takes damage, they discard 1
  // Only triggers during the active player's turn (kamoshidaPassive flag is set per-turn)
  const attackerP = opponent(targetP);
  const kamoshida = state.players[attackerP]?.bench.find(u => u.id === 'suguru_kamoshida' && !u.exhausted);
  if (kamoshida && state.kamoshidaPassive?.[attackerP] && attackerP !== targetP) {
    if (state.players[targetP].hand.length > 0) {
      const idx = Math.floor(Math.random() * state.players[targetP].hand.length);
      const card = state.players[targetP].hand.splice(idx, 1)[0];
      state.players[targetP].discard.push(card);
      log(`Kamoshida: Player ${targetP + 1} discards ${card.name} (leader took damage)`, 'damage');
    }
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
  // Ryuji/Makoto passive: heal 10 if damage >= 20
  if (dmg >= 20) {
    _triggerHealOnDamagePassive(state, attackerP, log);
  }
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
  // Ryuji/Makoto passive: heal 10 if damage >= 20 (mirrors attackLeader behaviour)
  if (dmg >= 20) _triggerHealOnDamagePassive(state, attackerP, log);

  // Track damage to enemy units for Futaba passive
  if (!state.dmgToEnemyUnitsThisTurn) state.dmgToEnemyUnitsThisTurn = [0, 0];
  state.dmgToEnemyUnitsThisTurn[attackerP] += dmg;

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
    // Mementos Depths: KO triggers controller discard
    if (state.activeStage?.id === 'mementos_depths' && state.players[targetP].hand.length > 0) {
      const di = Math.floor(Math.random() * state.players[targetP].hand.length);
      const disc = state.players[targetP].hand.splice(di, 1)[0];
      state.players[targetP].discard.push(disc);
      log(`Mementos Depths: Player ${targetP + 1} discards ${disc.name}`, 'damage');
    }
  }
}

// Mighty passive: if damage dealt >= 3 and Mighty is not exhausted, draw 1.
function _triggerMightyPassive(state, p, dmg, log) {
  if (dmg < 30) return;
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
// Intercepting
// ---------------------------------------------------------------------------
export function resolveIntercept(state, attackerP, defenderP, interceptorIdx, log) {
  const unit = state.players[defenderP].bench[interceptorIdx];
  if (!unit) return;

  const dmg = calcEffectiveDamage(state, attackerP);
  const unitHpBefore = unit.currentHp;
  unit.currentHp -= dmg;
  log(`${unit.name} intercepts for Player ${defenderP + 1}! Takes ${dmg} damage (${Math.max(0, unit.currentHp)}/${unit.hp} HP)`, 'damage');
  _triggerMightyPassive(state, attackerP, dmg, log);
  // Ryuji/Makoto passive: heal if damage >= 20
  if (dmg >= 20) _triggerHealOnDamagePassive(state, attackerP, log);

  if (unit.currentHp <= 0) {
    state.players[defenderP].bench.splice(interceptorIdx, 1);
    state.players[defenderP].discard.push(unit);
    if (!state.supportDiedLastTurn) state.supportDiedLastTurn = [false, false];
    state.supportDiedLastTurn[defenderP] = true;

    if (state.activeStage?.id === 'midnight_carnival') {
      log(`${unit.name} KO'd while intercepting! (Midnight Carnival: no overflow damage)`, 'damage');
    } else {
      // Overflow: excess damage beyond the interceptor's remaining HP spills to the Leader.
      // Overflow is at least 20 (the normal KO penalty), or more if the attack overshot.
      const overflow = Math.max(20, dmg - unitHpBefore);
      log(`${unit.name} KO'd while intercepting! ${overflow} overflow damage to Player ${defenderP + 1}'s Leader`, 'damage');
      applyDamageToLeader(state, defenderP, overflow, log);
    }

    if (state.activeStage?.id === 'mementos_depths' && state.players[defenderP].hand.length > 0) {
      const di = Math.floor(Math.random() * state.players[defenderP].hand.length);
      const disc = state.players[defenderP].hand.splice(di, 1)[0];
      state.players[defenderP].discard.push(disc);
      log(`Mementos Depths: Player ${defenderP + 1} discards ${disc.name}`, 'damage');
    }
  }
}

// Ryuji Sakamoto / Makoto Niijima: heal leader 10 HP when attack deals 20+
function _triggerHealOnDamagePassive(state, p, log) {
  const leader = state.players[p].leader;
  if (!state.healedThisTurn) state.healedThisTurn = [0, 0];
  // Each unit heals independently
  const ryuji  = state.players[p].bench.find(u => u.id === 'ryuji_sakamoto' && !u.exhausted);
  if (ryuji) {
    const gain = Math.min(10, leader.hp - leader.currentHp);
    leader.currentHp += gain;
    state.healedThisTurn[p] = (state.healedThisTurn[p] ?? 0) + gain;
    log(`Ryuji Sakamoto: Leader heals ${gain} HP (${leader.currentHp}/${leader.hp})`, 'heal');
  }
  const makoto = state.players[p].bench.find(u => u.id === 'makoto_niijima' && !u.exhausted);
  if (makoto) {
    const gain = Math.min(10, leader.hp - leader.currentHp);
    leader.currentHp += gain;
    state.healedThisTurn[p] = (state.healedThisTurn[p] ?? 0) + gain;
    log(`Makoto Niijima: Leader heals ${gain} HP (${leader.currentHp}/${leader.hp})`, 'heal');
  }
}