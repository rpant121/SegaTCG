/**
 * ACTIONS
 * Every legal player action. Pure state mutators — no DOM.
 * All functions accept a `log(msg, type)` callback.
 */

import { opponent } from './state.js';
import { applyDamageToLeader, checkWin } from './combat.js';

// ---------------------------------------------------------------------------
// Energy helpers
// ---------------------------------------------------------------------------
export function canAfford(state, cost) {
  return state.energy[state.activePlayer] >= cost;
}

export function spendEnergy(state, cost) {
  const p = state.activePlayer;
  state.energy[p] -= cost;
  state.energySpentThisTurn[p] += cost;
}

export function getActiveCost(state, unit) {
  if (state.masterEmeraldActive) return 0;
  const p   = state.activePlayer;
  const opp = opponent(p);
  const hasSilver = state.players[p].bench.some(
    u => u.id === 'silver' && !u.exhausted && u.uid !== unit.uid
  );
  const reduction = hasSilver ? 1 : 0;
  return Math.max(1, unit.activeCost - reduction);
}

// Returns true if Justine+Caroline passive is blocking opponent's active use for this unit
export function justineBlocksActive(state, unit) {
  const p   = state.activePlayer;
  const opp = opponent(p);
  // Check if opponent has both Caroline AND Justine on bench (not exhausted)
  const hasCaroline = state.players[opp].bench.some(u => u.id === 'caroline' && !u.exhausted);
  const hasJustine  = state.players[opp].bench.some(u => u.id === 'justine'  && !u.exhausted);
  if (!hasCaroline || !hasJustine) return false;
  // Block if this unit's uid is in the disabled list
  return state.justineDisabledUid === unit.uid;
}

// ---------------------------------------------------------------------------
// Draw cards (with empty-deck penalty)
// ---------------------------------------------------------------------------
export function drawCards(state, p, count, log, fromDrawPhase = false) {
  // Contract of Rebellion: block non-draw-phase draws for the affected player
  if (!fromDrawPhase && state.contractNoDrawUntil?.[p] > state.turn) {
    log(`Contract of Rebellion: Player ${p + 1} cannot draw outside Draw Phase!`, 'damage');
    return;
  }
  for (let i = 0; i < count; i++) {
    if (state.players[p].deck.length === 0) {
      state.missedDraws[p]++;
      const penalty = state.missedDraws[p] * 10;
      log(`⚠ Player ${p + 1} empty deck — takes ${penalty} damage!`, 'damage');
      applyDamageToLeader(state, p, penalty, log);
    } else {
      const card = state.players[p].deck.shift();
      state.players[p].hand.push(card);
      state.missedDraws[p] = 0;
      log(`📄 Player ${p + 1} draws ${card.name}`, 'draw');
      // Shibuya Crossing: when opponent draws outside draw phase, they discard 1
      if (!fromDrawPhase && state.activeStage?.id === 'shibuya_crossing') {
        if (state.players[p].hand.length > 0) {
          const discIdx = Math.floor(Math.random() * state.players[p].hand.length);
          const disc = state.players[p].hand.splice(discIdx, 1)[0];
          state.players[p].discard.push(disc);
          log(`Shibuya Crossing: Player ${p + 1} drew outside Draw Phase — discards ${disc.name}`, 'damage');
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Play a card from hand
// ---------------------------------------------------------------------------
export function playCardFromHand(state, handIdx, log) {
  if (state.phase === 'setup') {
    const sp   = state._setupPlayer ?? 0;
    const card = state.players[sp].hand[handIdx];
    if (!card) return false;
    if (card.type !== 'Unit') { log(`❌ Only units can be deployed during setup`, 'damage'); return false; }
    if (state.players[sp].bench.length >= 3) { log(`❌ Bench is full`, 'damage'); return false; }
    state.players[sp].hand.splice(handIdx, 1);
    deployUnit(state, sp, card, log);
    return true;
  }

  const p    = state.activePlayer;
  const card = state.players[p].hand[handIdx];
  if (!card) return false;

  const baseCost  = card.cost ?? 0;
  const isEquip   = card.type === 'Equipment' || card.type === 'Genesis' || card.type === 'Stage';

  // Caroline passive: opponent can only play 1 equipment per turn
  if (isEquip) {
    const carolineOnOppBench = state.players[opponent(p)]?.bench.some(u => u.id === 'caroline' && !u.exhausted);
    const justineOnOppBench  = state.players[opponent(p)]?.bench.some(u => u.id === 'justine'  && !u.exhausted);
    if (carolineOnOppBench && justineOnOppBench && state.equipmentPlayedThisTurn[p] >= 1) {
      log('❌ Caroline + Justine passive: you may only play 1 equipment card this turn', 'damage');
      return false;
    }
  }

  const charmyDiscount = (isEquip && state.equipmentPlayedThisTurn[p] > 0)
    ? (state.players[p].bench.some(u => u.id === 'charmy' && !u.exhausted) ? 1 : 0)
    : 0;
  const cost = Math.max(0, baseCost - charmyDiscount);

  if (!canAfford(state, cost)) {
    log(`❌ Not enough energy to play ${card.name}`, 'damage');
    return false;
  }

  if (card.type === 'Unit' && state.players[p].bench.length >= 3) {
    log(`❌ Bench is full — ${card.name} stays in hand`, 'damage');
    return false;
  }
  if (card.type === 'Stage' && state.activeStage?.name === card.name) {
    log(`❌ ${card.name} is already the active stage — stays in hand`, 'damage');
    return false;
  }

  state.players[p].hand.splice(handIdx, 1);
  spendEnergy(state, cost);
  if (charmyDiscount > 0) log(`🐝 Charmy: ${card.name} costs 1 less (paid ${cost})`, 'play');
  log(`▶ Player ${p + 1} plays ${card.name}`, 'play');

  if (isEquip) state.equipmentPlayedThisTurn[p]++;

  switch (card.type) {
    case 'Unit':      deployUnit(state, p, card, log);             break;
    case 'Stage':     activateStage(state, p, card, log);          break;
    case 'Equipment':
    case 'Genesis':
      applyEquipmentEffect(state, p, card, log);
      state.players[p].discard.push(card);
      if (card.isGenesis) state._genesisPlayedBy = p;
      break;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Play a card from discard (Tails / Blaze)
// ---------------------------------------------------------------------------
export function playCardFromDiscard(state, p, card, log) {
  log(`♻ Player ${p + 1} plays ${card.name} from discard`, 'play');

  const ray = state.players[p].bench.find(u => u.id === 'ray' && !u.exhausted);
  if (ray) {
    log(`🐿 Ray: draws 1 (card played from discard)`, 'draw');
    drawCards(state, p, 1, log);
  }

  const isEquip = card.type === 'Equipment' || card.type === 'Genesis' || card.type === 'Stage';
  if (isEquip) state.equipmentPlayedThisTurn[p]++;

  switch (card.type) {
    case 'Unit':      deployUnit(state, p, card, log);             break;
    case 'Stage':     activateStage(state, p, card, log);          break;
    case 'Equipment':
    case 'Genesis':
      applyEquipmentEffect(state, p, card, log);
      state.players[p].discard.push(card);
      break;
  }
}

function deployUnit(state, p, card, log) {
  if (state.players[p].bench.length >= 3) {
    log(`❌ Bench full — ${card.name} sent to discard`, 'damage');
    state.players[p].discard.push(card);
    return;
  }
  const newUnit = { ...card, currentHp: card.hp, exhausted: false };
  state.players[p].bench.push(newUnit);
  log(`📌 ${card.name} deployed to bench`, 'play');
  // Yusuke passive: on placement, copy a passive from another benched unit
  if (card.id === 'yusuke_kitagawa') {
    const others = state.players[p].bench.filter(u => u.uid !== newUnit.uid && u.passive?.type && u.passive.type !== 'none');
    if (others.length > 0) {
      // Copy the first available passive (engine-side: copy first; UI could offer choice later)
      const donor = others[0];
      newUnit.passive = { ...donor.passive };
      newUnit.passiveDesc = donor.passiveDesc + ' (copied from ' + donor.name + ')';
      log(`Yusuke: copied ${donor.name}'s passive`, 'play');
    }
  }
}

function activateStage(state, p, card, log) {
  if (state.activeStage) {
    const originalOwner = state.activeStage._playedBy ?? p;
    state.players[originalOwner].discard.push(state.activeStage);
    log(`Stage replaced — returned to P${originalOwner + 1} discard`, 'phase');
  }
  state.activeStage = { ...card, _playedBy: p };
  log(`Stage: ${card.name} is now active`, 'play');
}

export function applyEquipmentEffect(state, p, card, log) {
  const opp = opponent(p);
  switch (card.id) {
    case 'ring':
      state.energy[p] += 1;
      log(`💍 Ring: +1 Energy (now ${state.energy[p]})`, 'play');
      break;
    case 'chaos_emerald':
      state.chaosEmeraldBuff[p] += 20;
      log(`💎 Chaos Emerald: Leader +20 Damage this turn`, 'play');
      break;
    case 'master_emerald':
      state.masterEmeraldActive = true;
      log(`💚 Master Emerald: All bench actives free this turn!`, 'play');
      break;
    case 'elemental_shield':
      // Adds 20 flat reduction to next incoming damage event
      if (!state.shieldReduction) state.shieldReduction = [0, 0];
      state.shieldReduction[p] += 20;
      log(`🛡 Elemental Shield: -20 to next damage taken by Player ${p + 1}`, 'play');
      break;
    case 'chili_dog': {
      const leader = state.players[p].leader;
      const healed = Math.min(20, leader.hp - leader.currentHp);
      leader.currentHp += healed;
      if (!state.healedThisTurn) state.healedThisTurn = [0, 0];
      state.healedThisTurn[p] = (state.healedThisTurn[p] ?? 0) + healed;
      log(`🔥 Chili Dog: Leader healed ${healed} HP (${leader.currentHp}/${leader.hp})`, 'heal');
      break;
    }
    case 'dragons_eye':
      if (state.players[p].deck.length === 0) {
        log(`👁 Dragon's Eye: Deck is empty — no effect`, 'phase');
        break;
      }
      state.pendingDragonsEye = {
        playerIdx: p,
        cards: state.players[p].deck.slice(0, Math.min(3, state.players[p].deck.length)),
      };
      log(`👁 Dragon's Eye: Choose 1 of the top ${state.pendingDragonsEye.cards.length} cards`, 'play');
      break;
    case 'power_glove':
      state.powerGloveBuff[p] += 30;
      log(`🥊 Power Glove: Leader +30 Damage this turn`, 'play');
      break;
    case 'polaris_pact': {
      if (!state.supportDiedLastTurn?.[p]) {
        log('Polaris Pact: no friendly support died last turn — no effect', 'phase');
        break;
      }
      const _shuf = (arr) => { for (let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr; };
      [...state.players[p].hand].forEach(c => state.players[p].deck.push(c));
      state.players[p].hand = [];
      _shuf(state.players[p].deck);
      [...state.players[opp].hand].forEach(c => state.players[opp].deck.push(c));
      state.players[opp].hand = [];
      _shuf(state.players[opp].deck);
      log('Polaris Pact: both hands shuffled into decks', 'play');
      drawCards(state, p,   5, log);
      drawCards(state, opp, 2, log);
      log(`Polaris Pact: P${p+1} draws 5, P${opp+1} draws 2`, 'play');
      break;
    }
    case 'speed_shoes':
      state.energy[p] += 3;
      log(`👟 Speed Shoes: +3 Energy (now ${state.energy[p]})`, 'play');
      break;
    case 'extreme_gear':
      if (state.players[p].hand.length === 0) {
        log('⚙ Extreme Gear: hand is empty — no effect', 'phase');
        break;
      }
      state.pendingExtremeGear = { playerIdx: p, maxDiscards: 3 };
      log('⚙ Extreme Gear: choose up to 3 cards to discard for energy', 'play');
      break;
    case 'super_form':
      state.energy[p] *= 2;
      log(`✨ Super Form: Energy doubled to ${state.energy[p]}!`, 'play');
      break;

    // ── Persona 5 Equipment ───────────────────────────────────────────────

    case 'calling_card': {
      const opp = opponent(p);
      if (state.players[opp].hand.length > 0) {
        const idx = Math.floor(Math.random() * state.players[opp].hand.length);
        const card = state.players[opp].hand.splice(idx, 1)[0];
        state.players[opp].discard.push(card);
        log(`Calling Card: opponent discards ${card.name}`, 'damage');
        _triggerDiscardPassives(state, p, log);
        if (!state.opponentDiscardsThisTurn) state.opponentDiscardsThisTurn = [0, 0];
        state.opponentDiscardsThisTurn[p]++;
      }
      break;
    }
    case 'treasure_distorted_desire': {
      const opp = opponent(p);
      const bonus = state.players[opp].hand.length <= 3 ? 40 : 20;
      state.chaosEmeraldBuff[p] = (state.chaosEmeraldBuff[p] ?? 0) + bonus;
      log(`Treasure (Distorted Desire): Leader +${bonus} Damage this turn`, 'play');
      break;
    }
    case 'leblanc_coffee': {
      const leader = state.players[p].leader;
      const healed = Math.min(20, leader.hp - leader.currentHp);
      leader.currentHp += healed;
      if (!state.healedThisTurn) state.healedThisTurn = [0, 0];
      state.healedThisTurn[p] = (state.healedThisTurn[p] ?? 0) + healed;
      log(`LeBlanc Coffee: healed Leader ${healed} HP (${leader.currentHp}/${leader.hp})`, 'heal');
      // Optional: discard 1 draw 1 — set pending
      if (state.players[p].hand.length > 0) {
        state.pendingLeblanc = { playerIdx: p };
        log(`LeBlanc Coffee: pending — choose a card to discard for 1 draw`, 'play');
      }
      break;
    }
    case 'third_eye': {
      if (state.players[p].deck.length === 0) { log('Third Eye: deck empty', 'phase'); break; }
      state.pendingDragonsEye = {
        playerIdx: p,
        cards: state.players[p].deck.slice(0, Math.min(3, state.players[p].deck.length)),
      };
      log(`Third Eye: choose 1 of top ${state.pendingDragonsEye.cards.length} cards`, 'play');
      // Also discard random opponent card
      const opp = opponent(p);
      if (state.players[opp].hand.length > 0) {
        const idx = Math.floor(Math.random() * state.players[opp].hand.length);
        const card = state.players[opp].hand.splice(idx, 1)[0];
        state.players[opp].discard.push(card);
        log(`Third Eye: opponent discards ${card.name}`, 'damage');
        _triggerDiscardPassives(state, p, log);
        if (!state.opponentDiscardsThisTurn) state.opponentDiscardsThisTurn = [0, 0];
        state.opponentDiscardsThisTurn[p]++;
      }
      break;
    }
    case 'phantom_thief_tools': {
      const opp = opponent(p);
      const gain = state.players[opp].hand.length > state.players[p].hand.length ? 3 : 2;
      state.energy[p] += gain;
      log(`Phantom Thief Tools: +${gain} Energy (now ${state.energy[p]})`, 'play');
      break;
    }
    case 'metaverse_navigator': {
      const opp = opponent(p);
      const myCount  = state.players[p].hand.length;
      const oppCount = state.players[opp].hand.length;
      // Both shuffle hands into decks and draw that many
      const shuffle = (arr) => { for (let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];} return arr; };
      state.players[p].hand.forEach(c => state.players[p].deck.push(c));
      state.players[p].hand = [];
      shuffle(state.players[p].deck);
      state.players[opp].hand.forEach(c => state.players[opp].deck.push(c));
      state.players[opp].hand = [];
      shuffle(state.players[opp].deck);
      drawCards(state, p,   myCount,  log);
      drawCards(state, opp, oppCount, log);
      log(`Metaverse Navigator: both redrew their hands`, 'play');
      break;
    }
    case 'guard_persona': {
      // Full damage prevention for opponent's next turn — use shieldReduction set to very high
      if (!state.shieldReduction) state.shieldReduction = [0, 0];
      state.shieldReduction[p] += 9999;
      // Also set pending discard for opponent
      const opp = opponent(p);
      state.pendingGuardPersona = { targetIdx: opp };
      log(`Guard Persona: all damage to Player ${p+1} blocked next turn. Opponent will discard 1.`, 'play');
      break;
    }
    case 'all_out_attack': {
      const opp = opponent(p);
      const bonus = state.players[opp].hand.length <= 2 ? 50 : 30;
      state.powerGloveBuff[p] = (state.powerGloveBuff[p] ?? 0) + bonus;
      log(`All-Out Attack: Leader +${bonus} Damage this turn`, 'play');
      break;
    }
    case 'holy_grail':
      state.masterEmeraldActive = true;
      log('Holy Grail: all bench actives cost 0 and do not exhaust this turn!', 'play');
      break;
    case 'contract_of_rebellion': {
      const opp = opponent(p);
      // Both draw to 6
      while (state.players[p].hand.length < 6 && state.players[p].deck.length > 0)
        state.players[p].hand.push(state.players[p].deck.shift());
      while (state.players[opp].hand.length < 6 && state.players[opp].deck.length > 0)
        state.players[opp].hand.push(state.players[opp].deck.shift());
      log('Contract of Rebellion: both drew to 6', 'play');
      // Opponent discards 2 at random
      for (let i = 0; i < 2 && state.players[opp].hand.length > 0; i++) {
        const idx = Math.floor(Math.random() * state.players[opp].hand.length);
        const card = state.players[opp].hand.splice(idx, 1)[0];
        state.players[opp].discard.push(card);
        log(`Contract of Rebellion: opponent discards ${card.name}`, 'damage');
        _triggerDiscardPassives(state, p, log);
        if (!state.opponentDiscardsThisTurn) state.opponentDiscardsThisTurn = [0, 0];
        state.opponentDiscardsThisTurn[p]++;
      }
      // Opponent cannot draw outside Draw Phase until next turn
      if (!state.contractNoDrawUntil) state.contractNoDrawUntil = [0, 0];
      state.contractNoDrawUntil[opp] = state.turn + 1;
      log('Contract of Rebellion: opponent cannot draw outside Draw Phase until your next turn', 'play');
      break;
    }
    case 'arsene_unleashed': {
      // Set target leader's HP to half max (prompt needed — set pending)
      state.pendingArsene = { playerIdx: p };
      log('Arsène Unleashed: choose a leader to set to half HP', 'play');
      break;
    }
    // Stages handled by phase checks (shibuya_crossing, mementos_depths, palace_infiltration_route)
  }
}

function _refillToSix(state, p, log) {
  let drawn = 0;
  while (state.players[p].hand.length < 6 && state.players[p].deck.length > 0) {
    state.players[p].hand.push(state.players[p].deck.shift());
    drawn++;
  }
  if (drawn > 0) log(`📄 Player ${p + 1} draws ${drawn} (hand now ${state.players[p].hand.length})`, 'draw');
}

// ---------------------------------------------------------------------------
// Exhaust helpers
// ---------------------------------------------------------------------------
export function exhaustUnit(state, p, benchIdx) {
  const unit = state.players[p].bench[benchIdx];
  if (!unit) return;
  if (!state.usedActivesThisTurn.includes(unit.uid)) {
    state.usedActivesThisTurn.push(unit.uid);
  }
  if (state.masterEmeraldActive) return;
  unit.exhausted = true;
}

export function hasUsedActiveThisTurn(state, unit) {
  return state.usedActivesThisTurn.includes(unit.uid);
}

// ---------------------------------------------------------------------------
// Rouge passive
// ---------------------------------------------------------------------------
export function triggerRougePassive(state, p, log) {
  const rouge = state.players[p].bench.find(u => u.id === 'rouge' && !u.exhausted);
  if (!rouge) return;
  if (state.players[p].deck.length > 0) {
    const card = state.players[p].deck.shift();
    state.players[p].hand.push(card);
    state.missedDraws[p] = 0;
    log(`🦇 Rouge: draws ${card.name} (discard event)`, 'draw');
  }
}

// ---------------------------------------------------------------------------
// Unit actives
// ---------------------------------------------------------------------------
export function tailsActive(state, p, benchIdx, discardIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  if (state.players[p].discard.length === 0) { log('♻ Tails: Discard is empty', 'phase'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const card = state.players[p].discard.splice(discardIdx, 1)[0];
  if (card.type === 'Stage') {
    state.players[p].discard.splice(discardIdx, 0, card);
    log('❌ Tails: cannot replay a Stage card', 'damage');
    return false;
  }
  log(`♻ Tails: plays ${card.name} from discard, then shuffles back into deck`, 'play');
  playCardFromDiscard(state, p, card, log);
  if (card.type === 'Equipment' || card.type === 'Genesis') {
    const di = state.players[p].discard.indexOf(card);
    if (di !== -1) state.players[p].discard.splice(di, 1);
    const pos = Math.floor(Math.random() * (state.players[p].deck.length + 1));
    state.players[p].deck.splice(pos, 0, card);
    log(`♻ ${card.name} shuffled back into deck`, 'play');
  }
  return true;
}
export function knucklesActive(state, p, benchIdx, targetUnitIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  const opp  = opponent(p);
  const unit = state.players[opp].bench[targetUnitIdx];
  if (!unit) return false;
  if (unit.id === 'haru_okumura') { log('👊 Knuckles: Haru cannot be targeted!', 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  unit.currentHp -= 10;
  if (!state.dmgToEnemyUnitsThisTurn) state.dmgToEnemyUnitsThisTurn = [0, 0];
  state.dmgToEnemyUnitsThisTurn[p] += 10;
  log(`👊 Knuckles: 10 damage to ${unit.name} (${Math.max(0,unit.currentHp)}/${unit.hp})`, 'damage');
  if (unit.currentHp <= 0) {
    state.players[opp].bench.splice(targetUnitIdx, 1);
    state.players[opp].discard.push(unit);
    const pen = state.activeStage?.id === 'midnight_carnival' ? 0 : 20;
    if (pen > 0) { log(`💀 ${unit.name} KO'd! +${pen} damage to P${opp + 1}`, 'damage'); applyDamageToLeader(state, opp, pen, log); }
    else          { log(`💀 ${unit.name} KO'd! (Midnight Carnival: no penalty)`, 'damage'); }
    _triggerMementosDepths(state, opp, log);
  }
  return true;
}

export function amyActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const opp = opponent(p);
  log(`🌸 Amy: 10 damage to Player ${opp + 1}'s Leader`, 'damage');
  applyDamageToLeader(state, opp, 10, log);
  return true;
}

export function creamActive(state, p, benchIdx, targetType, targetBenchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  if (targetType === 'leader') {
    const l = state.players[p].leader;
    const creamHeal = Math.min(10, l.hp - l.currentHp);
    l.currentHp += creamHeal;
    if (!state.healedThisTurn) state.healedThisTurn = [0, 0];
    state.healedThisTurn[p] = (state.healedThisTurn[p] ?? 0) + creamHeal;
    log(`💚 Cream heals Leader ${creamHeal} HP (${l.currentHp}/${l.hp})`, 'heal');
  } else {
    const u = state.players[p].bench[targetBenchIdx];
    if (!u) { log('❌ Cream: invalid target', 'damage'); return false; }
    const creamHeal = Math.min(10, u.hp - u.currentHp);
    u.currentHp += creamHeal;
    log(`💚 Cream heals ${u.name} ${creamHeal} HP (${u.currentHp}/${u.hp})`, 'heal');
  }
  return true;
}

export function bigActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const opp  = opponent(p);
  const hand = state.players[opp].hand;
  if (hand.length === 0) { log(`🐟 Big: Opponent hand is empty`, 'phase'); }
  else {
    const idx  = Math.floor(Math.random() * hand.length);
    const card = hand.splice(idx, 1)[0];
    state.players[p].discard.push(card);
    log(`🐟 Big: Takes ${card.name} from opponent's hand into your discard`, 'damage');
  }
  return true;
}

export function silverActive(state, p, benchIdx, targetBenchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);

  const bounced = state.players[p].bench.splice(targetBenchIdx, 1)[0];
  if (!bounced) return false;
  state.usedActivesThisTurn = state.usedActivesThisTurn.filter(u => u !== bounced.uid);
  state.players[p].hand.push({ ...bounced, currentHp: bounced.hp, exhausted: false });
  log(`⚡ Silver: ${bounced.name} returned to hand (active reset)`, 'play');
  return true;
}



export function rougeActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  if (state.players[p].deck.length === 0) { log(`🦇 Rouge: Deck is empty`, 'phase'); return false; }
  if (state.rougeUsedThisTurn[p]) { log(`🦇 Rouge: already used this turn`, 'phase'); return false; }
  spendEnergy(state, cost);
  state.rougeUsedThisTurn[p] = true;
  state.activesUsedThisTurn++;
  const card = state.players[p].deck.shift();
  state.players[p].discard.push(card);
  log(`🦇 Rouge: mills ${card.name} to discard`, 'play');
  triggerRougePassive(state, p, log);
  return true;
}

export function blazeActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const count = state.players[p].discard.length;
  while (state.players[p].discard.length > 0) {
    const card = state.players[p].discard.pop();
    state.players[p].deck.push(card);
  }
  const deck = state.players[p].deck;
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  log(`🔥 Blaze: shuffled ${count} cards back into deck, draws 2`, 'play');
  drawCards(state, p, 2, log);
  return true;
}

export function rayActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  if (state.players[p].deck.length === 0) { log(`🐿 Ray: Deck is empty`, 'phase'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  state.pendingRayActive = {
    playerIdx: p,
    cards: state.players[p].deck.slice(0, Math.min(3, state.players[p].deck.length)),
  };
  log(`🐿 Ray: Choose 1 of the top ${state.pendingRayActive.cards.length} cards to discard`, 'play');
  return true;
}

export function charmyActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const count = state.equipmentPlayedThisTurn[p];
  log(`🐝 Charmy: draws ${count} card(s) (${count} equipment played this turn)`, 'draw');
  if (count > 0) drawCards(state, p, count, log);
  return true;
}

export function espioActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const equipCards = state.players[p].discard.filter(
    c => c.type === 'Equipment' || c.type === 'Genesis' || c.type === 'Stage'
  );
  const toReturn = equipCards.slice(0, 3);
  toReturn.forEach(card => {
    const idx = state.players[p].discard.indexOf(card);
    state.players[p].discard.splice(idx, 1);
    state.players[p].deck.push(card);
  });
  const deck = state.players[p].deck;
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  log(`🦎 Espio: returned ${toReturn.length} equipment to deck, draws 1`, 'play');
  drawCards(state, p, 1, log);
  return true;
}

export function vectorActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  spendEnergy(state, cost);
  state.activesUsedThisTurn++;
  const dmg = state.energySpentThisTurn[p] * 10; // scaled x10
  const opp = opponent(p);
  exhaustUnit(state, p, benchIdx);
  log(`🐊 Vector: deals ${dmg} damage (total energy spent this turn)`, 'damage');
  applyDamageToLeader(state, opp, dmg, log);
  return true;
}

// ---------------------------------------------------------------------------
// Persona 5 Unit Actives
// ---------------------------------------------------------------------------

// Caroline: revive Justine if she died alone last turn
export function carolineActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  // Check if Justine died alone last turn (tracked via state.carolineLock[p])
  if (!state.carolineLock?.[p]) {
    log('❌ Caroline: Justine did not die alone last turn', 'damage'); return false;
  }
  if (state.players[p].bench.length >= 3) {
    log('❌ Caroline: bench is full', 'damage'); return false;
  }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  // Find Justine in discard and revive her
  const justineIdx = state.players[p].discard.findIndex(c => c.id === 'justine');
  if (justineIdx >= 0) {
    const justine = state.players[p].discard.splice(justineIdx, 1)[0];
    state.players[p].bench.push({ ...justine, currentHp: justine.hp, exhausted: false });
    log('Caroline: Justine revived to bench!', 'play');
  } else {
    log('Caroline: Justine not found in discard', 'phase');
  }
  return true;
}

// Justine: revive Caroline if she died alone last turn
export function justineActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  if (!state.justineLock?.[p]) {
    log('❌ Justine: Caroline did not die alone last turn', 'damage'); return false;
  }
  if (state.players[p].bench.length >= 3) {
    log('❌ Justine: bench is full', 'damage'); return false;
  }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const carolineIdx = state.players[p].discard.findIndex(c => c.id === 'caroline');
  if (carolineIdx >= 0) {
    const caroline = state.players[p].discard.splice(carolineIdx, 1)[0];
    state.players[p].bench.push({ ...caroline, currentHp: caroline.hp, exhausted: false });
    log('Justine: Caroline revived to bench!', 'play');
  } else {
    log('Justine: Caroline not found in discard', 'phase');
  }
  return true;
}

// Tae Takumi: heal leader 20 HP
export function taeTakumiActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const leader = state.players[p].leader;
  const healed = Math.min(20, leader.hp - leader.currentHp);
  leader.currentHp += healed;
  if (!state.healedThisTurn) state.healedThisTurn = [0, 0];
  state.healedThisTurn[p] = (state.healedThisTurn[p] ?? 0) + healed;
  log(`Tae Takumi: healed Leader ${healed} HP (${leader.currentHp}/${leader.hp})`, 'heal');
  return true;
}

// Sojiro Sakura: gain taunt — this unit must be attacked first
export function sojiroSakuraActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  if (!state.tauntUnit) state.tauntUnit = [null, null];
  state.tauntUnit[p] = state.players[p].bench[benchIdx]?.uid ?? null;
  log(`Sojiro Sakura: taunt active — opponent must attack Sojiro first`, 'play');
  return true;
}

// Sae Niijima: next leader attack this turn cannot be blocked
export function saeNiijimaActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  if (!state.unblockableAttack) state.unblockableAttack = [false, false];
  state.unblockableAttack[p] = true;
  log('Sae Niijima: next attack cannot be blocked!', 'play');
  return true;
}

// Sadayo Kawakami: deal 10 damage to each opponent bench unit
export function sadayoKawakamiActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const opp = opponent(p);
  const bench = state.players[opp].bench;
  if (bench.length === 0) { log('Sadayo Kawakami: no opponent bench units', 'phase'); return true; }
  log(`Sadayo Kawakami: 10 damage to all ${bench.length} opponent bench units`, 'damage');
  // Iterate backwards so splicing doesn't break indices
  if (!state.dmgToEnemyUnitsThisTurn) state.dmgToEnemyUnitsThisTurn = [0, 0];
  for (let i = bench.length - 1; i >= 0; i--) {
    if (bench[i].id === 'haru_okumura') continue; // Haru immune to ability damage
    bench[i].currentHp -= 10;
    state.dmgToEnemyUnitsThisTurn[p] += 10;
    if (bench[i].currentHp <= 0) {
      const ko = bench.splice(i, 1)[0];
      state.players[opp].discard.push(ko);
      if (!state.supportDiedLastTurn) state.supportDiedLastTurn = [false, false];
      state.supportDiedLastTurn[opp] = true;
      const penalty = state.activeStage?.id === 'midnight_carnival' ? 0 : 20;
      if (penalty > 0) applyDamageToLeader(state, opp, penalty, log);
      log(`${ko.name} KO'd!`, 'damage');
      _triggerMementosDepths(state, opp, log);
    }
  }
  return true;
}

// Suguru Kamoshida: opponent discards 2 cards at random
export function suguruKamoshidaActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const opp = opponent(p);
  let discarded = 0;
  for (let i = 0; i < 2; i++) {
    if (state.players[opp].hand.length === 0) break;
    const idx = Math.floor(Math.random() * state.players[opp].hand.length);
    const card = state.players[opp].hand.splice(idx, 1)[0];
    state.players[opp].discard.push(card);
    discarded++;
    log(`Kamoshida: opponent discards ${card.name}`, 'damage');
    // Ann/Sumire passive: deal 10 damage per opponent discard
    _triggerDiscardPassives(state, p, log);
  }
  if (!state.opponentDiscardsThisTurn) state.opponentDiscardsThisTurn = [0, 0];
  state.opponentDiscardsThisTurn[p] += discarded;
  return true;
}

// Ryuji Sakamoto: deal 10 damage to opponent leader
export function ryujiSakamotoActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const opp = opponent(p);
  log('Ryuji Sakamoto: 10 damage to opponent Leader', 'damage');
  applyDamageToLeader(state, opp, 10, log);
  return true;
}

// Ann Takamaki: exile cards from opponent discard equal to discards this turn
export function annTakamakiActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const opp = opponent(p);
  const count = state.opponentDiscardsThisTurn?.[p] ?? 0;
  if (count === 0) { log('Ann Takamaki: no discards this turn — no exile', 'phase'); return true; }
  const exiled = Math.min(count, state.players[opp].discard.length);
  state.players[opp].discard.splice(state.players[opp].discard.length - exiled, exiled);
  log(`Ann Takamaki: exiled ${exiled} card(s) from opponent discard`, 'play');
  return true;
}

// Morgana: Morgana and one enemy bench unit both go to discard
export function morganaActive(state, p, benchIdx, targetBenchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  const opp = opponent(p);
  if (state.players[opp].bench.length === 0) { log('❌ Morgana: no opponent bench units', 'damage'); return false; }
  const morgTarget = state.players[opp].bench[targetBenchIdx];
  if (morgTarget && morgTarget.id === 'haru_okumura') { log('❌ Morgana: Haru cannot be targeted!', 'damage'); return false; }
  if (targetBenchIdx === undefined || targetBenchIdx === null || targetBenchIdx >= state.players[opp].bench.length) {
    log('❌ Morgana: invalid target', 'damage'); return false;
  }
  spendEnergy(state, cost);
  state.activesUsedThisTurn++;
  const target = state.players[opp].bench.splice(targetBenchIdx, 1)[0];
  state.players[opp].discard.push(target);
  if (!state.supportDiedLastTurn) state.supportDiedLastTurn = [false, false];
  state.supportDiedLastTurn[opp] = true;
  // KO penalty applies to opponent
  const penalty = state.activeStage?.id === 'midnight_carnival' ? 0 : 20;
  if (penalty > 0) applyDamageToLeader(state, opp, penalty, log);
  _triggerMementosDepths(state, opp, log);
  // Morgana herself also goes to discard (self-sacrifice)
  const morgana = state.players[p].bench.splice(benchIdx, 1)[0];
  state.players[p].discard.push(morgana);
  log(`Morgana: traded with ${target.name} — both sent to discard`, 'play');
  return true;
}

// Yusuke Kitagawa: copy and activate any friendly supporter's active
// This sets a pending state for UI to select which unit to copy
export function yusukeKitagawaActive(state, p, benchIdx, targetBenchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  const validTargets = state.players[p].bench.filter((u, i) => i !== benchIdx && !hasUsedActiveThisTurn(state, u));
  if (validTargets.length === 0) { log('❌ Yusuke: no valid friendly actives to copy', 'damage'); return false; }
  if (targetBenchIdx === undefined || targetBenchIdx === null || targetBenchIdx === benchIdx) {
    log('❌ Yusuke: invalid target', 'damage'); return false;
  }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  // Copy sets a pending state resolved by the copied unit's active
  const target = state.players[p].bench[targetBenchIdx];
  if (!target) { log('❌ Yusuke: target not found', 'damage'); return false; }
  log(`Yusuke Kitagawa: copying ${target.name}'s active`, 'play');
  state.pendingYusukeTarget = { p, yusukeIdx: benchIdx, targetIdx: targetBenchIdx };
  return true;
}

// Makoto Niijima: deal damage equal to total HP healed this turn
export function makotoNiijimaActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const opp = opponent(p);
  const healed = state.healedThisTurn?.[p] ?? 0;
  log(`Makoto Niijima: deals ${healed} damage (total healed this turn)`, 'damage');
  if (healed > 0) applyDamageToLeader(state, opp, healed, log);
  return true;
}

// Futaba Sakura: draw cards equal to damage dealt to enemy units this turn
export function futabaSakuraActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const dmgDealt = state.dmgToEnemyUnitsThisTurn?.[p] ?? 0;
  const draws = Math.min(dmgDealt, 10); // cap at 10 to prevent infinite draw
  log(`Futaba Sakura: draws ${draws} card(s) (damage dealt to units this turn)`, 'draw');
  if (draws > 0) drawCards(state, p, draws, log);
  return true;
}

// Haru Okumura: prevent all damage to leader until next turn
export function haruOkumuraActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  spendEnergy(state, cost);
  // Haru stays exhausted until end of NEXT turn — mark the unit specially
  const unit = state.players[p].bench[benchIdx];
  if (!unit) return false;
  unit.exhausted = true; // immediately exhausted
  unit.haruShield = true; // will also stay exhausted next turn
  state.usedActivesThisTurn.push(unit.uid);
  state.activesUsedThisTurn++;
  if (!state.haruShield) state.haruShield = [false, false];
  state.haruShield[p] = true;
  log('Haru Okumura: all damage to your leader is prevented until your next turn!', 'play');
  return true;
}

// Sumire Yoshizawa: deal 20 unblockable damage to one opponent bench unit
export function sumireYoshizawaActive(state, p, benchIdx, targetBenchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  const opp = opponent(p);
  if (state.players[opp].bench.length === 0) { log('❌ Sumire: no opponent bench units', 'damage'); return false; }
  const sumTarget = state.players[opp].bench[targetBenchIdx];
  if (sumTarget && sumTarget.id === 'haru_okumura') { log('❌ Sumire: Haru cannot be targeted!', 'damage'); return false; }
  if (targetBenchIdx === undefined || targetBenchIdx >= state.players[opp].bench.length) {
    log('❌ Sumire: invalid target', 'damage'); return false;
  }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const target = state.players[opp].bench[targetBenchIdx];
  target.currentHp -= 20;
  log(`Sumire Yoshizawa: 20 unblockable damage to ${target.name} (${Math.max(0,target.currentHp)}/${target.hp} HP)`, 'damage');
  if (!state.dmgToEnemyUnitsThisTurn) state.dmgToEnemyUnitsThisTurn = [0, 0];
  state.dmgToEnemyUnitsThisTurn[p] += 20;
  if (target.currentHp <= 0) {
    state.players[opp].bench.splice(targetBenchIdx, 1);
    state.players[opp].discard.push(target);
    if (!state.supportDiedLastTurn) state.supportDiedLastTurn = [false, false];
    state.supportDiedLastTurn[opp] = true;
    const penalty = state.activeStage?.id === 'midnight_carnival' ? 0 : 20;
    if (penalty > 0) applyDamageToLeader(state, opp, penalty, log);
    log(`${target.name} KO'd!`, 'damage');
    _triggerMementosDepths(state, opp, log);
  }
  return true;
}

// Helper: trigger Mementos Depths KO discard
function _triggerMementosDepths(state, koPlayerIdx, log) {
  if (state.activeStage?.id !== 'mementos_depths') return;
  if (state.players[koPlayerIdx].hand.length > 0) {
    const idx = Math.floor(Math.random() * state.players[koPlayerIdx].hand.length);
    const card = state.players[koPlayerIdx].hand.splice(idx, 1)[0];
    state.players[koPlayerIdx].discard.push(card);
    log(`Mementos Depths: Player ${koPlayerIdx + 1} discards ${card.name} (unit KO'd)`, 'damage');
  }
}

// Helper: trigger Ann/Sumire passive when opponent discards
function _triggerDiscardPassives(state, activeP, log) {
  const opp = opponent(activeP);
  // Ann Takamaki passive
  const ann = state.players[activeP].bench.find(u => u.id === 'ann_takamaki' && !u.exhausted);
  if (ann) { applyDamageToLeader(state, opp, 10, log); log('Ann Takamaki: 10 damage (opponent discarded)', 'damage'); }
  // Sumire Yoshizawa passive
  const sumire = state.players[activeP].bench.find(u => u.id === 'sumire_yoshizawa' && !u.exhausted);
  if (sumire) { applyDamageToLeader(state, opp, 10, log); log('Sumire Yoshizawa: 10 damage (opponent discarded)', 'damage'); }
}
export { _triggerDiscardPassives };


export function sonicActive(state, handIdx, log) {
  const p      = state.activePlayer;
  const leader = state.players[p].leader;
  if (state.players[p].hand.length === 0) { log(`❌ Sonic: hand is empty`, 'damage'); return false; }
  if (!canAfford(state, leader.activeCost)) { log(`❌ Not enough energy for Sonic's active`, 'damage'); return false; }
  if (state.leaderUsedThisTurn[p]) { log(`❌ Sonic: active already used this turn`, 'damage'); return false; }
  spendEnergy(state, leader.activeCost);
  state.leaderUsedThisTurn[p] = true;
  const discarded = state.players[p].hand.splice(handIdx, 1)[0];
  state.players[p].discard.push(discarded);
  log(`⚡ Sonic discards ${discarded.name} → draws 2`, 'play');
  drawCards(state, p, 2, log);
  return true;
}

export function resolveExtremeGear(state, handIndices, log) {
  const p = state.pendingExtremeGear.playerIdx;
  const sorted = [...handIndices].sort((a, b) => b - a);
  let gained = 0;
  sorted.forEach(idx => {
    const card = state.players[p].hand.splice(idx, 1)[0];
    if (card) {
      state.players[p].discard.push(card);
      gained++;
    }
  });
  const energyGained = gained;
  state.energy[p] += energyGained;
  state.energySpentThisTurn[p] -= energyGained;
  log(`⚙ Extreme Gear: discarded ${gained} card(s), gained ${energyGained} Energy (now ${state.energy[p]})`, 'play');
  state.pendingExtremeGear = null;
}// Shadow active: both Leaders take 10 unblockable, unreducible damage
export function shadowActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const opp = opponent(p);
  log('Shadow: both Leaders take 10 unblockable damage', 'damage');
  state.players[p].leader.currentHp   = Math.max(0, state.players[p].leader.currentHp - 10);
  state.players[opp].leader.currentHp = Math.max(0, state.players[opp].leader.currentHp - 10);
  return true;
}// Mighty active: second leader attack, opponent may block
export function mightyActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log('❌ Not enough energy', 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  log('Mighty: second attack granted — choose a target!', 'play');
  // Signal the client to open the target selection modal.
  // The actual attack resolves when the player picks a target via ATTACK.
  state.pendingMightyAttack = true;
  return true;
}