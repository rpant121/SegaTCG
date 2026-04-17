/**
 * RENDERER
 * All DOM reads and writes. Never mutates gameState.
 */

import { calcEffectiveDamage, calcDamageBreakdown } from '../engine/combat.js';
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
  heat_barrier: '🔥', dragons_eye: '👁', power_glove: '🥊',
  midnight_carnival: '🎪', polaris_pact: '🌌',
  speed_shoes: '👟', extreme_gear: '⚙', radical_highway: '🛣', super_form: '✨',
};

function cardEmoji(card) {
  if (card.type === 'Unit' || card.type === 'Leader') return UNIT_EMOJI[card.id] ?? '⭐';
  return EQUIP_EMOJI[card.id] ?? '🃏';
}

function passiveIcon(unit) {
  const t = unit.passive?.type;
  if (t === 'attack_boost')    return `+${unit.passive.amount}⚔`;
  if (t === 'damage_reduction') return `-${unit.passive.amount}🛡`;
  if (t === 'draw_end')        return '📄end';
  if (t === 'big_scry')        return '👁top';
  return '';
}

const PHASE_LABELS = {
  setup: 'SETUP PHASE',
  big_scry: 'BIG SCRY', draw: 'DRAW', energy: 'ENERGY',
  main: 'MAIN PHASE', attack: 'ATTACK', end: 'END PHASE',
};

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------
export function render(state) {
  renderHUD(state);
  renderLeader('p1-leader-zone', state, 0);
  renderLeader('p2-leader-zone', state, 1);
  renderBench('p1-bench', state, 0);
  renderBench('p2-bench', state, 1);
  // During setup, show setup player's hand face-up, other face-down
  const sp = state.phase === 'setup' ? (state._setupPlayer ?? 0) : state.activePlayer;
  renderHand('p1-hand', state, 0, sp);
  renderHand('p2-hand', state, 1, sp);
  renderInfoRow('p1-info', state, 0);
  renderInfoRow('p2-info', state, 1);
  renderPlayerLabels(state);
  renderActionButtons(state);
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
function renderHUD(state) {
  const p = state.activePlayer;

  setText('phase-display', PHASE_LABELS[state.phase] ?? state.phase);
  setText('turn-num', `Turn ${state.turn}`);

  // Energy pips — one pip per max energy; cap at 15, text-only beyond
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

  // Stage
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

function renderPlayerLabels(state) {
  const p = state.phase === 'setup' ? (state._setupPlayer ?? 0) : state.activePlayer;
  q('p1-label').className = 'player-label' + (p === 0 ? ' active' : '');
  q('p2-label').className = 'player-label' + (p === 1 ? ' active' : '');
}

function renderInfoRow(containerId, state, p) {
  const el = q(containerId);
  const flags = [
    state.shieldActive[p]                                        ? '<span title="Shielded">🛡</span>' : '',
    state.masterEmeraldActive && p === state.activePlayer        ? '<span style="color:#e088dd;font-size:8px;" title="Master Emerald">ME★</span>' : '',
    state.chaosEmeraldBuff[p] > 0 ? `<span style="color:var(--gold);font-size:8px;" title="Chaos Emerald">+${state.chaosEmeraldBuff[p]}⚔</span>` : '',
    state.powerGloveBuff[p]   > 0 ? `<span style="color:var(--red);font-size:8px;" title="Power Glove">+${state.powerGloveBuff[p]}⚔</span>` : '',
    (state.rougeUsedThisTurn ?? [false,false])[p] ? '<span style="color:#6677aa;font-size:8px;" title="Rouge used">🦇✓</span>' : '',
  ].filter(Boolean).join(' ');

  el.innerHTML = `
    <span class="deck-count" style="font-size:9px;padding:2px 5px;">${state.players[p].deck.length}📚</span>
    <span class="discard-count info-discard" style="font-size:9px;padding:2px 5px;cursor:pointer;" title="Click to view discard pile">${state.players[p].discard.length}🗑</span>
    ${flags}
  `;

  // Wire click to open discard viewer — capture p in closure
  const discardBtn = el.querySelector('.info-discard');
  if (discardBtn) {
    discardBtn.onclick = () => openDiscardViewer(state, p);
  }
}

// ---------------------------------------------------------------------------
// Leader card — now horizontal layout
// ---------------------------------------------------------------------------
export function renderLeader(containerId, state, p) {
  const el     = q(containerId);
  const leader = state.players[p].leader;
  const ap     = state.activePlayer;
  const hpPct  = Math.max(0, (leader.currentHp / leader.hp) * 100);
  const effDmg = calcEffectiveDamage(state, p);
  const bd     = calcDamageBreakdown(state, p);
  const isBuffed = effDmg > bd.base;

  // Build breakdown tooltip string
  let breakdownParts = [];
  if (bd.shadowCount > 0) breakdownParts.push(`${bd.base} × ${bd.multiplier} (Shadow)`);
  else breakdownParts.push(`${bd.base} base`);
  bd.boostSources.forEach(s => breakdownParts.push(s));
  const breakdownStr = breakdownParts.join(' + ');

  // Build breakdown bar HTML (shown in the hp-bar area as a sub-label)
  const dmgBarHtml = isBuffed
    ? `<div class="leader-dmg-breakdown">${breakdownStr} = ${effDmg}</div>`
    : '';

  const isTarget = state.phase === 'attack' && p !== ap;
  const canUse   = state.phase === 'main' && p === ap
                   && canAfford(state, leader.activeCost)
                   && state.players[p].hand.length > 0
                   && !(state.leaderUsedThisTurn ?? [false,false])[p];

  const div = mk('div', [
    'leader-card',
    isTarget              ? 'attack-target' : '',
    state.shieldActive[p] ? 'shielded'      : '',
    canUse                ? 'active-avail'  : '',
  ].filter(Boolean).join(' '));

  div.innerHTML = `
    <div class="leader-emoji">🦔</div>
    <div class="leader-info">
      <div class="leader-name">SONIC</div>
      <div class="leader-hp-bar"><div class="leader-hp-fill" style="width:${hpPct}%"></div></div>
      <div class="leader-stats">
        <span class="leader-hp-text">${leader.currentHp}/${leader.hp}</span>
        <span class="leader-dmg-chip${isBuffed ? ' buffed' : ''}" title="${breakdownStr}">⚔ ${effDmg}</span>
      </div>
      ${dmgBarHtml}
    </div>
  `;

  addTooltip(div, leader.name,
    `HP: ${leader.currentHp}/${leader.hp} · Damage: ${effDmg}\nActive (${leader.activeCost}⚡): ${leader.activeDesc}`);
  addContextMenu(div, leader);

  el.innerHTML = '';
  el.appendChild(div);
  return div;
}

// ---------------------------------------------------------------------------
// Bench
// ---------------------------------------------------------------------------
export function renderBench(containerId, state, p) {
  const el       = q(containerId);
  el.innerHTML   = '';
  const ap       = state.activePlayer;
  const isActiveP = p === ap;
  const isAttack  = state.phase === 'attack';
  const unitDivs  = [];

  state.players[p].bench.forEach((unit, idx) => {
    const hpPct       = Math.max(0, (unit.currentHp / unit.hp) * 100);
    const cost        = getActiveCost(state, unit);
    const canActivate = state.phase === 'main' && isActiveP && !unit.exhausted
      && canAfford(state, cost)
      && !(unit.id === 'rouge' && (state.rougeUsedThisTurn ?? [false,false])[p])
      && !hasUsedActiveThisTurn(state, unit);
    const isTarget    = isAttack && !isActiveP;
    const icon        = passiveIcon(unit);

    const div = mk('div', [
      'bench-unit', 'card-type-unit',
      unit.exhausted                      ? 'exhausted'    : '',
      canActivate                        ? 'can-activate' : '',
      isTarget                           ? 'attack-target': '',
    ].filter(Boolean).join(' '));

    div.innerHTML = `
      <div class="bench-name">${unit.name}</div>
      <div class="bench-emoji">${UNIT_EMOJI[unit.id] ?? '⭐'}</div>
      <div class="bench-hp">${unit.currentHp}/${unit.hp}HP</div>
      ${icon && !unit.exhausted ? `<div class="bench-passive">${icon}</div>` : ''}
      <div class="unit-hp-bar"><div class="unit-hp-fill" style="width:${hpPct}%"></div></div>
    `;

    addTooltip(div, unit.name,
      `HP: ${unit.currentHp}/${unit.hp}\nPassive: ${unit.passiveDesc}\nActive (${cost}⚡): ${unit.activeDesc}`);

    el.appendChild(div);
    unitDivs.push({ div, idx });
  });

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
  const el      = q(containerId);
  el.innerHTML  = '';
  // ownerP=-1 means force face-down; ownerP=null means use activePlayer
  const activeOwner = ownerP === null ? state.activePlayer : ownerP;
  const isOwner = ownerP !== -1 && p === activeOwner;
  const cardEls = [];

  if (!isOwner) {
    state.players[p].hand.forEach(() => el.appendChild(mk('div', 'card face-down')));
    return cardEls;
  }

  state.players[p].hand.forEach((card, idx) => {
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
  const typeKey = {
    Unit: 'unit', Stage: 'stage',
    Equipment: 'equipment', Genesis: 'genesis', Leader: 'leader',
  }[card.type] ?? 'equipment';

  const typeClass = {
    Unit: 'type-unit', Stage: 'type-stage',
    Equipment: 'type-equipment', Genesis: 'type-genesis', Leader: 'type-leader',
  }[card.type] ?? 'type-equipment';

  const div = mk('div', ['card', `card-type-${typeKey}`, playable ? 'playable' : ''].filter(Boolean).join(' '));
  const cost = card.cost ?? 0;

  div.innerHTML = `
    <div class="card-type-strip"></div>
    <div class="card-type-badge ${typeClass}">${card.type.toUpperCase()}</div>
    ${cost > 0 ? `<div class="card-cost">${cost}</div>` : ''}
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
  const typeKey = {
    Unit: 'unit', Stage: 'stage',
    Equipment: 'equipment', Genesis: 'genesis', Leader: 'leader',
  }[card.type] ?? 'equipment';

  const typePillClass = `type-${typeKey}`;

  const modal = document.createElement('div');
  modal.className = 'card-inspect-modal';

  // ── Header ────────────────────────────────────────────────
  const cost = card.cost ?? 0;
  const hdr  = document.createElement('div');
  hdr.className = `cim-header type-${typeKey}`;
  hdr.innerHTML = `
    <div class="cim-art">${cardEmoji(card)}</div>
    <div class="cim-name">${card.name}</div>
    <div class="cim-type-row">
      <div class="cim-type-pill ${typePillClass}">${card.type.toUpperCase()}</div>
      ${cost > 0 ? `<div class="cim-cost-pill">${cost}⚡</div>` : ''}
    </div>
  `;
  modal.appendChild(hdr);

  // ── Stats bar ─────────────────────────────────────────────
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

  // ── Body ──────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'cim-body';

  // Passive
  if (card.passiveDesc && card.passiveDesc !== 'No passive.') {
    body.innerHTML += `
      <div>
        <div class="cim-section-label">Passive Ability</div>
        <div class="cim-passive-box">
          <div class="cim-passive-text">${card.passiveDesc}</div>
        </div>
      </div>`;
  }

  // Active / Effect
  if (card.activeDesc) {
    const activeSection = document.createElement('div');
    activeSection.innerHTML = `
      <div class="cim-section-label">Active Ability</div>
      <div class="cim-active-box">
        <div class="cim-active-cost">${card.activeCost ?? 0}⚡ COST</div>
        <div class="cim-active-text">${card.activeDesc}</div>
      </div>`;

    if (onActivate) {
      const isActive = !!card.activeDesc;
      const useBtn = document.createElement('button');
      useBtn.style.cssText = `
        margin-top: 8px; width: 100%; padding: 9px;
        background: var(--gold); color: #000;
        border: none; border-radius: 6px;
        font-family: var(--font-display); font-size: 10px; font-weight: 900;
        letter-spacing: 1px; cursor: pointer;
        transition: opacity 0.15s;
      `;
      useBtn.textContent = isActive ? '⚡ USE ACTIVE' : '▶ PLAY CARD';
      useBtn.onmouseenter = () => useBtn.style.opacity = '0.8';
      useBtn.onmouseleave = () => useBtn.style.opacity = '1';
      useBtn.onclick = () => {
        closeOverlay('card-inspect-overlay');
        onActivate();
      };
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
      playBtn.style.cssText = `
        margin-top: 8px; width: 100%; padding: 9px;
        background: var(--green); color: #000;
        border: none; border-radius: 6px;
        font-family: var(--font-display); font-size: 10px; font-weight: 900;
        letter-spacing: 1px; cursor: pointer; transition: opacity 0.15s;
      `;
      playBtn.textContent = '▶ PLAY CARD';
      playBtn.onmouseenter = () => playBtn.style.opacity = '0.8';
      playBtn.onmouseleave = () => playBtn.style.opacity = '1';
      playBtn.onclick = () => { closeOverlay('card-inspect-overlay'); onActivate(); };
      effectSection.appendChild(playBtn);
    }
    body.appendChild(effectSection);
  }

  modal.appendChild(body);

  // ── Close ─────────────────────────────────────────────────
  const close = document.createElement('div');
  close.className = 'cim-close';
  close.textContent = 'CLOSE';
  close.onclick = () => closeOverlay('card-inspect-overlay');
  modal.appendChild(close);

  return modal;
}

export function openCardInspect(card, onActivate = null) {
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
// Action buttons
// ---------------------------------------------------------------------------
function renderActionButtons(state) {
  const p         = state.activePlayer;
  const btnLeader = q('btn-leader-active');
  const btnEnd    = q('btn-end-phase');

  if (state.phase === 'setup') {
    btnLeader.style.display = 'none';
    btnEnd.textContent      = 'Done Setup →';
    btnEnd.disabled         = false;
    return;
  }

  if (state.phase === 'main') {
    btnLeader.style.display = '';
    btnLeader.disabled = !(canAfford(state, state.players[p].leader.activeCost)
                           && state.players[p].hand.length > 0
                           && !(state.leaderUsedThisTurn ?? [false,false])[p]);
    btnEnd.textContent = 'Start Attack →';
    btnEnd.disabled    = false;
  } else if (state.phase === 'attack') {
    btnLeader.style.display = 'none';
    btnEnd.textContent      = 'Skip Attack →';
    btnEnd.disabled         = false;
  } else {
    btnLeader.style.display = 'none';
    btnEnd.disabled         = true;
  }
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------
export function showOverlay(id)  { q(id).classList.add('active');    }
export function closeOverlay(id) { q(id).classList.remove('active'); }

export function showScryModal(card) {
  q('scry-card-display').innerHTML = `
    <strong style="color:var(--sonic-bright);font-family:'Orbitron',sans-serif;">${card.name}</strong><br>
    <span style="color:var(--grey);font-size:9px;">${card.type}</span><br>
    <span style="font-size:10px;">${card.effectDesc ?? card.passiveDesc ?? card.activeDesc ?? ''}</span>
  `;
  showOverlay('scry-overlay');
}

export function showPassModal(nextPlayerNum) {
  setText('pass-title', `PASS TO PLAYER ${nextPlayerNum}`);
  setText('pass-msg',   `Player ${nextPlayerNum}'s turn is about to begin. Hand the device over.`);
  showOverlay('pass-overlay');
}

export function showWinModal(loserP, turn) {
  const winner = loserP === 0 ? 2 : 1;
  setText('win-title', `PLAYER ${winner} WINS!`);
  setText('win-msg',   `Player ${loserP + 1}'s Leader was defeated on Turn ${turn}.`);
  showOverlay('win-overlay');
}

// ---------------------------------------------------------------------------
// Discard pile viewer
// ---------------------------------------------------------------------------
export function openDiscardViewer(state, p) {
  const discard = state.players[p].discard;
  document.getElementById('discard-title').textContent =
    `PLAYER ${p + 1} DISCARD PILE`;
  document.getElementById('discard-subtitle').textContent =
    discard.length === 0
      ? 'The discard pile is empty.'
      : `${discard.length} card${discard.length !== 1 ? 's' : ''} — right-click any card for details`;

  const container = document.getElementById('discard-cards');
  container.innerHTML = '';

  if (discard.length === 0) {
    container.innerHTML = '<div style="color:var(--grey);font-size:11px;padding:20px;">Empty</div>';
  } else {
    // Show most-recently-discarded first
    [...discard].reverse().forEach(card => {
      const div = buildCardEl(card, false);
      div.style.cursor = 'pointer';
      addContextMenu(div, card, null);
      // Left-click also opens inspect
      div.onclick = () => openCardInspect(card, null);
      container.appendChild(div);
    });
  }

  showOverlay('discard-overlay');
}

// ---------------------------------------------------------------------------
// Game log
// ---------------------------------------------------------------------------
export function addLog(msg, type = '') {
  const log   = q('game-log');
  const entry = mk('div', 'log-entry ' + type);
  entry.textContent = msg;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
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
  if (card.cost    !== undefined) lines.push(`Cost: ${card.cost}⚡`);
  if (card.hp      !== undefined) lines.push(`HP: ${card.hp}`);
  if (card.damage  !== undefined) lines.push(`Damage: ${card.damage}`);
  if (card.effectDesc)  lines.push(`Effect: ${card.effectDesc}`);
  if (card.passiveDesc) lines.push(`Passive: ${card.passiveDesc}`);
  if (card.activeDesc)  lines.push(`Active (${card.activeCost}⚡): ${card.activeDesc}`);
  return lines.join('\n');
}
