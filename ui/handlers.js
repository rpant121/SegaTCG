/**
 * EVENT HANDLERS
 * Wires DOM events to engine actions, then re-renders.
 * Only module that holds references to both engine and renderer.
 *
 * Interaction model:
 *   Unit cards in hand   → drag onto bench to deploy
 *   Non-unit hand cards  → click to play
 *   Own Leader           → click for Sonic active (Main Phase)
 *   Own bench units      → click for unit active (Main Phase)
 *   Opp Leader / bench   → click to attack (Attack Phase)
 *   Mighty active        → opens second-attack target modal
 */

import { opponent } from '../engine/state.js';
import { checkWin } from '../engine/combat.js';
import { attackLeader, applyDamageToUnit, resolveBlock, calcEffectiveDamage } from '../engine/combat.js';
import {
  playCardFromHand, resolveExtremeGear, canAfford, getActiveCost,
  tailsActive, knucklesActive, amyActive, creamActive, bigActive,
  silverActive, shadowActive, mightyActive, rougeActive, blazeActive,
  rayActive, charmyActive, espioActive, vectorActive, omegaActive,
  sonicActive,
} from '../engine/actions.js';
import {
  startTurn, resolveBigScry as engineResolveBigScry,
  enterAttackPhase, enterEndPhase, advanceTurn,
} from '../engine/phases.js';
import {
  render, addLog, showOverlay, closeOverlay,
  showScryModal, showPassModal, showWinModal,
  renderLeader, renderBench, renderHand, openCardInspect,
} from './renderer.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let state     = null;
let _gameOver = false;

let _drag = { active: false, handIdx: null, ghostEl: null };

// Extreme Gear: tracks which hand indices are selected for discard
let _extremeGearSelected = new Set();

// ---------------------------------------------------------------------------
// Emit handler
// ---------------------------------------------------------------------------
function emit(event, payload) {
  switch (event) {
    case 'scry_prompt':   showScryModal(payload.card); break;
    case 'phase_changed': refreshBoard(); break;
    case 'request_pass':  refreshBoard(); showPassModal(payload); break;
  }
  winGuard();
}

function log(msg, type) { addLog(msg, type); }

function winGuard() {
  const loser = checkWin(state);
  if (loser !== null && !_gameOver) {
    _gameOver = true;
    showWinModal(loser, state.turn);
  }
}

function refreshBoard() {
  render(state);
  attachBoardHandlers();
}

// ---------------------------------------------------------------------------
// Board handler attachment — called after every render
// ---------------------------------------------------------------------------
function attachBoardHandlers() {
  const p   = state.activePlayer;
  const opp = opponent(p);

  // ── Own hand ──────────────────────────────────────────────────────────
  const handEls = renderHand(`p${p + 1}-hand`, state, p);
  handEls.forEach(({ div, idx, card }) => {
    // Right-click inspect always available on own hand cards
    const isEquip = card.type === 'Equipment' || card.type === 'Genesis' || card.type === 'Stage';
    const charmyDiscount = (isEquip && state.equipmentPlayedThisTurn[p] > 0 &&
      state.players[p].bench.some(u => u.id === 'charmy' && !u.exhausted)) ? 1 : 0;
    const effectiveCost = Math.max(0, (card.cost ?? 0) - charmyDiscount);
    const playable = state.phase === 'main' && canAfford(state, effectiveCost);

    // Context menu — play button only if eligible this phase
    const onPlay = (playable && card.type !== 'Unit') ? () => {
      playCardFromHand(state, idx, log);
      refreshBoard(); winGuard(); checkPendingEffects();
    } : null;
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openCardInspect(card, onPlay);
    });

    if (state.phase !== 'main') return;

    if (card.type === 'Unit') {
      attachDragSource(div, idx, card);
    } else if (playable) {
      div.classList.add('playable');
      div.onclick = () => {
        playCardFromHand(state, idx, log);
        refreshBoard();
        winGuard();
        checkPendingEffects();
      };
    }
  });

  // ── Own bench: activate ───────────────────────────────────────────────
  const ownBenchEls = renderBench(`p${p + 1}-bench`, state, p);
  ownBenchEls.forEach(({ div, idx }) => {
    const unit = state.players[p].bench[idx];
    if (!unit || unit.exhausted) return;
    const cost = getActiveCost(state, unit);
    const canUse = state.phase === 'main' && canAfford(state, cost)
      && !(unit.id === 'rouge' && state.rougeUsedThisTurn[p]);
    if (canUse) {
      div.onclick = () => handleUnitActive(p, idx);
    }
    // Re-attach context menu with activate callback when eligible
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const activateFn = canUse ? () => handleUnitActive(p, idx) : null;
      openCardInspect(unit, activateFn);
    });
  });

  // Own bench: drop zone
  attachBenchDropZone(`p${p + 1}-bench`, p);

  // ── Opponent bench: attack targets + inspect ─────────────────────────
  const oppBenchEls = renderBench(`p${opp + 1}-bench`, state, opp);
  oppBenchEls.forEach(({ div, idx }) => {
    const unit = state.players[opp].bench[idx];
    if (state.phase === 'attack') {
      div.onclick = () => {
        applyDamageToUnit(state, p, opp, idx, log);
        winGuard();
        if (!_gameOver) enterEndPhase(state, log, emit);
      };
    }
    // Inspect only — no activate for opponent units
    if (unit) {
      div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openCardInspect(unit, null);
      });
    }
  });

  // ── Opponent Leader: attack target + inspect ──────────────────────────
  const oppLeaderDiv = renderLeader(`p${opp + 1}-leader-zone`, state, opp);
  if (state.phase === 'attack') {
    oppLeaderDiv.onclick = () => {
      // Check if defender has any non-exhausted bench units available to block
      const canBlock = state.players[opp].bench.some(u => !u.exhausted);
      // Shield absorbs everything — skip block modal entirely
      if (state.shieldActive[opp] || !canBlock) {
        attackLeader(state, p, opp, log);
        winGuard();
        if (!_gameOver) enterEndPhase(state, log, emit);
      } else {
        openBlockModal(p, opp);
      }
    };
  }
  // Always allow inspecting opponent leader
  oppLeaderDiv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openCardInspect(state.players[opp].leader, null);
  });

  // ── Own Leader: Sonic active ──────────────────────────────────────────
  const ownLeaderDiv = renderLeader(`p${p + 1}-leader-zone`, state, p);
  if (state.phase === 'main') {
    const canUse = canAfford(state, state.players[p].leader.activeCost)
                   && state.players[p].hand.length > 0
                   && !(state.leaderUsedThisTurn ?? [false,false])[p];
    ownLeaderDiv.style.cursor = canUse ? 'pointer' : 'default';
    if (canUse) ownLeaderDiv.onclick = () => openSonicModal();
    ownLeaderDiv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openCardInspect(state.players[p].leader, canUse ? () => openSonicModal() : null);
    });
  }

  // Mighty second attack: if pending, open modal
  if (state.pendingMightyAttack) {
    state.pendingMightyAttack = false;
    openMightyAttackModal(p);
  }
}

// ---------------------------------------------------------------------------
// DRAG AND DROP
// ---------------------------------------------------------------------------
function attachDragSource(div, handIdx, card) {
  div.draggable = true;
  div.classList.add('draggable');

  div.addEventListener('dragstart', (e) => {
    _drag = { active: true, handIdx, ghostEl: null };
    const blank = document.createElement('canvas');
    blank.width = blank.height = 1;
    e.dataTransfer.setDragImage(blank, 0, 0);
    e.dataTransfer.effectAllowed = 'move';
    _drag.ghostEl = buildGhost(card);
    document.body.appendChild(_drag.ghostEl);
    highlightBenchZone(true);
  });

  div.addEventListener('drag', (e) => {
    if (!_drag.ghostEl || e.clientX === 0) return;
    _drag.ghostEl.style.left = `${e.clientX - 36}px`;
    _drag.ghostEl.style.top  = `${e.clientY - 50}px`;
  });

  div.addEventListener('dragend', endDrag);
}

function attachBenchDropZone(benchId, p) {
  const el = document.getElementById(benchId);
  if (!el) return;
  el.addEventListener('dragover', (e) => {
    if (!_drag.active) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-hover');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-hover'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop-hover');
    if (!_drag.active || _drag.handIdx === null) return;
    playCardFromHand(state, _drag.handIdx, log);
    endDrag();
    refreshBoard();
    winGuard();
    checkPendingEffects();
  });
}

function buildGhost(card) {
  const el = document.createElement('div');
  el.className = 'card card-type-unit drag-ghost';
  el.style.cssText = `position:fixed;pointer-events:none;z-index:1000;opacity:0.85;
    transform:rotate(4deg) scale(1.05);
    box-shadow:0 8px 32px #000a,0 0 16px var(--sonic-blue);
    border-color:var(--sonic-bright);`;
  el.innerHTML = `<div class="card-type-badge type-unit">UNIT</div>
    <div class="card-name">${card.name}</div>
    <div style="font-size:8px;color:var(--green);">HP:${card.hp}</div>
    <div class="card-effect-text">${card.passiveDesc ?? ''}</div>`;
  return el;
}

function highlightBenchZone(on) {
  const el = document.getElementById(`p${state.activePlayer + 1}-bench`);
  if (el) el.classList.toggle('drop-target-active', on);
}

function endDrag() {
  _drag.active  = false;
  _drag.handIdx = null;
  if (_drag.ghostEl) { _drag.ghostEl.remove(); _drag.ghostEl = null; }
  highlightBenchZone(false);
  document.querySelectorAll('.drop-hover').forEach(el => el.classList.remove('drop-hover'));
}

// ---------------------------------------------------------------------------
// PENDING EFFECTS — check after any play action
// ---------------------------------------------------------------------------
function checkPendingEffects() {
  if (state.pendingDragonsEye)   { openDragonsEyeModal();   return; }
  if (state.pendingPolarisPact)  { openPolarisPactModal();  return; }
  if (state.pendingRayActive)    { openRayActiveModal();    return; }
  if (state.pendingExtremeGear)  { openExtremeGearModal();  return; }
  if (state.pendingMightyAttack) { openMightyAttackModal(state.activePlayer); state.pendingMightyAttack = false; return; }
}

// ---------------------------------------------------------------------------
// UNIT ACTIVE DISPATCH
// ---------------------------------------------------------------------------
function handleUnitActive(p, benchIdx) {
  const unit = state.players[p].bench[benchIdx];
  if (!unit) return;
  switch (unit.id) {
    case 'tails':    openTailsModal(p, benchIdx);    break;
    case 'knuckles': openKnucklesModal(p, benchIdx); break;
    case 'amy':      if (amyActive(state, p, benchIdx, log))   { refreshBoard(); winGuard(); } break;
    case 'cream':    openCreamModal(p, benchIdx);    break;
    case 'big':      if (bigActive(state, p, benchIdx, log))   { refreshBoard(); winGuard(); } break;
    case 'silver':   if (silverActive(state, p, benchIdx, log)){ refreshBoard(); winGuard(); } break;
    case 'shadow':   if (shadowActive(state, p, benchIdx, log)){ refreshBoard(); winGuard(); } break;
    case 'mighty':
      if (mightyActive(state, p, benchIdx, log)) {
        refreshBoard();
        openMightyAttackModal(p);
      }
      break;
    case 'rouge':    if (rougeActive(state, p, benchIdx, log)) { refreshBoard(); winGuard(); } break;
    case 'blaze':    if (blazeActive(state, p, benchIdx, log)) { refreshBoard(); winGuard(); } break;
    case 'ray':      if (rayActive(state, p, benchIdx, log))   { refreshBoard(); checkPendingEffects(); } break;
    case 'charmy':   if (charmyActive(state, p, benchIdx, log)){ refreshBoard(); winGuard(); } break;
    case 'espio':    if (espioActive(state, p, benchIdx, log)) { refreshBoard(); winGuard(); } break;
    case 'vector':   if (vectorActive(state, p, benchIdx, log)){ refreshBoard(); winGuard(); } break;
    case 'omega':    openOmegaModal(p, benchIdx);    break;
  }
}

// ---------------------------------------------------------------------------
// MODALS
// ---------------------------------------------------------------------------

function openBlockModal(attackerP, defenderP) {
  const dmg = calcEffectiveDamage(state, attackerP);
  const eligible = state.players[defenderP].bench
    .map((unit, idx) => ({ unit, idx }))
    .filter(({ unit }) => !unit.exhausted);

  document.getElementById('block-desc').innerHTML =
    `Player ${attackerP + 1}'s Leader attacks for <strong style="color:var(--red)">${dmg} damage</strong>.<br>
     Choose a support unit to block, or take the hit directly.`;

  const c = document.getElementById('block-options');
  c.innerHTML = '';
  eligible.forEach(({ unit, idx }) => {
    const willKO = unit.currentHp - dmg <= 0;
    const btn = mkBtn(
      `${unit.name}  (${unit.currentHp}/${unit.hp} HP)${willKO ? '  💀 will KO' : ''}`,
      () => {
        resolveBlock(state, attackerP, defenderP, idx, log);
        closeOverlay('block-overlay');
        refreshBoard(); winGuard();
        if (!_gameOver) enterEndPhase(state, log, emit);
      }
    );
    if (willKO) btn.style.borderColor = 'var(--red)';
    c.appendChild(btn);
  });

  // Store context on Take the Hit button for the static handler
  document.getElementById('btn-take-hit')._attackerP  = attackerP;
  document.getElementById('btn-take-hit')._defenderP  = defenderP;

  showOverlay('block-overlay');
}

function openTailsModal(p, benchIdx) {
  if (discard.length === 0) { addLog('♻ Tails: Discard is empty', 'phase'); return; }
  const c = document.getElementById('tails-discard-options');
  c.innerHTML = '';
  discard.forEach((card, di) => {
    const btn = mkBtn(`${card.name} (${card.type})`, () => {
      tailsActive(state, p, benchIdx, di, log);
      closeOverlay('tails-overlay');
      refreshBoard(); winGuard();
    });
    c.appendChild(btn);
  });
  showOverlay('tails-overlay');
}

function openKnucklesModal(p, benchIdx) {
  const opp = opponent(p);
  if (state.players[opp].bench.length === 0) { addLog('👊 Knuckles: No opponent bench units', 'phase'); return; }
  const c = document.getElementById('target-options');
  c.innerHTML = '';
  document.getElementById('target-title').textContent = 'KNUCKLES: SELECT TARGET';
  document.getElementById('target-desc').textContent  = 'Deal 1 damage to a Support Unit:';
  state.players[opp].bench.forEach((unit, ui) => {
    c.appendChild(mkBtn(`${unit.name} (${unit.currentHp}/${unit.hp} HP)`, () => {
      knucklesActive(state, p, benchIdx, ui, log);
      closeOverlay('target-overlay');
      refreshBoard(); winGuard();
    }));
  });
  showOverlay('target-overlay');
}

function openCreamModal(p, benchIdx) {
  const c = document.getElementById('target-options');
  c.innerHTML = '';
  document.getElementById('target-title').textContent = 'CREAM: HEAL TARGET';
  document.getElementById('target-desc').textContent  = 'Heal 1 HP from any friendly unit:';
  const leader = state.players[p].leader;
  const lBtn = mkBtn(`Leader (${leader.currentHp}/${leader.hp} HP)`, () => {
    creamActive(state, p, benchIdx, 'leader', null, log);
    closeOverlay('target-overlay'); refreshBoard();
  });
  lBtn.disabled = leader.currentHp >= leader.hp;
  c.appendChild(lBtn);
  state.players[p].bench.forEach((unit, ui) => {
    const btn = mkBtn(`${unit.name} (${unit.currentHp}/${unit.hp} HP)`, () => {
      creamActive(state, p, benchIdx, 'bench', ui, log);
      closeOverlay('target-overlay'); refreshBoard();
    });
    btn.disabled = unit.currentHp >= unit.hp;
    c.appendChild(btn);
  });
  showOverlay('target-overlay');
}

function openOmegaModal(p, benchIdx) {
  const opp = opponent(p);
  if (state.players[opp].bench.length === 0) { addLog('🤖 Omega: No opponent bench units', 'phase'); return; }
  const c = document.getElementById('omega-options');
  c.innerHTML = '';
  state.players[opp].bench.forEach((unit, ui) => {
    c.appendChild(mkBtn(`${unit.name} (${unit.currentHp}/${unit.hp} HP)`, () => {
      omegaActive(state, p, benchIdx, ui, log);
      closeOverlay('omega-overlay');
      refreshBoard(); winGuard();
    }));
  });
  showOverlay('omega-overlay');
}

function openMightyAttackModal(p) {
  const opp = opponent(p);
  const c   = document.getElementById('mighty-attack-options');
  c.innerHTML = '';
  // Opponent Leader
  const leader = state.players[opp].leader;
  c.appendChild(mkBtn(`Leader (${leader.currentHp}/${leader.hp} HP)`, () => {
    attackLeader(state, p, opp, log);
    closeOverlay('mighty-attack-overlay');
    refreshBoard(); winGuard();
  }));
  // Opponent bench units
  state.players[opp].bench.forEach((unit, ui) => {
    c.appendChild(mkBtn(`${unit.name} (${unit.currentHp}/${unit.hp} HP)`, () => {
      applyDamageToUnit(state, p, opp, ui, log);
      closeOverlay('mighty-attack-overlay');
      refreshBoard(); winGuard();
    }));
  });
  showOverlay('mighty-attack-overlay');
}

function openSonicModal() {
  const p = state.activePlayer;
  if (state.players[p].hand.length === 0) { addLog('❌ Sonic: hand is empty', 'damage'); return; }
  const c = document.getElementById('sonic-discard-options');
  c.innerHTML = '';
  state.players[p].hand.forEach((card, hi) => {
    c.appendChild(mkBtn(`${card.name} (${card.type})`, () => {
      sonicActive(state, hi, log);
      closeOverlay('sonic-overlay');
      refreshBoard(); winGuard();
    }));
  });
  showOverlay('sonic-overlay');
}

function openDragonsEyeModal() {
  const { playerIdx, cards } = state.pendingDragonsEye;
  const c = document.getElementById('dragons-eye-options');
  c.innerHTML = '';
  cards.forEach((card, si) => {
    c.appendChild(mkBtn(`${card.name} (${card.type})`, () => {
      state.players[playerIdx].deck.splice(si, 1);
      state.players[playerIdx].hand.push(card);
      addLog(`👁 Dragon's Eye: ${card.name} taken into hand`, 'draw');
      state.pendingDragonsEye = null;
      closeOverlay('dragons-eye-overlay');
      refreshBoard();
    }));
  });
  showOverlay('dragons-eye-overlay');
}

function openPolarisPactModal() {
  const { opponentIdx } = state.pendingPolarisPact;
  const hand = state.players[opponentIdx].hand;
  document.getElementById('polaris-pact-desc').textContent =
    `Player ${opponentIdx + 1}: choose 1 card to discard.`;
  const c = document.getElementById('polaris-pact-options');
  c.innerHTML = '';
  if (hand.length === 0) {
    addLog('🌌 Polaris Pact: opponent has no cards', 'phase');
    state.pendingPolarisPact = null;
    closeOverlay('polaris-pact-overlay');
    refreshBoard(); return;
  }
  hand.forEach((card, hi) => {
    c.appendChild(mkBtn(`${card.name} (${card.type})`, () => {
      const disc = state.players[opponentIdx].hand.splice(hi, 1)[0];
      state.players[opponentIdx].discard.push(disc);
      addLog(`🌌 Polaris Pact: P${opponentIdx + 1} discards ${disc.name}`, 'damage');
      state.pendingPolarisPact = null;
      closeOverlay('polaris-pact-overlay');
      refreshBoard();
    }));
  });
  showOverlay('polaris-pact-overlay');
}

function openRayActiveModal() {
  const { playerIdx, cards } = state.pendingRayActive;
  const c = document.getElementById('ray-active-options');
  c.innerHTML = '';
  cards.forEach((card, si) => {
    c.appendChild(mkBtn(`${card.name} (${card.type})`, () => {
      // Remove chosen card from deck at position si, push to discard
      state.players[playerIdx].deck.splice(si, 1);
      state.players[playerIdx].discard.push(card);
      addLog(`🐿 Ray: ${card.name} sent to discard`, 'play');
      // Trigger Rouge passive: deck→discard event
      const rouge = state.players[playerIdx].bench.find(u => u.id === 'rouge' && !u.exhausted);
      if (rouge && state.players[playerIdx].deck.length > 0) {
        const drawn = state.players[playerIdx].deck.shift();
        state.players[playerIdx].hand.push(drawn);
        state.missedDraws[playerIdx] = 0;
        addLog(`🦇 Rouge: draws ${drawn.name} (Ray discard event)`, 'draw');
      }
      state.pendingRayActive = null;
      closeOverlay('ray-active-overlay');
      refreshBoard(); winGuard();
    }));
  });
  showOverlay('ray-active-overlay');
}

function openExtremeGearModal() {
  const { playerIdx } = state.pendingExtremeGear;
  const hand = state.players[playerIdx].hand;
  _extremeGearSelected = new Set();
  const c = document.getElementById('extreme-gear-options');
  c.innerHTML = '';

  const updateCount = () => {
    document.getElementById('extreme-gear-count').textContent =
      `${_extremeGearSelected.size} selected → +${_extremeGearSelected.size} Energy`;
  };

  hand.forEach((card, hi) => {
    const btn = document.createElement('button');
    btn.className   = 'modal-card-btn';
    btn.textContent = `${card.name} (${card.type})`;
    btn.dataset.idx = hi;
    btn.onclick = () => {
      if (_extremeGearSelected.has(hi)) {
        _extremeGearSelected.delete(hi);
        btn.style.borderColor = '';
        btn.style.color = '';
      } else {
        _extremeGearSelected.add(hi);
        btn.style.borderColor = 'var(--gold)';
        btn.style.color = 'var(--gold)';
      }
      updateCount();
    };
    c.appendChild(btn);
  });

  updateCount();
  showOverlay('extreme-gear-overlay');
}

// ---------------------------------------------------------------------------
// PASS SCREEN
// ---------------------------------------------------------------------------
function handlePassContinue() {
  closeOverlay('pass-overlay');
  if (_gameOver) return;
  // Keep onclick pointed at this function for all future passes
  document.getElementById('btn-continue').onclick = handlePassContinue;
  advanceTurn(state, log, emit);
}

// ---------------------------------------------------------------------------
// STATIC BUTTON BINDINGS
// ---------------------------------------------------------------------------
function bindStaticButtons() {
  document.getElementById('btn-end-phase').addEventListener('click', () => {
    if (state.phase === 'main')        enterAttackPhase(state, log, emit);
    else if (state.phase === 'attack') enterEndPhase(state, log, emit);
  });

  document.getElementById('btn-leader-active').addEventListener('click', () => {
    if (state.phase === 'main') openSonicModal();
  });

  // btn-continue is handled exclusively via .onclick in initHandlers
  // to avoid double-firing between addEventListener and the first-turn override.

  document.getElementById('btn-scry-discard').addEventListener('click', () => {
    closeOverlay('scry-overlay');
    engineResolveBigScry(state, true, log, emit);
    refreshBoard();
  });
  document.getElementById('btn-scry-keep').addEventListener('click', () => {
    closeOverlay('scry-overlay');
    engineResolveBigScry(state, false, log, emit);
    refreshBoard();
  });

  document.getElementById('btn-cancel-target').addEventListener('click', () => closeOverlay('target-overlay'));
  document.getElementById('btn-cancel-tails').addEventListener('click',  () => closeOverlay('tails-overlay'));
  document.getElementById('btn-cancel-sonic').addEventListener('click',  () => closeOverlay('sonic-overlay'));
  document.getElementById('btn-cancel-mighty').addEventListener('click', () => closeOverlay('mighty-attack-overlay'));
  document.getElementById('btn-cancel-omega').addEventListener('click',  () => closeOverlay('omega-overlay'));

  document.getElementById('btn-take-hit').addEventListener('click', () => {
    const btn = document.getElementById('btn-take-hit');
    const ap = btn._attackerP, dp = btn._defenderP;
    closeOverlay('block-overlay');
    attackLeader(state, ap, dp, log);
    winGuard();
    if (!_gameOver) enterEndPhase(state, log, emit);
  });

  document.getElementById('btn-extreme-gear-cancel').addEventListener('click', () => {
    state.pendingExtremeGear = null;
    _extremeGearSelected = new Set();
    closeOverlay('extreme-gear-overlay');
    refreshBoard();
  });

  document.getElementById('btn-extreme-gear-confirm').addEventListener('click', () => {
    if (_extremeGearSelected.size === 0) {
      state.pendingExtremeGear = null;
      closeOverlay('extreme-gear-overlay');
      refreshBoard(); return;
    }
    resolveExtremeGear(state, [..._extremeGearSelected], log);
    _extremeGearSelected = new Set();
    closeOverlay('extreme-gear-overlay');
    refreshBoard(); winGuard();
  });
}

// ---------------------------------------------------------------------------
// Helper: make a modal card button
// ---------------------------------------------------------------------------
function mkBtn(label, onClick) {
  const btn = document.createElement('button');
  btn.className   = 'modal-card-btn';
  btn.textContent = label;
  btn.onclick     = onClick;
  return btn;
}

// ---------------------------------------------------------------------------
// PUBLIC INIT
// ---------------------------------------------------------------------------
export function initHandlers(gameState) {
  state = gameState;
  bindStaticButtons();

  const firstP = state.activePlayer + 1;
  document.getElementById('pass-title').textContent = `PLAYER ${firstP} GOES FIRST`;
  document.getElementById('pass-msg').textContent   =
    `Coin flip result: Player ${firstP} starts! Get ready.`;

  const btn = document.getElementById('btn-continue');
  btn.onclick = function onFirstContinue() {
    closeOverlay('pass-overlay');
    btn.onclick = handlePassContinue;
    startTurn(state, log, emit);
    refreshBoard();
  };

  render(state);
  showOverlay('pass-overlay');
}
