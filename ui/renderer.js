/**
 * RENDERER
 * All DOM reads and writes. Never mutates gameState.
 *
 * Improvements applied:
 *  #13 — damage-flash / heal-flash CSS animations on leaders and bench units
 *  #14 — floating damage numbers (showFloatingNumber)
 *  #15 — attack-target pulse (CSS in styles.css; class applied here)
 *  #16 — HP bar colour changes dynamically (green → amber → red)
 *  #17 — playable card float animation (CSS in styles.css; class applied here)
 *  #19 — game log colour-coded left-border, KO entries bolded, mini-log strip
 *  #20 — hand card counts shown in info row for both players
 *  #24 — action button label adapts to phase (Attack Phase → / End Turn →)
 *  #26 — scry modal renders actual card element
 */

import { calcEffectiveDamage } from '../engine/combat.js';
import { canAfford, getActiveCost, hasUsedActiveThisTurn } from '../engine/actions.js';
import { opponent } from '../engine/state.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const UNIT_EMOJI = {
  tails: '🦊', knuckles: '👊', amy: '🌸', cream: '🐰', big: '🐟',
  silver: '⚡', shadow: '🌑', mighty: '🦔', rouge: '🦇', blaze: '🔥', ray: '🐿',
  charmy: '🐝', espio: '🦎', vector: '🐊', omega: '🤖',
};

const EQUIP_EMOJI = {
  ring: '💍', chaos_emerald: '💎', master_emerald: '💚',
  green_hill_zone: '🌿', elemental_shield: '🛡',
  chili_dog: '🔥', dragons_eye: '👁', power_glove: '🥊',
  midnight_carnival: '🎪', polaris_pact: '🌌',
  speed_shoes: '👟', extreme_gear: '⚙', radical_highway: '🛣', super_form: '✨',
};

function cardEmoji(card) {
  if (card.type === 'Unit' || card.type === 'Leader') return UNIT_EMOJI[card.id] ?? '⭐';
  return EQUIP_EMOJI[card.id] ?? '🃏';
}

function passiveIcon(unit) {
  const t = unit.passive?.type;
  if (t === 'attack_boost')     return `+${unit.passive.amount}⚔`;
  if (t === 'damage_reduction') return `-${unit.passive.amount}🛡`;
  if (t === 'draw_end')         return '📄end';
  if (t === 'big_scry')         return '👁top';
  return '';
}

const PHASE_LABELS = {
  setup:    'SETUP PHASE',
  big_scry: 'BIG SCRY',
  draw:     'DRAW',
  energy:   'ENERGY',
  main:     'MAIN PHASE',
  attack:   'ATTACK',
  end:      'END PHASE',
};

// ---------------------------------------------------------------------------
// #19 — Mini-log: last N entries shown on the board
// ---------------------------------------------------------------------------
const _miniLogEntries = [];
let _miniLogTimer = null;

function pushMiniLog(msg, type) {
  _miniLogEntries.push({ msg, type });
  if (_miniLogEntries.length > 3) _miniLogEntries.shift();
  renderMiniLog();
  clearTimeout(_miniLogTimer);
  _miniLogTimer = setTimeout(() => {
    const el = document.getElementById('mini-log');
    if (el) el.style.opacity = '0';
  }, 4000);
}

function renderMiniLog() {
  const el = document.getElementById('mini-log');
  if (!el) return;
  el.style.opacity = '1';
  el.innerHTML = _miniLogEntries.map(e =>
    `<div class="mini-log-entry ${e.type}">${e.msg}</div>`
  ).join('');
}

// ---------------------------------------------------------------------------
// #14 — Floating damage/heal numbers
// ---------------------------------------------------------------------------
export function showFloatingNumber(targetEl, amount, type = 'damage') {
  if (!targetEl) return;
  const el = document.createElement('div');
  el.className = 'floating-number ' + type;
  el.textContent = type === 'heal' ? `+${amount}` : `-${amount}`;
  // Position relative to the target element
  const rect = targetEl.getBoundingClientRect();
  el.style.cssText = `
    position: fixed;
    left: ${rect.left + rect.width / 2}px;
    top: ${rect.top + rect.height / 3}px;
    pointer-events: none;
    z-index: 9999;
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 900;
    color: ${type === 'heal' ? 'var(--green)' : 'var(--red)'};
    text-shadow: 0 2px 8px #000, 0 0 16px ${type === 'heal' ? '#00cc44' : '#ff2244'};
    animation: float-number 0.8s ease-out forwards;
    transform: translateX(-50%);
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 820);
}

// #13 — Damage flash on an element
export function flashDamage(el) {
  if (!el) return;
  el.classList.remove('damage-flash', 'heal-flash');
  void el.offsetWidth; // force reflow to restart animation
  el.classList.add('damage-flash');
  setTimeout(() => el.classList.remove('damage-flash'), 420);
}

export function flashHeal(el) {
  if (!el) return;
  el.classList.remove('damage-flash', 'heal-flash');
  void el.offsetWidth;
  el.classList.add('heal-flash');
  setTimeout(() => el.classList.remove('heal-flash'), 420);
}

// Track HP between renders so we know whether to flash/float
const _prevLeaderHp  = [null, null];
const _prevBenchHp   = [[], []];
// #28 — track bench UIDs to detect KO'd units between renders
const _prevBenchUids = [[], []];

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------
export function render(state) {
  renderHUD(state);
  renderLeader('p1-leader-zone', state, 0);
  renderLeader('p2-leader-zone', state, 1);
  renderBench('p1-bench', state, 0);
  renderBench('p2-bench', state, 1);

  if (state.phase === 'setup') {
    if (state._setupPlayer !== undefined) {
      const sp = state._setupPlayer;
      renderHand('p1-hand', state, 0, sp);
      renderHand('p2-hand', state, 1, sp);
    }
  } else {
    renderHand('p1-hand', state, 0, state.activePlayer);
    renderHand('p2-hand', state, 1, state.activePlayer);
  }

  renderInfoRow('p1-info', state, 0);
  renderInfoRow('p2-info', state, 1);
  renderPlayerLabels(state);
  renderActionButtons(state);
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
export function renderHUD(state) {
  const p = state.activePlayer;

  setText('phase-display', PHASE_LABELS[state.phase] ?? state.phase);
  setText('turn-num', `Turn ${state.turn}`);

  const pipsEl = q('energy-pips');
  pipsEl.innerHTML = '';
  const maxPips = state.energyMax[p];
  if (maxPips <= 15) {
    for (let i = 0; i < maxPips; i++) {
      const pip = mk('div', 'pip' + (i < state.energy[p] ? ' filled' : ''));
      pipsEl.appendChild(pip);
    }
  }
  setText('energy-text', `${state.energy[p]}/${state.energyMax[p]}`);

  if (typeof window.updateMobileStrip === 'function') {
    window.updateMobileStrip(PHASE_LABELS[state.phase] ?? state.phase, state.energy[p]);
  }

  const stageEl = q('stage-zone');
  if (state.activeStage) {
    stageEl.className = 'stage-zone active';
    stageEl.textContent = state.activeStage.name;
    stageEl.style.cursor = 'pointer';
    stageEl.title = 'Click for details';
    stageEl.onclick = () => openCardInspect(state.activeStage, null);
  } else {
    stageEl.className = 'stage-zone';
    stageEl.textContent = 'No Stage';
    stageEl.style.cursor = 'default';
    stageEl.onclick = null;
  }

  setText('deck-count',    state.players[p].deck.length);
  setText('discard-count', state.players[p].discard.length);
  const discardEl = q('discard-count');
  if (discardEl) {
    discardEl.style.cursor = 'pointer';
    discardEl.title = 'Click to view discard pile';
    discardEl.onclick = () => openDiscardViewer(state, p);
  }
}

export function renderPlayerLabels(state) {
  const p = (state.phase === 'setup' && state._setupPlayer !== undefined)
    ? state._setupPlayer
    : state.activePlayer;
  q('p1-label').className = 'player-label' + (p === 0 ? ' active' : '');
  q('p2-label').className = 'player-label' + (p === 1 ? ' active' : '');
}

// #20 — Hand count shown for both players
export function renderInfoRow(containerId, state, p) {
  const el = q(containerId);
  const flags = [
    state.shieldActive[p]
      ? '<span title="Shielded">🛡</span>' : '',
    state.masterEmeraldActive && p === state.activePlayer
      ? '<span style="color:#e088dd;font-size:8px;" title="Master Emerald">ME★</span>' : '',
    state.chaosEmeraldBuff[p] > 0
      ? `<span style="color:var(--gold);font-size:8px;" title="Chaos Emerald">+${state.chaosEmeraldBuff[p]}⚔</span>` : '',
    state.powerGloveBuff[p] > 0
      ? `<span style="color:var(--red);font-size:8px;" title="Power Glove">+${state.powerGloveBuff[p]}⚔</span>` : '',
    (state.rougeUsedThisTurn ?? [false, false])[p]
      ? '<span style="color:#6677aa;font-size:8px;" title="Rouge used">🦇✓</span>' : '',
  ].filter(Boolean).join(' ');

  const handCount = Array.isArray(state.players[p].hand) ? state.players[p].hand.length : 0;

  el.innerHTML = `
    <span class="deck-count" style="font-size:9px;padding:2px 5px;">${state.players[p].deck.length}📚</span>
    <span class="discard-count info-discard" style="font-size:9px;padding:2px 5px;cursor:pointer;" title="Click to view discard pile">${state.players[p].discard.length}🗑</span>
    <span class="hand-count-badge" title="Cards in hand">🤚${handCount}</span>
    ${flags}
  `;

  const discardBtn = el.querySelector('.info-discard');
  if (discardBtn) discardBtn.onclick = () => openDiscardViewer(state, p);
}

// ---------------------------------------------------------------------------
// Leader card — #16 HP bar colour + #13 flash + #14 float numbers
// ---------------------------------------------------------------------------
export function renderLeader(containerId, state, p) {
  const el     = q(containerId);
  const leader = state.players[p].leader;
  const ap     = state.activePlayer;
  const hpPct  = Math.max(0, (leader.currentHp / leader.hp) * 100);
  const effDmg = calcEffectiveDamage(state, p);

  // #16 — HP bar colour
  const hpColour = hpPct > 60 ? '#22cc66'
                 : hpPct > 30 ? '#ffaa00'
                               : '#ff3333';

  const isTarget = state.phase === 'attack' && p !== ap;
  const canUse   = state.phase === 'main' && p === ap
    && canAfford(state, leader.activeCost)
    && state.players[p].hand.length > 0
    && !(state.leaderUsedThisTurn ?? [false, false])[p];

  const classes = [
    'leader-card',
    isTarget              ? 'attack-target' : '',
    state.shieldActive[p] ? 'shielded'      : '',
    canUse                ? 'active-avail'  : '',
    // #16 — low-HP glow
    hpPct <= 30           ? 'low-hp'        : '',
  ].filter(Boolean).join(' ');

  const div = mk('div', classes);

  const leaderEmoji = { sonic: '🦔', joker: '🃏', kiryu: '🐉' }[leader.id] ?? '👑';
  const isBuffed = effDmg > leader.damage;
  div.innerHTML = `
    <div class="leader-emoji">${leaderEmoji}</div>
    <div class="leader-info">
      <div class="leader-name">${leader.name ?? leader.id?.toUpperCase() ?? 'LEADER'}</div>
      <div class="leader-hp-bar"><div class="leader-hp-fill" style="width:${hpPct}%;background:${hpColour}"></div></div>
      <div class="leader-stats">
        <span class="leader-hp-text" style="color:${hpColour}">${leader.currentHp}/${leader.hp}</span>
        <span class="leader-dmg-chip${isBuffed ? ' buffed' : ''}" title="Click for damage breakdown">⚔${effDmg}</span>
      </div>
    </div>
  `;

  addTooltip(div, leader.name,
    `HP: ${leader.currentHp}/${leader.hp} · Damage: ${effDmg}\nActive (${leader.activeCost}⚡): ${leader.activeDesc}`);
  addContextMenu(div, leader);

  el.innerHTML = '';
  el.appendChild(div);

  // #18 — damage chip click shows a breakdown popup
  const chip = div.querySelector('.leader-dmg-chip');
  if (chip) {
    chip.style.cursor = 'pointer';
    chip.onclick = (e) => {
      e.stopPropagation();
      _showDamageBreakdown(div, state, p);
    };
  }

  // #13 / #14 — Flash and float if HP changed since last render
  const prevHp = _prevLeaderHp[p];
  if (prevHp !== null && prevHp !== leader.currentHp) {
    const diff = prevHp - leader.currentHp;
    if (diff > 0) {
      flashDamage(div);
      showFloatingNumber(div, diff, 'damage');
    } else if (diff < 0) {
      flashHeal(div);
      showFloatingNumber(div, Math.abs(diff), 'heal');
    }
  }
  _prevLeaderHp[p] = leader.currentHp;

  return div;
}

// #18 — Damage breakdown popup when clicking the ⚔ chip
function _showDamageBreakdown(anchorEl, state, p) {
  document.querySelectorAll('.dmg-breakdown-popup').forEach(e => e.remove());
  const popup = document.createElement('div');
  popup.className = 'dmg-breakdown-popup';
  const leader = state.players[p].leader;
  const lines = [`Base: ${leader.damage}`];
  // Shadow doubling
  let base = leader.damage;
  for (const u of state.players[p].bench) {
    if (u.id === 'shadow' && !u.exhausted && u.passive?.type === 'shadow_boost') {
      lines.push(`Shadow ×2: ${base} → ${base * 2}`);
      base *= 2;
    }
  }
  // Attack boosts
  for (const u of state.players[p].bench) {
    if (!u.exhausted && u.passive?.type === 'attack_boost')
      lines.push(`${u.name}: +${u.passive.amount}`);
  }
  if ((state.chaosEmeraldBuff?.[p] ?? 0) > 0)
    lines.push(`Chaos Emerald: +${state.chaosEmeraldBuff[p]}`);
  if ((state.powerGloveBuff?.[p] ?? 0) > 0)
    lines.push(`Power Glove: +${state.powerGloveBuff[p]}`);
  const effDmg = calcEffectiveDamage(state, p);
  lines.push(`─────`);
  lines.push(`Total: ${effDmg}`);
  popup.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
  document.body.appendChild(popup);
  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = `${rect.left}px`;
  popup.style.top  = `${rect.bottom + 4}px`;
  // Auto-dismiss on next click anywhere
  const dismiss = () => { popup.remove(); document.removeEventListener('click', dismiss); };
  setTimeout(() => document.addEventListener('click', dismiss), 10);
}

// ---------------------------------------------------------------------------
// Bench — #13 flash + #14 float on units, #28 KO animation
// ---------------------------------------------------------------------------
export function renderBench(containerId, state, p) {
  const el        = q(containerId);
  const ap        = state.activePlayer;
  const isActiveP = p === ap;
  const isAttack  = state.phase === 'attack';
  const unitDivs  = [];

  // #28 — detect KO'd units (were in prev render, absent now) and animate them out
  const currentUids = new Set(state.players[p].bench.map(u => u.uid));
  const prevUids    = _prevBenchUids[p];
  const koUids      = prevUids.filter(uid => !currentUids.has(uid));

  // Flash existing DOM slots for KO'd units before wiping innerHTML
  if (koUids.length > 0) {
    const existingSlots = el.querySelectorAll('.bench-unit');
    existingSlots.forEach(slot => {
      const uid = slot.dataset.uid;
      if (uid && koUids.includes(uid)) {
        slot.classList.add('bench-ko');
      }
    });
    // Let the CSS animation play (300ms), then proceed with normal re-render
    // We don't actually delay — the animation plays on the OLD DOM while we
    // rebuild immediately below. The browser composites both simultaneously.
  }

  el.innerHTML = '';

  state.players[p].bench.forEach((unit, idx) => {
    const hpPct       = Math.max(0, (unit.currentHp / unit.hp) * 100);
    const hpColour    = hpPct > 60 ? '#22cc66' : hpPct > 30 ? '#ffaa00' : '#ff3333';
    const cost        = getActiveCost(state, unit);
    const canActivate = state.phase === 'main' && isActiveP && !unit.exhausted
      && canAfford(state, cost)
      && !(unit.id === 'rouge' && (state.rougeUsedThisTurn ?? [false, false])[p])
      && !hasUsedActiveThisTurn(state, unit);
    const isTarget = isAttack && !isActiveP;
    const icon     = passiveIcon(unit);

    const div = mk('div', [
      'bench-unit', 'card-type-unit',
      unit.exhausted ? 'exhausted'     : '',
      canActivate    ? 'can-activate'  : '',
      isTarget       ? 'attack-target' : '',
    ].filter(Boolean).join(' '));

    // #28 — tag each slot with its uid for KO detection next render
    div.dataset.uid = unit.uid;

    div.innerHTML = `
      <div class="bench-name">${unit.name}</div>
      <div class="bench-emoji">${UNIT_EMOJI[unit.id] ?? '⭐'}</div>
      <div class="bench-hp">${unit.currentHp}/${unit.hp}HP</div>
      ${icon && !unit.exhausted ? `<div class="bench-passive">${icon}</div>` : ''}
      <div class="unit-hp-bar"><div class="unit-hp-fill" style="width:${hpPct}%;background:${hpColour}"></div></div>
    `;

    addTooltip(div, unit.name,
      `HP: ${unit.currentHp}/${unit.hp}\nPassive: ${unit.passiveDesc}\nActive (${cost}⚡): ${unit.activeDesc}`);

    el.appendChild(div);
    unitDivs.push({ div, idx });

    // #13 / #14 — flash bench unit if HP changed
    const prevArr = _prevBenchHp[p];
    const prevHp  = prevArr[idx] ?? null;
    if (prevHp !== null && prevHp !== unit.currentHp) {
      const diff = prevHp - unit.currentHp;
      if (diff > 0) {
        flashDamage(div);
        showFloatingNumber(div, diff, 'damage');
      } else if (diff < 0) {
        flashHeal(div);
        showFloatingNumber(div, Math.abs(diff), 'heal');
      }
    }
    prevArr[idx] = unit.currentHp;
  });

  // Update UID tracking
  _prevBenchUids[p] = state.players[p].bench.map(u => u.uid);
  _prevBenchHp[p]   = state.players[p].bench.map(u => u.currentHp);

  for (let i = state.players[p].bench.length; i < 3; i++) {
    const slot = mk('div', 'bench-slot');
    slot.textContent = 'empty';
    el.appendChild(slot);
  }

  return unitDivs;
}

// ---------------------------------------------------------------------------
// Hand
// ---------------------------------------------------------------------------
export function renderHand(containerId, state, p, ownerP = null) {
  const el    = q(containerId);
  el.innerHTML = '';

  const activeOwner = ownerP === null ? state.activePlayer : ownerP;
  const isOwner     = ownerP !== -1 && p === activeOwner;
  const cardEls     = [];

  if (!isOwner) {
    const count = Array.isArray(state.players[p].hand) ? state.players[p].hand.length : 0;
    for (let i = 0; i < count; i++) el.appendChild(mk('div', 'card face-down'));
    return cardEls;
  }

  state.players[p].hand.forEach((card, idx) => {
    if (!card || card.hidden) {
      el.appendChild(mk('div', 'card face-down'));
      return;
    }
    const cost     = card.cost ?? 0;
    const playable = state.phase === 'main' && canAfford(state, cost);
    const div      = buildCardEl(card, playable);
    addTooltip(div, card.name, cardTooltip(card));
    el.appendChild(div);
    cardEls.push({ div, idx, card });
  });

  return cardEls;
}

// ---------------------------------------------------------------------------
// Card element builder
// ---------------------------------------------------------------------------
export function buildCardEl(card, playable = false) {
  if (!card || card.hidden) {
    return mk('div', 'card face-down');
  }

  const typeKey = {
    Unit: 'unit', Stage: 'stage',
    Equipment: 'equipment', Genesis: 'genesis', Leader: 'leader',
  }[card.type] ?? 'equipment';

  const typeClass = {
    Unit: 'type-unit', Stage: 'type-stage',
    Equipment: 'type-equipment', Genesis: 'type-genesis', Leader: 'type-leader',
  }[card.type] ?? 'type-equipment';

  const div  = mk('div', ['card', `card-type-${typeKey}`, playable ? 'playable' : ''].filter(Boolean).join(' '));
  const cost = card.cost ?? 0;

  div.innerHTML = `
    <div class="card-type-strip"></div>
    <div class="card-type-badge ${typeClass}">${card.type.toUpperCase()}</div>
    ${cost > 0 && card.type !== 'Unit' ? `<div class="card-cost">${cost}</div>` : ''}
    <div class="card-emoji">${cardEmoji(card)}</div>
    <div class="card-name">${card.name}</div>
    ${card.hp !== undefined ? `<div class="card-hp-small">HP ${card.hp}</div>` : ''}
    ${card.passiveDesc ? `<div class="card-effect-text">${card.passiveDesc}</div>` : ''}
    ${card.activeDesc  ? `<div class="card-active-text">⚡${card.activeCost}: ${card.activeDesc}</div>` : ''}
    ${card.effectDesc  ? `<div class="card-effect-text">${card.effectDesc}</div>` : ''}
  `;
  return div;
}

// ---------------------------------------------------------------------------
// Card Inspect Modal (right-click)
// ---------------------------------------------------------------------------
function buildInspectModal(card, onActivate = null) {
  if (!card || card.hidden) return document.createElement('div');

  const typeKey = {
    Unit: 'unit', Stage: 'stage',
    Equipment: 'equipment', Genesis: 'genesis', Leader: 'leader',
  }[card.type] ?? 'equipment';

  const modal = document.createElement('div');
  modal.className = 'card-inspect-modal';

  const cost = card.cost ?? 0;
  const hdr  = document.createElement('div');
  hdr.className = `cim-header type-${typeKey}`;
  hdr.innerHTML = `
    <div class="cim-art">${cardEmoji(card)}</div>
    <div class="cim-name">${card.name}</div>
    <div class="cim-type-row">
      <div class="cim-type-pill type-${typeKey}">${card.type.toUpperCase()}</div>
      ${cost > 0 ? `<div class="cim-cost-pill">${cost}⚡</div>` : ''}
    </div>
  `;
  modal.appendChild(hdr);

  const hasStats = card.hp !== undefined || card.damage !== undefined || card.activeCost !== undefined;
  if (hasStats) {
    const stats = document.createElement('div');
    stats.className = 'cim-stats';
    const parts = [];
    if (card.hp !== undefined) parts.push(
      `<div class="cim-stat"><div class="cim-stat-label">HP</div><div class="cim-stat-value hp">${card.hp}</div></div>`
    );
    if (card.damage !== undefined) parts.push(
      `<div class="cim-divider"></div>
       <div class="cim-stat"><div class="cim-stat-label">Damage</div><div class="cim-stat-value dmg">${card.damage}</div></div>`
    );
    if (card.activeCost !== undefined && card.type !== 'Leader') parts.push(
      `<div class="cim-divider"></div>
       <div class="cim-stat"><div class="cim-stat-label">Active Cost</div><div class="cim-stat-value cost">${card.activeCost}⚡</div></div>`
    );
    if (card.currentHp !== undefined) parts.push(
      `<div class="cim-divider"></div>
       <div class="cim-stat"><div class="cim-stat-label">Current HP</div><div class="cim-stat-value hp">${card.currentHp}</div></div>`
    );
    stats.innerHTML = parts.join('');
    modal.appendChild(stats);
  }

  const body = document.createElement('div');
  body.className = 'cim-body';

  if (card.passiveDesc && card.passiveDesc !== 'No passive.') {
    body.innerHTML += `
      <div>
        <div class="cim-section-label">Passive Ability</div>
        <div class="cim-passive-box">
          <div class="cim-passive-text">${card.passiveDesc}</div>
        </div>
      </div>`;
  }

  if (card.activeDesc) {
    const activeSection = document.createElement('div');
    activeSection.innerHTML = `
      <div class="cim-section-label">Active Ability</div>
      <div class="cim-active-box">
        <div class="cim-active-cost">${card.activeCost ?? 0}⚡ COST</div>
        <div class="cim-active-text">${card.activeDesc}</div>
      </div>`;
    if (onActivate) {
      const useBtn = document.createElement('button');
      useBtn.style.cssText = `margin-top:8px;width:100%;padding:9px;background:var(--gold);color:#000;border:none;border-radius:6px;font-family:var(--font-display);font-size:10px;font-weight:900;letter-spacing:1px;cursor:pointer;transition:opacity 0.15s;`;
      useBtn.textContent = '⚡ USE ACTIVE';
      useBtn.onmouseenter = () => useBtn.style.opacity = '0.8';
      useBtn.onmouseleave = () => useBtn.style.opacity = '1';
      useBtn.onclick = () => { closeOverlay('card-inspect-overlay'); onActivate(); };
      activeSection.appendChild(useBtn);
    }
    body.appendChild(activeSection);
  } else if (card.effectDesc) {
    const effectSection = document.createElement('div');
    effectSection.innerHTML = `
      <div class="cim-section-label">Effect</div>
      <div class="cim-effect-box">
        <div class="cim-effect-text">${card.effectDesc}</div>
      </div>`;
    if (onActivate) {
      const playBtn = document.createElement('button');
      playBtn.style.cssText = `margin-top:8px;width:100%;padding:9px;background:var(--green);color:#000;border:none;border-radius:6px;font-family:var(--font-display);font-size:10px;font-weight:900;letter-spacing:1px;cursor:pointer;transition:opacity 0.15s;`;
      playBtn.textContent = '▶ PLAY CARD';
      playBtn.onmouseenter = () => playBtn.style.opacity = '0.8';
      playBtn.onmouseleave = () => playBtn.style.opacity = '1';
      playBtn.onclick = () => { closeOverlay('card-inspect-overlay'); onActivate(); };
      effectSection.appendChild(playBtn);
    }
    body.appendChild(effectSection);
  }

  modal.appendChild(body);

  const close = document.createElement('div');
  close.className = 'cim-close';
  close.textContent = 'CLOSE';
  close.onclick = () => closeOverlay('card-inspect-overlay');
  modal.appendChild(close);

  return modal;
}

export function openCardInspect(card, onActivate = null) {
  if (!card || card.hidden) return;
  const overlay = q('card-inspect-overlay');
  overlay.innerHTML = '';
  overlay.appendChild(buildInspectModal(card, onActivate));
  overlay.classList.add('active');
  overlay.onclick = (e) => {
    if (e.target === overlay) closeOverlay('card-inspect-overlay');
  };
}

export function addContextMenu(el, card, onActivate = null) {
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openCardInspect(card, onActivate);
  });
}

// ---------------------------------------------------------------------------
// #24 — Action buttons with phase-aware labels
// ---------------------------------------------------------------------------
export function renderActionButtons(state) {
  const p         = state.activePlayer;
  const btnLeader = q('btn-leader-active');
  const btnEnd    = q('btn-end-phase');

  if (state.phase === 'setup') {
    btnLeader.style.display = 'none';
    if (state._setupPlayer !== undefined) {
      btnEnd.textContent = 'Done Setup →';
      btnEnd.disabled    = false;
    }
    return;
  }

  if (state.phase === 'main') {
    btnLeader.style.display = '';
    const leader = state.players[p].leader;
    const canUseActive = canAfford(state, leader.activeCost)
      && (leader.id === 'kiryu' || state.players[p].hand.length > 0)
      && !(state.leaderUsedThisTurn ?? [false, false])[p];
    btnLeader.disabled = !canUseActive;
    btnLeader.textContent = `⚡ ${leader.name} Active (${leader.activeCost}⚡)`;
    // #24 — "Attack Phase →" during main phase
    btnEnd.textContent = 'Attack Phase →';
    btnEnd.disabled    = false;
  } else if (state.phase === 'attack') {
    btnLeader.style.display = 'none';
    // #24 — "End Turn →" during attack phase
    btnEnd.textContent = 'End Turn →';
    btnEnd.disabled    = false;
  } else {
    btnLeader.style.display = 'none';
    btnEnd.disabled         = true;
    btnEnd.textContent      = '...';
  }
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------
export function showOverlay(id)  { q(id).classList.add('active');    }
export function closeOverlay(id) { q(id).classList.remove('active'); }

// #26 — Scry modal renders actual card element
export function showScryModal(card, title = null) {
  const displayEl = q('scry-card-display');
  displayEl.innerHTML = '';

  // Render the actual card element
  const cardEl = buildCardEl(card, false);
  cardEl.style.margin = '8px auto';
  cardEl.style.display = 'block';
  displayEl.appendChild(cardEl);

  // Update scry overlay title if provided
  const titleEl = document.querySelector('#scry-overlay h2');
  if (titleEl && title) titleEl.textContent = title;

  showOverlay('scry-overlay');
}

export function showPassModal(nextPlayerNum, lastTurnLog = null) {
  setText('pass-title', `PASS TO PLAYER ${nextPlayerNum}`);
  setText('pass-msg',   `Player ${nextPlayerNum}'s turn is about to begin. Hand the device over.`);

  // #22 — Show last-turn summary on pass screen
  const summaryEl = q('pass-turn-summary');
  if (summaryEl) {
    if (lastTurnLog && lastTurnLog.length > 0) {
      const entries = lastTurnLog.slice(-8);
      summaryEl.innerHTML = `
        <div class="pass-summary-title">LAST TURN</div>
        ${entries.map(e => `<div class="pass-summary-entry ${e.type ?? ''}">${e.msg}</div>`).join('')}
      `;
      summaryEl.style.display = 'block';
    } else {
      summaryEl.style.display = 'none';
    }
  }

  showOverlay('pass-overlay');
}

export function showWinModal(loserP, turn) {
  const winner     = loserP === 0 ? 2 : 1;
  const winnerP    = loserP === 0 ? 1 : 0;
  const winnerName = `PLAYER ${winner}`;

  // Populate the structured win overlay
  const titleEl = q('win-title');
  const msgEl   = q('win-msg');
  if (titleEl) titleEl.textContent = `${winnerName} WINS!`;
  if (msgEl)   msgEl.textContent   = `Player ${loserP + 1}'s Leader fell on Turn ${turn}.`;

  // #25 — inject fanfare content into win-fanfare div if it exists
  const fanfareEl = q('win-fanfare');
  if (fanfareEl) {
    fanfareEl.innerHTML = `
      <div class="win-glow-name">${winnerName}</div>
      <div class="win-stat">Turn ${turn} · ${winnerName} wins!</div>
    `;
    fanfareEl.classList.add('active');
  }

  // #25 — spawn confetti particles
  _spawnConfetti();

  showOverlay('win-overlay');
}

function _spawnConfetti() {
  const colours = ['#FFD700','#0066CC','#00CC44','#FF2244','#e040fb','#1a8eff'];
  const container = document.body;
  for (let i = 0; i < 60; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-particle';
    el.style.cssText = `
      position:fixed;
      top:${-10 + Math.random() * 30}px;
      left:${Math.random() * 100}vw;
      width:${6 + Math.random() * 8}px;
      height:${6 + Math.random() * 8}px;
      background:${colours[Math.floor(Math.random() * colours.length)]};
      border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
      opacity:${0.7 + Math.random() * 0.3};
      animation: confetti-fall ${1.5 + Math.random() * 2}s ease-in ${Math.random() * 0.8}s forwards;
      pointer-events:none;
      z-index:9999;
      transform: rotate(${Math.random() * 360}deg);
    `;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
}

// ---------------------------------------------------------------------------
// Discard pile viewer
// ---------------------------------------------------------------------------
export function openDiscardViewer(state, p) {
  const discard = state.players[p].discard;
  document.getElementById('discard-title').textContent = `PLAYER ${p + 1} DISCARD PILE`;
  document.getElementById('discard-subtitle').textContent =
    discard.length === 0
      ? 'The discard pile is empty.'
      : `${discard.length} card${discard.length !== 1 ? 's' : ''} — right-click any card for details`;

  const container = document.getElementById('discard-cards');
  container.innerHTML = '';

  if (discard.length === 0) {
    container.innerHTML = '<div style="color:var(--grey);font-size:11px;padding:20px;">Empty</div>';
  } else {
    [...discard].reverse().forEach(card => {
      if (!card || card.hidden) return;
      const div = buildCardEl(card, false);
      div.style.cursor = 'pointer';
      addContextMenu(div, card, null);
      div.onclick = () => openCardInspect(card, null);
      container.appendChild(div);
    });
  }

  showOverlay('discard-overlay');
}

// ---------------------------------------------------------------------------
// #19 — Game log with colour-coded borders and KO bolding
// ---------------------------------------------------------------------------
export function addLog(msg, type = '') {
  const log   = q('game-log');
  const entry = mk('div', 'log-entry ' + type);

  // KO events get bold + larger text
  const isKO = msg.includes('KO') || msg.includes('defeated');
  if (isKO) {
    entry.classList.add('log-ko');
  }

  entry.textContent = msg;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;

  // Feed into mini-log for significant events
  if (type === 'damage' || type === 'heal' || isKO) {
    pushMiniLog(msg, type);
  }
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
const tooltipEl = document.getElementById('tooltip');
let _ttTimer;

export function addTooltip(el, name, body) {
  el.addEventListener('mouseenter', (e) => {
    _ttTimer = setTimeout(() => {
      q('tt-name').textContent = name;
      q('tt-body').innerHTML   = body.replace(/\n/g, '<br>');
      tooltipEl.classList.add('visible');
      posTooltip(e);
    }, 400);
  });
  el.addEventListener('mousemove', posTooltip);
  el.addEventListener('mouseleave', () => {
    clearTimeout(_ttTimer);
    tooltipEl.classList.remove('visible');
  });
}

function posTooltip(e) {
  let x = e.clientX + 14, y = e.clientY + 14;
  const tw = tooltipEl.offsetWidth  || 200;
  const th = tooltipEl.offsetHeight || 100;
  if (x + tw > window.innerWidth)  x = e.clientX - tw - 10;
  if (y + th > window.innerHeight) y = e.clientY - th - 10;
  tooltipEl.style.left = x + 'px';
  tooltipEl.style.top  = y + 'px';
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
function q(id)         { return document.getElementById(id); }
function mk(tag, cls)  { const el = document.createElement(tag); el.className = cls; return el; }
function setText(id, v){ const el = q(id); if (el) el.textContent = v; }

function cardTooltip(card) {
  const lines = [];
  if (card.cost !== undefined && card.type !== 'Unit') lines.push(`Cost: ${card.cost}⚡`);
  if (card.hp          !== undefined) lines.push(`HP: ${card.hp}`);
  if (card.damage      !== undefined) lines.push(`Damage: ${card.damage}`);
  if (card.effectDesc)  lines.push(`Effect: ${card.effectDesc}`);
  if (card.passiveDesc) lines.push(`Passive: ${card.passiveDesc}`);
  if (card.activeDesc)  lines.push(`Active (${card.activeCost}⚡): ${card.activeDesc}`);
  return lines.join('\n');
}