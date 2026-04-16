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
  return state.masterEmeraldActive ? 0 : unit.activeCost;
}

// ---------------------------------------------------------------------------
// Draw cards (with empty-deck penalty)
// ---------------------------------------------------------------------------
export function drawCards(state, p, count, log) {
  for (let i = 0; i < count; i++) {
    if (state.players[p].deck.length === 0) {
      state.missedDraws[p]++;
      const penalty = state.missedDraws[p];
      log(`⚠ Player ${p + 1} empty deck — takes ${penalty} damage!`, 'damage');
      applyDamageToLeader(state, p, penalty, log);
    } else {
      const card = state.players[p].deck.shift();
      state.players[p].hand.push(card);
      state.missedDraws[p] = 0;
      log(`📄 Player ${p + 1} draws ${card.name}`, 'draw');
    }
  }
}

// ---------------------------------------------------------------------------
// Play a card from hand
// Returns true if consumed, false if it stays in hand.
// ---------------------------------------------------------------------------
export function playCardFromHand(state, handIdx, log) {
  const p    = state.activePlayer;
  const card = state.players[p].hand[handIdx];
  if (!card) return false;

  // Apply Charmy discount to cost
  const baseCost  = card.cost ?? 0;
  const isEquip   = card.type === 'Equipment' || card.type === 'Genesis' || card.type === 'Stage';
  const charmyDiscount = (isEquip && state.equipmentPlayedThisTurn[p] > 0)
    ? (state.players[p].bench.some(u => u.id === 'charmy' && !u.exhausted) ? 1 : 0)
    : 0;
  const cost = Math.max(0, baseCost - charmyDiscount);

  if (!canAfford(state, cost)) {
    log(`❌ Not enough energy to play ${card.name}`, 'damage');
    return false;
  }

  // Pre-play validation (card stays in hand on failure)
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
      break;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Play a card from discard (Tails / Blaze — energy cost already paid)
// ---------------------------------------------------------------------------
export function playCardFromDiscard(state, p, card, log) {
  log(`♻ Player ${p + 1} plays ${card.name} from discard`, 'play');

  // Ray passive: draw 1 when a card is played from discard
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

// ---------------------------------------------------------------------------
// Deploy a unit to the bench
// ---------------------------------------------------------------------------
function deployUnit(state, p, card, log) {
  if (state.players[p].bench.length >= 3) {
    log(`❌ Bench full — ${card.name} sent to discard`, 'damage');
    state.players[p].discard.push(card);
    return;
  }
  state.players[p].bench.push({ ...card, currentHp: card.hp, exhausted: false });
  log(`📌 ${card.name} deployed to bench`, 'play');
}

// ---------------------------------------------------------------------------
// Activate a Stage card
// ---------------------------------------------------------------------------
function activateStage(state, p, card, log) {
  if (state.activeStage) {
    state.players[p].discard.push(state.activeStage);
    log(`🔄 ${state.activeStage.name} replaced by ${card.name}`, 'phase');
  }
  state.activeStage = { ...card };
  log(`🏔 Stage: ${card.name} is now active`, 'play');
}

// ---------------------------------------------------------------------------
// Equipment / Genesis effects
// ---------------------------------------------------------------------------
export function applyEquipmentEffect(state, p, card, log) {
  const opp = opponent(p);
  switch (card.id) {

    case 'ring':
      state.energy[p] += 1;
      log(`💍 Ring: +1 Energy (now ${state.energy[p]})`, 'play');
      break;

    case 'chaos_emerald':
      state.chaosEmeraldBuff[p] += 2;
      log(`💎 Chaos Emerald: Leader +2 Damage this turn`, 'play');
      break;

    case 'master_emerald':
      state.masterEmeraldActive = true;
      log(`💚 Master Emerald: All bench actives free this turn!`, 'play');
      break;

    case 'elemental_shield':
      state.shieldActive[p] = true;
      log(`🛡 Elemental Shield: Player ${p + 1} shielded next opponent turn`, 'play');
      break;

    case 'heat_barrier': {
      const leader = state.players[p].leader;
      const healed = Math.min(2, leader.hp - leader.currentHp);
      leader.currentHp += healed;
      log(`🔥 Heat Barrier: Leader healed ${healed} HP (${leader.currentHp}/${leader.hp})`, 'heal');
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
      state.powerGloveBuff[p] += 3;
      log(`🥊 Power Glove: Leader +3 Damage this turn`, 'play');
      break;

    case 'polaris_pact':
      _refillToSix(state, 0, log);
      _refillToSix(state, 1, log);
      log(`🌌 Polaris Pact: Both players refilled to 6. Opponent discards 1.`, 'play');
      state.pendingPolarisPact = { opponentIdx: opp };
      break;

    // ── Rings archetype ───────────────────────────────────────────────────

    case 'speed_shoes':
      state.energy[p] += 3;
      log(`👟 Speed Shoes: +3 Energy (now ${state.energy[p]})`, 'play');
      break;

    case 'extreme_gear':
      // Async: player chooses which hand cards to discard for energy
      if (state.players[p].hand.length === 0) {
        log(`⚙ Extreme Gear: hand is empty — no effect`, 'phase');
        break;
      }
      state.pendingExtremeGear = { playerIdx: p };
      log(`⚙ Extreme Gear: Choose cards to discard for energy`, 'play');
      break;

    case 'super_form':
      state.energy[p] *= 2;
      log(`✨ Super Form: Energy doubled to ${state.energy[p]}!`, 'play');
      break;

    // Stages (midnight_carnival, radical_highway, green_hill_zone) handled
    // by activateStage path + phase/combat checks via state.activeStage.id
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
// Exhaust a unit
// Silver passive: if Silver is on bench and not exhausted, he exhausts instead
// of the target (only when a *different* unit would exhaust).
// ---------------------------------------------------------------------------
export function exhaustUnit(state, p, benchIdx) {
  if (state.masterEmeraldActive) return;
  const unit = state.players[p].bench[benchIdx];
  if (!unit) return;

  const silverIdx = state.players[p].bench.findIndex(u => u.id === 'silver' && !u.exhausted);
  if (silverIdx !== -1 && silverIdx !== benchIdx) {
    state.players[p].bench[silverIdx].exhausted = true;
    log_noop(); // caller logs context
    return;
  }
  unit.exhausted = true;
}
function log_noop() {} // exhaustUnit can't receive log; Silver exhaust logged by callers

// ---------------------------------------------------------------------------
// Rouge passive — call after any hand/deck→own-discard event
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
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  if (state.players[p].discard.length === 0) { log(`♻ Tails: Discard is empty`, 'phase'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const card = state.players[p].discard.splice(discardIdx, 1)[0];
  log(`♻ Tails: plays ${card.name} from discard`, 'play');
  playCardFromDiscard(state, p, card, log);
  return true;
}

export function knucklesActive(state, p, benchIdx, targetUnitIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  const opp  = opponent(p);
  const unit = state.players[opp].bench[targetUnitIdx];
  if (!unit) return false;
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  unit.currentHp -= 1;
  log(`👊 Knuckles: 1 damage to ${unit.name} (${unit.currentHp}/${unit.hp})`, 'damage');
  if (unit.currentHp <= 0) {
    state.players[opp].bench.splice(targetUnitIdx, 1);
    state.players[opp].discard.push(unit);
    const pen = state.activeStage?.id === 'midnight_carnival' ? 0 : 2;
    if (pen > 0) { log(`💀 ${unit.name} KO'd! +${pen} damage to P${opp + 1}`, 'damage'); applyDamageToLeader(state, opp, pen, log); }
    else          { log(`💀 ${unit.name} KO'd! (Midnight Carnival: no penalty)`, 'damage'); }
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
  log(`🌸 Amy: 1 damage to Player ${opp + 1}'s Leader`, 'damage');
  applyDamageToLeader(state, opp, 1, log);
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
    l.currentHp = Math.min(l.currentHp + 1, l.hp);
    log(`💚 Cream heals Leader to ${l.currentHp}/${l.hp}`, 'heal');
  } else {
    const u = state.players[p].bench[targetBenchIdx];
    u.currentHp = Math.min(u.currentHp + 1, u.hp);
    log(`💚 Cream heals ${u.name} to ${u.currentHp}/${u.hp}`, 'heal');
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
    state.players[opp].discard.push(card);
    log(`🐟 Big: Discards ${card.name} from opponent's hand`, 'damage');
  }
  return true;
}

// Silver active: deal 1 damage per active used this turn (including this one)
export function silverActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  spendEnergy(state, cost);
  // Silver always exhausts himself (by design — not redirected by his own passive)
  state.players[p].bench[benchIdx].exhausted = true;
  state.activesUsedThisTurn++;
  const dmg = state.activesUsedThisTurn;
  const opp = opponent(p);
  log(`⚡ Silver: ${dmg} damage to Player ${opp + 1}'s Leader (${dmg} actives used)`, 'damage');
  applyDamageToLeader(state, opp, dmg, log);
  return true;
}

// Shadow active: 3 damage to opponent; 2 unblockable self-damage
export function shadowActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const opp = opponent(p);
  log(`🌑 Shadow: 3 damage to Player ${opp + 1}'s Leader`, 'damage');
  applyDamageToLeader(state, opp, 3, log);
  log(`🌑 Shadow: Player ${p + 1}'s Leader takes 2 unblockable damage`, 'damage');
  // Unblockable = bypasses shield AND reduction
  state.players[p].leader.currentHp -= 2;
  if (state.players[p].leader.currentHp < 0) state.players[p].leader.currentHp = 0;
  return true;
}

// Mighty active: trigger a second Leader attack (target selection via UI)
export function mightyActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  spendEnergy(state, cost);
  // Mighty exhausts — his passive is now gone for this attack
  state.players[p].bench[benchIdx].exhausted = true;
  state.activesUsedThisTurn++;
  state.pendingMightyAttack = true;
  log(`🦔 Mighty: second attack — choose a target`, 'play');
  return true;
}

// Rouge active: top-deck → discard; Rouge does NOT exhaust but can only fire once per turn
export function rougeActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  if (state.players[p].deck.length === 0) { log(`🦇 Rouge: Deck is empty`, 'phase'); return false; }
  if (state.rougeUsedThisTurn[p]) { log(`🦇 Rouge: already used this turn`, 'phase'); return false; }
  spendEnergy(state, cost);
  // Rouge does NOT exhaust — but flag as used so she can't fire again this turn
  state.rougeUsedThisTurn[p] = true;
  state.activesUsedThisTurn++;
  const card = state.players[p].deck.shift();
  state.players[p].discard.push(card);
  log(`🦇 Rouge: mills ${card.name} to discard`, 'play');
  triggerRougePassive(state, p, log); // her own mill triggers her own passive
  return true;
}

// Blaze active: shuffle entire discard into deck, draw 2
export function blazeActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  const count = state.players[p].discard.length;
  // Shuffle discard back into deck
  while (state.players[p].discard.length > 0) {
    const card = state.players[p].discard.pop();
    state.players[p].deck.push(card);
  }
  // Fisher-Yates shuffle
  const deck = state.players[p].deck;
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  log(`🔥 Blaze: shuffled ${count} cards back into deck, draws 2`, 'play');
  drawCards(state, p, 2, log);
  return true;
}

// Ray active: look at top 3, place 1 into discard, return rest in any order (async)
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

// Charmy active: draw 1 per equipment played this turn
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

// Espio active: shuffle up to 3 equipment from discard into deck, draw 1
export function espioActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  // Collect equipment from discard (up to 3)
  const equipCards = state.players[p].discard.filter(
    c => c.type === 'Equipment' || c.type === 'Genesis' || c.type === 'Stage'
  );
  const toReturn = equipCards.slice(0, 3);
  toReturn.forEach(card => {
    const idx = state.players[p].discard.indexOf(card);
    state.players[p].discard.splice(idx, 1);
    state.players[p].deck.push(card);
  });
  // Shuffle deck
  const deck = state.players[p].deck;
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  log(`🦎 Espio: returned ${toReturn.length} equipment to deck, draws 1`, 'play');
  drawCards(state, p, 1, log);
  return true;
}

// Vector active: deal damage equal to total energy spent this turn
export function vectorActive(state, p, benchIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  spendEnergy(state, cost); // this spend is counted before we read the total
  state.activesUsedThisTurn++;
  const dmg = state.energySpentThisTurn[p]; // includes the cost just spent
  const opp = opponent(p);
  exhaustUnit(state, p, benchIdx);
  log(`🐊 Vector: deals ${dmg} damage (total energy spent this turn)`, 'damage');
  applyDamageToLeader(state, opp, dmg, log);
  return true;
}

// Omega active: persistently exhaust one opponent bench unit until start of next turn
export function omegaActive(state, p, benchIdx, targetUnitIdx, log) {
  const cost = getActiveCost(state, state.players[p].bench[benchIdx]);
  if (!canAfford(state, cost)) { log(`❌ Not enough energy`, 'damage'); return false; }
  const opp  = opponent(p);
  const unit = state.players[opp].bench[targetUnitIdx];
  if (!unit) return false;
  spendEnergy(state, cost);
  exhaustUnit(state, p, benchIdx);
  state.activesUsedThisTurn++;
  unit.exhausted = true;
  // Lock expires at the START of the Omega-player's next turn
  // (turn increments when firstPlayer's turn wraps — use turn+1 as the unlock turn)
  state.persistentExhaust[opp][unit.uid] = state.turn + 1;
  log(`🤖 Omega: ${unit.name} is locked exhausted until Player ${p + 1}'s next turn`, 'damage');
  return true;
}

// Leader active: Sonic — discard 1 card → draw 2
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

// Extreme Gear resolution: discard chosen hand cards for energy
export function resolveExtremeGear(state, handIndices, log) {
  const p = state.pendingExtremeGear.playerIdx;
  // Sort descending so splicing doesn't shift indices
  const sorted = [...handIndices].sort((a, b) => b - a);
  let gained = 0;
  sorted.forEach(idx => {
    const card = state.players[p].hand.splice(idx, 1)[0];
    if (card) {
      state.players[p].discard.push(card);
      gained++;
    }
  });
  state.energy[p] += gained;
  state.energySpentThisTurn[p] -= gained; // energy gained, not spent
  log(`⚙ Extreme Gear: discarded ${gained} card(s), gained ${gained} Energy (now ${state.energy[p]})`, 'play');
  state.pendingExtremeGear = null;
}
