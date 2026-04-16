/**
 * RENDERER
 * All DOM reads and writes live here.
 * Called after every state change. Never mutates gameState directly.
 */

import { calcEffectiveDamage } from '../engine/combat.js';
import { canAfford, getActiveCost } from '../engine/actions.js';
import { opponent } from '../engine/state.js';

// ---------------------------------------------------------------------------
// Emoji / label helpers
// ---------------------------------------------------------------------------
const UNIT_EMOJI = {
  tails: '🦊', knuckles: '👊', amy: '🌸', cream: '🐰', big: '🐟',
  silver: '⚡', shadow: '🌑', mighty: '🦔', rouge: '🦇', blaze: '🔥', ray: '🐿',
  charmy: '🐝', espio: '🦎', vector: '🐊', omega: '🤖',
};

function passiveIcon(unit) {
  const t = unit.passive?.type;
  if (t === 'attack_boost')    return `+${unit.passive.amount}⚔`;
  if (t === 'damage_reduction')return `-${unit.passive.amount}🛡`;
  if (t === 'draw_end')        return '📄end';
  if (t === 'big_scry')        return '👁top';
  return '';
}

const PHASE_LABELS = {
  big_scry: 'BIG SCRY', draw: 'DRAW', energy: 'ENERGY',
  main: 'MAIN PHASE', attack: 'ATTACK PHASE', end: 'END PHASE',
};

// ---------------------------------------------------------------------------
// Main render entry point — call after every state mutation
// ---------------------------------------------------------------------------
export function render(state) {
  const p   = state.activePlayer;
  const opp = opponent(p);

  renderHUD(state);
  renderLeader('p1-leader-zone', state, 0);
  renderLeader('p2-leader-zone', state, 1);
  renderBench('p1-bench', state, 0);
  renderBench('p2-bench', state, 1);
  renderHand('p1-hand', state, 0);
  renderHand('p2-hand', state, 1);
  renderInfoRow('p1-info', state, 0);
  renderInfoRow('p2-info', state, 1);
  renderPlayerLabels(state);
  renderActionButtons(state);
}

// ---------------------------------------------------------------------------
// HUD (phase, turn, energy, stage, deck counts)
// ---------------------------------------------------------------------------
function renderHUD(state) {
  const p = state.activePlayer;

  setText('phase-display', PHASE_LABELS[state.phase] ?? state.phase);
  setText('turn-num', state.turn);

  // Energy pips
  const pipsEl = q('energy-pips');
  pipsEl.innerHTML = '';
  for (let i = 0; i < state.energyMax[p]; i++) {
    const pip = mk('div', 'pip' + (i < state.energy[p] ? ' filled' : ''));
    pipsEl.appendChild(pip);
  }
  setText('energy-text', `${state.energy[p]}/${state.energyMax[p]}`);

  // Stage zone
  const stageEl = q('stage-zone');
  if (state.activeStage) {
    stageEl.className = 'stage-zone active';
    stageEl.textContent = state.activeStage.name;
  } else {
    stageEl.className = 'stage-zone';
    stageEl.textContent = 'No Stage';
  }

  // Deck / discard for active player
  setText('deck-count',    state.players[p].deck.length);
  setText('discard-count', state.players[p].discard.length);
}

// ---------------------------------------------------------------------------
// Player labels (highlight active)
// ---------------------------------------------------------------------------
function renderPlayerLabels(state) {
  const p = state.activePlayer;
  q('p1-label').className = 'player-label' + (p === 0 ? ' active' : '');
  q('p2-label').className = 'player-label' + (p === 1 ? ' active' : '');
}

// ---------------------------------------------------------------------------
// Info row (deck, discard, status icons per player)
// ---------------------------------------------------------------------------
function renderInfoRow(containerId, state, p) {
  const el = q(containerId);
  el.innerHTML = `
    <span class="deck-count"    style="font-size:9px;padding:2px 6px;">${state.players[p].deck.length}📚</span>
    <span class="discard-count" style="font-size:9px;padding:2px 6px;">${state.players[p].discard.length}🗑</span>
    ${state.shieldActive[p] ? '<span style="color:#44aaff;font-size:11px;" title="Shielded">🛡</span>' : ''}
    ${state.masterEmeraldActive && p === state.activePlayer ? '<span style="color:#da7aff;font-size:9px;" title="Master Emerald active">ME★</span>' : ''}
    ${state.chaosEmeraldBuff[p] > 0 ? `<span style="color:var(--gold);font-size:9px;" title="Chaos Emerald buff">+${state.chaosEmeraldBuff[p]}⚔</span>` : ''}
  `;
}

// ---------------------------------------------------------------------------
// Leader card
// ---------------------------------------------------------------------------
export function renderLeader(containerId, state, p) {
  const el       = q(containerId);
  const leader   = state.players[p].leader;
  const ap       = state.activePlayer;
  const hpPct    = Math.max(0, (leader.currentHp / leader.hp) * 100);
  const effDmg   = calcEffectiveDamage(state, p);
  const isTarget = state.phase === 'attack' && p !== ap;
  const canUse   = state.phase === 'main' && p === ap
                   && canAfford(state, leader.activeCost)
                   && state.players[p].hand.length > 0;

  const div = mk('div', [
    'leader-card',
    isTarget  ? 'attack-target' : '',
    state.shieldActive[p] ? 'shielded' : '',
    canUse    ? 'active-avail' : '',
  ].filter(Boolean).join(' '));

  div.innerHTML = `
    <div class="leader-name">SONIC</div>
    <div style="font-size:18px;margin:2px 0;">🦔</div>
    <div class="leader-hp-bar"><div class="leader-hp-fill" style="width:${hpPct}%"></div></div>
    <div class="leader-hp-text">${leader.currentHp}/${leader.hp}</div>
    <div class="leader-dmg-text">⚔${effDmg}</div>
  `;

  addTooltip(div, leader.name,
    `HP: ${leader.currentHp}/${leader.hp}\nDamage: ${effDmg}\nActive (${leader.activeCost}⚡): ${leader.activeDesc}`);

  el.innerHTML = '';
  el.appendChild(div);

  // Return div so the event-handler module can attach click listeners
  return div;
}

// ---------------------------------------------------------------------------
// Bench
// ---------------------------------------------------------------------------
export function renderBench(containerId, state, p) {
  const el = q(containerId);
  el.innerHTML = '';
  const ap          = state.activePlayer;
  const isActiveP   = p === ap;
  const isAttack    = state.phase === 'attack';

  const unitDivs = [];

  state.players[p].bench.forEach((unit, idx) => {
    const hpPct      = Math.max(0, (unit.currentHp / unit.hp) * 100);
    const cost       = getActiveCost(state, unit);
    const canActivate = state.phase === 'main' && isActiveP && !unit.exhausted && canAfford(state, cost);
    const isTarget   = isAttack && !isActiveP;

    const div = mk('div', [
      'bench-unit',
      'card-type-unit',
      unit.exhausted   ? 'exhausted'    : '',
      canActivate      ? 'can-activate' : '',
      isTarget         ? 'attack-target': '',
    ].filter(Boolean).join(' '));

    div.innerHTML = `
      <div style="font-size:8px;font-weight:700;color:var(--sonic-bright);">${unit.name}</div>
      <div style="font-size:9px;">${UNIT_EMOJI[unit.id] ?? '⭐'}</div>
      <div style="font-size:7px;color:var(--grey);">${unit.currentHp}/${unit.hp}HP</div>
      ${!unit.exhausted ? `<div style="font-size:6px;color:#7aaabb;">${passiveIcon(unit)}</div>` : ''}
      <div class="unit-hp-bar"><div class="unit-hp-fill" style="width:${hpPct}%"></div></div>
    `;

    addTooltip(div, unit.name,
      `HP: ${unit.currentHp}/${unit.hp}\nPassive: ${unit.passiveDesc}\nActive (${cost}⚡): ${unit.activeDesc}`);

    el.appendChild(div);
    unitDivs.push({ div, idx });
  });

  // Empty bench slots
  for (let i = state.players[p].bench.length; i < 3; i++) {
    const slot = mk('div', 'bench-slot');
    slot.textContent = 'empty';
    el.appendChild(slot);
  }

  return unitDivs; // for event-handler to attach clicks
}

// ---------------------------------------------------------------------------
// Hand
// ---------------------------------------------------------------------------
export function renderHand(containerId, state, p) {
  const el      = q(containerId);
  el.innerHTML  = '';
  const ap      = state.activePlayer;
  const isOwner = p === ap;
  const isMain  = state.phase === 'main';

  const cardEls = [];

  if (!isOwner) {
    // Face-down for opponent
    state.players[p].hand.forEach(() => {
      el.appendChild(mk('div', 'card face-down'));
    });
    return cardEls;
  }

  state.players[p].hand.forEach((card, idx) => {
    const cost      = card.cost ?? 0;
    const playable  = isMain && canAfford(state, cost);
    const div       = buildCardEl(card, playable);
    addTooltip(div, card.name, cardTooltip(card));
    el.appendChild(div);
    cardEls.push({ div, idx, card });
  });

  return cardEls;
}

// ---------------------------------------------------------------------------
// Card DOM element builder
// ---------------------------------------------------------------------------
export function buildCardEl(card, playable = false) {
  const typeKey = {
    Unit: 'unit', Stage: 'stage',
    Equipment: 'equipment', Genesis: 'genesis', Leader: 'leader',
  }[card.type] ?? 'equipment';

  const div = mk('div', ['card', `card-type-${typeKey}`, playable ? 'playable' : ''].filter(Boolean).join(' '));

  const typeClass = {
    Unit: 'type-unit', Stage: 'type-stage',
    Equipment: 'type-equipment', Genesis: 'type-genesis', Leader: 'type-leader',
  }[card.type] ?? 'type-equipment';

  const cost = card.cost ?? 0;
  div.innerHTML = `
    <div class="card-type-badge ${typeClass}">${card.type.toUpperCase()}</div>
    ${cost > 0 ? `<div class="card-cost">${cost}</div>` : ''}
    <div class="card-name">${card.name}</div>
    ${card.hp !== undefined ? `<div style="font-size:8px;color:var(--green);">HP:${card.hp}</div>` : ''}
    <div class="card-effect-text">${card.effectDesc ?? card.passiveDesc ?? ''}</div>
  `;
  return div;
}

// ---------------------------------------------------------------------------
// Action button state
// ---------------------------------------------------------------------------
function renderActionButtons(state) {
  const p         = state.activePlayer;
  const btnLeader = q('btn-leader-active');
  const btnEnd    = q('btn-end-phase');

  if (state.phase === 'main') {
    btnLeader.style.display = '';
    btnLeader.disabled = !(canAfford(state, state.players[p].leader.activeCost)
                           && state.players[p].hand.length > 0);
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
// Overlay helpers
// ---------------------------------------------------------------------------
export function showOverlay(id) { q(id).classList.add('active'); }
export function closeOverlay(id){ q(id).classList.remove('active'); }

export function showScryModal(card) {
  q('scry-card-display').innerHTML = `
    <strong style="color:var(--sonic-bright);font-family:'Orbitron',sans-serif;">${card.name}</strong><br>
    <span style="color:var(--grey);font-size:9px;">${card.type}</span><br>
    <span style="font-size:9px;">${card.effectDesc ?? card.passiveDesc ?? card.activeDesc ?? ''}</span>
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
    }, 300);
  });
  el.addEventListener('mousemove', posTooltip);
  el.addEventListener('mouseleave', () => {
    clearTimeout(_ttTimer);
    tooltipEl.classList.remove('visible');
  });
}

function posTooltip(e) {
  let x = e.clientX + 12, y = e.clientY + 12;
  const tw = tooltipEl.offsetWidth  || 200;
  const th = tooltipEl.offsetHeight || 100;
  if (x + tw > window.innerWidth)  x = e.clientX - tw - 8;
  if (y + th > window.innerHeight) y = e.clientY - th - 8;
  tooltipEl.style.left = x + 'px';
  tooltipEl.style.top  = y + 'px';
}

// ---------------------------------------------------------------------------
// Private DOM shortcuts
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
