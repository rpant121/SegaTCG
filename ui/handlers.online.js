/**
 * ONLINE HANDLERS — ui/handlers.online.js
 *
 * Drop-in replacement for ui/handlers.js for the online build.
 * Instead of calling engine functions directly, every player action
 * is sent to the server as:
 *
 *   socket.emit('action', { roomCode, type, payload })
 *
 * The server validates, mutates state, and broadcasts back:
 *
 *   socket.on('state_update', ({ state, logEntries, winner }) => …)
 *
 * The renderer (ui/renderer.js) is UNCHANGED — it still just reads state.
 *
 * HOW TO ACTIVATE
 * ───────────────
 * In index.html, swap the script tag from:
 *   <script type="module" src="main.js"></script>
 * to:
 *   <script type="module" src="main.online.js"></script>
 *
 * In main.online.js (provided separately), the lobby flow replaces the
 * sessionStorage deck-load and calls initOnlineHandlers(socket, roomCode, playerIdx)
 * instead of initHandlers(state).
 */

import {
  render, addLog, showOverlay, closeOverlay,
  showScryModal, showPassModal, showWinModal,
  renderLeader, renderBench, renderHand, openCardInspect,
} from './renderer.js';
import { opponent } from '../engine/state.js';
import { calcEffectiveDamage } from '../engine/combat.js';
import { canAfford, getActiveCost, hasUsedActiveThisTurn } from '../engine/actions.js';

// ---------------------------------------------------------------------------
// Module-level state (set once by initOnlineHandlers)
// ---------------------------------------------------------------------------
let socket      = null;
let roomCode    = null;
let myPlayerIdx = null;  // 0 or 1
let state       = null;
let _gameOver   = false;

// Extreme Gear multi-select tracker
let _extremeGearSelected = new Set();

// ---------------------------------------------------------------------------
// Primary public init — called after lobby resolves
// ---------------------------------------------------------------------------
export function initOnlineHandlers(_socket, _roomCode, _playerIdx) {
  socket      = _socket;
  roomCode    = _roomCode;
  myPlayerIdx = _playerIdx;

  bindStaticButtons();
  bindSocketListeners();

  // Show waiting screen until 'game_start' arrives (already handled in main.online.js)
}

// ---------------------------------------------------------------------------
// Send an action to the server
// ---------------------------------------------------------------------------
function act(type, payload = {}) {
  if (_gameOver) return;
  socket.emit('action', { roomCode, type, payload });
}

// ---------------------------------------------------------------------------
// Socket → UI listeners
// ---------------------------------------------------------------------------
function bindSocketListeners() {

  socket.on('state_update', ({ state: newState, logEntries, winner, pendingBlock }) => {
    state = newState;

    // Replay log entries from server
    if (Array.isArray(logEntries)) {
      logEntries.forEach(({ msg, type }) => addLog(msg, type));
    }

    // Handle win
    if (winner !== undefined && !_gameOver) {
      _gameOver = true;
      showWinModal(opponent(winner), state.turn);
      return;
    }

    // Dismiss waiting overlay
    hideWaitingOverlay();

    // Reset Done Setup button when leaving setup
    if (state.phase !== 'setup') {
      const btn = document.getElementById('btn-end-phase');
      if (btn && btn.dataset.setupReady) { delete btn.dataset.setupReady; btn.disabled = false; }
    }

    // Genesis glow
    if (state._genesisPlayedBy !== undefined) triggerGenesisGlow(state._genesisPlayedBy);

    // Setup phase
    if (state.phase === 'setup') { refreshBoard(); return; }

    // End phase - auto advance
    if (state.phase === 'end') {
      if (state.activePlayer === myPlayerIdx) {
        refreshBoard();
        setTimeout(() => act('ADVANCE_TURN'), 800);
      } else {
        showWaitingOverlay(`Waiting for Player ${state.activePlayer + 1} to finish their turn…`);
        refreshBoard();
      }
      return;
    }

    // Pending block
    if (pendingBlock) {
      if (pendingBlock.defenderP === myPlayerIdx) {
        refreshBoard();
        openBlockModal(pendingBlock.attackerP, pendingBlock.defenderP);
        return;
      } else {
        showWaitingOverlay('Opponent is choosing whether to block…');
        refreshBoard();
        return;
      }
    }

    // Pending Big scry: if we are the active player
    if (state.pendingBigScry && state.pendingBigScry.playerIdx === myPlayerIdx) {
      showScryModal(state.pendingBigScry.card);
    }

    // Pending async modals (only for active player)
    if (myPlayerIdx === state.activePlayer) {
      checkPendingEffects();
    }

    refreshBoard();
  });

  socket.on('action_error', ({ message }) => {
    addLog(`❌ ${message}`, 'damage');
  });

  socket.on('opponent_disconnected', ({ message }) => {
    addLog(`⚠️  ${message}`, 'damage');
    showWaitingOverlay(message);
  });

  socket.on('setup_turn', () => {
    // Server told us it's our setup turn (Player 2 setup)
    refreshBoard();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function refreshBoard() {
  if (!state) return;
  render(state);
  if (myPlayerIdx !== null) {
    const opp = opponent(myPlayerIdx);
    renderHand(`p${myPlayerIdx + 1}-hand`, state, myPlayerIdx, myPlayerIdx);
    renderHand(`p${opp + 1}-hand`, state, opp, -1);
  }
  renderStatusEffects(state);
  const myLabel  = document.getElementById(`p${myPlayerIdx + 1}-label`);
  const oppLabel = document.getElementById(`p${opponent(myPlayerIdx) + 1}-label`);
  if (myLabel)  myLabel.textContent  = `YOU (P${myPlayerIdx + 1})`;
  if (oppLabel) oppLabel.textContent = `OPP (P${opponent(myPlayerIdx) + 1})`;
  attachBoardHandlers();
}

function showWaitingOverlay(msg) {
  document.getElementById('pass-title').textContent = 'WAITING…';
  document.getElementById('pass-msg').textContent   = msg;
  document.getElementById('btn-continue').style.display = 'none';
  showOverlay('pass-overlay');
}

function hideWaitingOverlay() {
  document.getElementById('btn-continue').style.display = '';
  closeOverlay('pass-overlay');
}

function isMyTurn() {
  return state && state.activePlayer === myPlayerIdx;
}

// ---------------------------------------------------------------------------
// Board handler attachment — wires clicks on the rendered DOM to act()
// ---------------------------------------------------------------------------
function attachBoardHandlers() {
  if (!state) return;

  const p   = myPlayerIdx;
  const opp = opponent(p);

  // ── Not my turn — nothing interactive (except pending block handled separately) ──
  if (!isMyTurn() && state.phase !== 'setup') return;

  // ── Setup phase ─────────────────────────────────────────────────────────
  if (state.phase === 'setup') {
    const sp = state._setupPlayer ?? 0;
    if (sp !== myPlayerIdx) return; // not our setup turn

    // Unit cards in hand are drag-deployable (re-use same drag logic wired below)
    const setupHandEls = renderHand(`p${p + 1}-hand`, state, p, p);
    setupHandEls.forEach(({ div, idx, card }) => {
      if (card && !card.hidden && card.type === 'Unit') attachDragToHandCard(div, idx, p);
    });
    attachBenchDropZoneOnce(`p${p + 1}-bench`, p);

    document.getElementById('btn-end-phase').textContent = 'Done Setup →';
    document.getElementById('btn-end-phase').disabled = false;
    document.getElementById('btn-end-phase').onclick = () => {
      document.getElementById('btn-end-phase').onclick = null;
      act('SETUP_DONE');
    };
    return;
  }

  // ── Hand cards: click to play (non-unit), drag to deploy (unit) ──────────
  const handEls = renderHand(`p${p + 1}-hand`, state, p);
  handEls.forEach(({ div, idx, card }) => {
    if (card.type === 'Unit') {
      attachDragToHandCard(div, idx, p);
    } else {
      div.onclick = () => {
        if (state.phase === 'main') act('PLAY_CARD', { handIdx: idx });
      };
    }
    div.addEventListener('contextmenu', e => {
      e.preventDefault();
      openCardInspect(card, null);
    });
  });

  attachBenchDropZoneOnce(`p${p + 1}-bench`, p);

  // ── Own bench: click for active ability ──────────────────────────────────
  const ownBenchEls = renderBench(`p${p + 1}-bench`, state, p);
  ownBenchEls.forEach(({ div, idx }) => {
    const unit      = state.players[p].bench[idx];
    const cost      = getActiveCost(state, unit);
    const canActivate = state.phase === 'main'
      && !unit.exhausted
      && canAfford(state, cost)
      && !(unit.id === 'rouge' && (state.rougeUsedThisTurn ?? [false, false])[p])
      && !hasUsedActiveThisTurn(state, unit);

    if (canActivate) div.onclick = () => handleUnitActive(p, idx);
    div.addEventListener('contextmenu', e => {
      e.preventDefault();
      openCardInspect(unit, canActivate ? () => handleUnitActive(p, idx) : null);
    });
  });

  // ── Opponent bench: attack targets ───────────────────────────────────────
  const oppBenchEls = renderBench(`p${opp + 1}-bench`, state, opp);
  oppBenchEls.forEach(({ div, idx }) => {
    const unit = state.players[opp].bench[idx];
    if (state.phase === 'attack') {
      div.onclick = () => act('ATTACK', { targetType: 'unit', targetBenchIdx: idx });
    }
    if (unit) {
      div.addEventListener('contextmenu', e => {
        e.preventDefault();
        openCardInspect(unit, null);
      });
    }
  });

  // ── Opponent leader: attack target ────────────────────────────────────────
  const oppLeaderDiv = renderLeader(`p${opp + 1}-leader-zone`, state, opp);
  if (state.phase === 'attack') {
    oppLeaderDiv.onclick = () => act('ATTACK', { targetType: 'leader' });
    // Block modal is shown when server responds with pendingBlock (see state_update handler)
  }
  oppLeaderDiv.addEventListener('contextmenu', e => {
    e.preventDefault();
    openCardInspect(state.players[opp].leader, null);
  });

  // ── Own leader: Sonic active ──────────────────────────────────────────────
  const ownLeaderDiv = renderLeader(`p${p + 1}-leader-zone`, state, p);
  if (state.phase === 'main') {
    const canUse = canAfford(state, state.players[p].leader.activeCost)
      && state.players[p].hand.length > 0
      && !(state.leaderUsedThisTurn ?? [false, false])[p];
    ownLeaderDiv.style.cursor = canUse ? 'pointer' : 'default';
    if (canUse) ownLeaderDiv.onclick = () => openSonicModal();
    ownLeaderDiv.addEventListener('contextmenu', e => {
      e.preventDefault();
      openCardInspect(state.players[p].leader, canUse ? openSonicModal : null);
    });
  }
}

// ---------------------------------------------------------------------------
// Drag-and-drop deploy (units from hand → bench)
// ---------------------------------------------------------------------------
let _drag = { active: false, handIdx: null, ghostEl: null };

function attachDragToHandCard(div, handIdx, p) {
  div.draggable = true;
  div.addEventListener('dragstart', e => {
    _drag = { active: true, handIdx, ghostEl: null };
    e.dataTransfer.effectAllowed = 'move';
    highlightBenchZone(true, p);
  });
  div.addEventListener('dragend', () => endDrag(p));
}

function attachBenchDropZone(benchId, p) {
  const el = document.getElementById(benchId);
  if (!el) return;
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drop-hover'); });
  el.addEventListener('dragleave', () => el.classList.remove('drop-hover'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drop-hover');
    if (_drag.active) { act('PLAY_CARD', { handIdx: _drag.handIdx }); endDrag(p); }
  });
}

function attachBenchDropZoneOnce(benchId, p) {
  const el = document.getElementById(benchId);
  if (!el || el.dataset.dropWired === '1') return;
  el.dataset.dropWired = '1';
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drop-hover'); });
  el.addEventListener('dragleave', () => el.classList.remove('drop-hover'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drop-hover');
    if (_drag.active) { act('PLAY_CARD', { handIdx: _drag.handIdx }); endDrag(p); }
  });
}

function triggerGenesisGlow(playerIdx) {
  const zones = playerIdx === 0
    ? ['p1-hand', 'p1-bench', 'p1-leader-row']
    : ['p2-hand', 'p2-bench', 'p2-leader-row'];
  zones.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('genesis-glow');
    setTimeout(() => el.classList.remove('genesis-glow'), 1800);
  });
}

function renderStatusEffects(state) {
  const el = document.getElementById('status-effects-panel');
  if (!el || !state) return;
  const p   = myPlayerIdx ?? 0;
  const opp = opponent(p);
  const effects = [];
  if (state.activeStage) effects.push({ label: 'Stage: ' + state.activeStage.name, cls: 'status-stage' });
  if (state.shieldActive && state.shieldActive[p])   effects.push({ label: 'Your Shield Active', cls: 'status-positive' });
  if (state.shieldActive && state.shieldActive[opp]) effects.push({ label: 'Opponent Shield Active', cls: 'status-negative' });
  if ((state.chaosEmeraldBuff?.[p] ?? 0) > 0)   effects.push({ label: '+' + state.chaosEmeraldBuff[p] + ' Chaos Emerald', cls: 'status-positive' });
  if ((state.chaosEmeraldBuff?.[opp] ?? 0) > 0)  effects.push({ label: 'Opp +' + state.chaosEmeraldBuff[opp] + ' Emerald', cls: 'status-negative' });
  if ((state.powerGloveBuff?.[p] ?? 0) > 0)      effects.push({ label: '+' + state.powerGloveBuff[p] + ' Power Glove', cls: 'status-positive' });
  if ((state.powerGloveBuff?.[opp] ?? 0) > 0)    effects.push({ label: 'Opp +' + state.powerGloveBuff[opp] + ' Glove', cls: 'status-negative' });
  if (state.masterEmeraldActive) effects.push({ label: 'Master Emerald Active', cls: 'status-positive' });
  const exhausted = (state.players[p].bench || []).filter(u => u.exhausted);
  if (exhausted.length) effects.push({ label: 'Exhausted: ' + exhausted.map(u => u.name).join(', '), cls: 'status-warn' });
  el.innerHTML = effects.length
    ? effects.map(e => '<div class="status-tag ' + e.cls + '">' + e.label + '</div>').join('')
    : '<div class="status-tag status-none">No active effects</div>';
}

function highlightBenchZone(on, p) {
  const el = document.getElementById(`p${p + 1}-bench`);
  if (el) el.classList.toggle('drop-target-active', on);
}

function endDrag(p) {
  _drag = { active: false, handIdx: null, ghostEl: null };
  highlightBenchZone(false, p);
  document.querySelectorAll('.drop-hover').forEach(el => el.classList.remove('drop-hover'));
}

// ---------------------------------------------------------------------------
// Pending-effect modal router (mirrors local handlers.js)
// ---------------------------------------------------------------------------
function checkPendingEffects() {
  if (state.pendingDragonsEye)   { openDragonsEyeModal();   return; }
  if (state.pendingPolarisPact)  { openPolarisPactModal();  return; }
  if (state.pendingRayActive)    { openRayActiveModal();    return; }
  if (state.pendingExtremeGear)  { openExtremeGearModal();  return; }
  if (state.pendingMightyAttack) { openMightyAttackModal(myPlayerIdx); state.pendingMightyAttack = false; return; }
}

// ---------------------------------------------------------------------------
// Unit active dispatch - confirm first
// ---------------------------------------------------------------------------
function handleUnitActive(p, benchIdx) {
  const unit = state.players[p].bench[benchIdx];
  if (!unit) return;
  openUnitActiveConfirm(unit, benchIdx, p);
}

function openUnitActiveConfirm(unit, benchIdx, p) {
  const cost = getActiveCost(state, unit);
  const overlay = document.getElementById('unit-confirm-overlay');
  if (!overlay) { fireUnitActive(p, benchIdx); return; }
  document.getElementById('unit-confirm-name').textContent = unit.name;
  document.getElementById('unit-confirm-desc').textContent = unit.activeDesc ?? '';
  document.getElementById('unit-confirm-cost').textContent = cost + ' Energy';
  document.getElementById('btn-unit-confirm-yes').onclick = () => {
    closeOverlay('unit-confirm-overlay');
    fireUnitActive(p, benchIdx);
  };
  document.getElementById('btn-unit-confirm-cancel').onclick = () => closeOverlay('unit-confirm-overlay');
  overlay.onclick = (e) => { if (e.target === overlay) closeOverlay('unit-confirm-overlay'); };
  showOverlay('unit-confirm-overlay');
}

function fireUnitActive(p, benchIdx) {
  const unit = state.players[p].bench[benchIdx];
  if (!unit) return;
  switch (unit.id) {
    case 'tails':    openTailsModal(p, benchIdx);       break;
    case 'knuckles': openKnucklesModal(p, benchIdx);    break;
    case 'cream':    openCreamModal(p, benchIdx);       break;
    case 'silver':   openSilverBounceModal(p, benchIdx); break;
    default:         act('USE_UNIT_ACTIVE', { benchIdx }); break;
  }
}

// ---------------------------------------------------------------------------
// Static button bindings
// ---------------------------------------------------------------------------
function bindStaticButtons() {

  // Phase advance button
  document.getElementById('btn-end-phase').addEventListener('click', () => {
    if (!state) return;
    if (state.phase === 'setup') {
      const btn = document.getElementById('btn-end-phase');
      if (btn.dataset.setupReady === '1') return;
      btn.textContent = 'Waiting for opponent…';
      btn.disabled = true;
      btn.dataset.setupReady = '1';
      act('SETUP_DONE');
      return;
    }
    if (!isMyTurn()) return;
    if (state.phase === 'main')        act('ENTER_ATTACK_PHASE');
    else if (state.phase === 'attack') act('SKIP_ATTACK');
  });

  // Leader active button (opens Sonic modal)
  document.getElementById('btn-leader-active').addEventListener('click', () => {
    if (isMyTurn() && state?.phase === 'main') openSonicModal();
  });

  // Pass/continue button — advances turn after end phase
  document.getElementById('btn-continue').addEventListener('click', () => {
    closeOverlay('pass-overlay');
    document.getElementById('btn-continue').style.display = '';
    if (_gameOver || !state) return;
    if (state.phase === 'end' && isMyTurn()) {
      act('ADVANCE_TURN');
    }
    // If not our turn, do nothing (opponent drives advance)
  });

  // Scry buttons
  document.getElementById('btn-scry-discard').addEventListener('click', () => {
    closeOverlay('scry-overlay');
    act('RESOLVE_BIG_SCRY', { shouldDiscard: true });
  });
  document.getElementById('btn-scry-keep').addEventListener('click', () => {
    closeOverlay('scry-overlay');
    act('RESOLVE_BIG_SCRY', { shouldDiscard: false });
  });

  // Cancel buttons for modal overlays
  document.getElementById('btn-cancel-target').addEventListener('click', () => closeOverlay('target-overlay'));
  document.getElementById('btn-cancel-tails').addEventListener('click',  () => closeOverlay('tails-overlay'));
  document.getElementById('btn-cancel-sonic').addEventListener('click',  () => closeOverlay('sonic-overlay'));
  document.getElementById('btn-cancel-mighty').addEventListener('click', () => closeOverlay('mighty-attack-overlay'));

  // Block: take the hit
  document.getElementById('btn-take-hit').addEventListener('click', () => {
    closeOverlay('block-overlay');
    act('RESOLVE_BLOCK', { blockBenchIdx: null });
  });

  // Extreme Gear
  document.getElementById('btn-extreme-gear-cancel').addEventListener('click', () => {
    _extremeGearSelected = new Set();
    act('RESOLVE_EXTREME_GEAR', { handIndices: [] });
    closeOverlay('extreme-gear-overlay');
  });
  document.getElementById('btn-extreme-gear-confirm').addEventListener('click', () => {
    act('RESOLVE_EXTREME_GEAR', { handIndices: [..._extremeGearSelected] });
    _extremeGearSelected = new Set();
    closeOverlay('extreme-gear-overlay');
  });
}

// ---------------------------------------------------------------------------
// MODALS — mirror local handlers.js but call act() instead of engine fns
// ---------------------------------------------------------------------------

function mkBtn(label, onClick) {
  const btn = document.createElement('button');
  btn.className   = 'modal-card-btn';
  btn.textContent = label;
  btn.onclick     = onClick;
  return btn;
}

// ── Block ────────────────────────────────────────────────────────────────────
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
      `${unit.name}  (${unit.currentHp}/${unit.hp} HP)${willKO ? ' 💀 will KO' : ''}`,
      () => {
        closeOverlay('block-overlay');
        act('RESOLVE_BLOCK', { blockBenchIdx: idx });
      }
    );
    if (willKO) btn.style.borderColor = 'var(--red)';
    c.appendChild(btn);
  });

  showOverlay('block-overlay');
}

// ── Sonic ────────────────────────────────────────────────────────────────────
function openSonicModal() {
  const p = myPlayerIdx;
  if (state.players[p].hand.length === 0) { addLog('❌ Sonic: hand is empty', 'damage'); return; }
  const c = document.getElementById('sonic-discard-options');
  c.innerHTML = '';
  state.players[p].hand.forEach((card, hi) => {
    c.appendChild(mkBtn(`${card.name} (${card.type})`, () => {
      act('USE_LEADER_ACTIVE', { handIdx: hi });
      closeOverlay('sonic-overlay');
    }));
  });
  showOverlay('sonic-overlay');
}

// ── Tails ────────────────────────────────────────────────────────────────────
function openTailsModal(p, benchIdx) {
  const discard = state.players[p].discard;
  const playable = discard.map((card, di) => ({ card, di })).filter(({ card }) => card.type !== 'Stage');
  if (playable.length === 0) { addLog('♻ Tails: No playable cards in discard', 'phase'); return; }
  const c = document.getElementById('tails-discard-options');
  c.innerHTML = '';
  playable.forEach(({ card, di }) => {
    c.appendChild(mkBtn(`${card.name} (${card.type})`, () => {
      act('USE_UNIT_ACTIVE', { benchIdx, discardIdx: di });
      closeOverlay('tails-overlay');
    }));
  });
  showOverlay('tails-overlay');
}

// ── Knuckles ──────────────────────────────────────────────────────────────────
function openKnucklesModal(p, benchIdx) {
  const opp = opponent(p);
  if (state.players[opp].bench.length === 0) { addLog('👊 Knuckles: No opponent bench units', 'phase'); return; }
  const c = document.getElementById('target-options');
  c.innerHTML = '';
  document.getElementById('target-title').textContent = 'KNUCKLES: SELECT TARGET';
  document.getElementById('target-desc').textContent  = 'Deal 1 damage to a Support Unit:';
  state.players[opp].bench.forEach((unit, ui) => {
    c.appendChild(mkBtn(`${unit.name} (${unit.currentHp}/${unit.hp} HP)`, () => {
      act('USE_UNIT_ACTIVE', { benchIdx, targetBenchIdx: ui });
      closeOverlay('target-overlay');
    }));
  });
  showOverlay('target-overlay');
}

// ── Cream ─────────────────────────────────────────────────────────────────────
function openCreamModal(p, benchIdx) {
  const c = document.getElementById('target-options');
  c.innerHTML = '';
  document.getElementById('target-title').textContent = 'CREAM: HEAL TARGET';
  document.getElementById('target-desc').textContent  = 'Heal 1 HP from any friendly unit:';
  const leader = state.players[p].leader;
  const lBtn   = mkBtn(`Leader (${leader.currentHp}/${leader.hp} HP)`, () => {
    act('USE_UNIT_ACTIVE', { benchIdx, targetType: 'leader', targetBenchIdx: null });
    closeOverlay('target-overlay');
  });
  lBtn.disabled = leader.currentHp >= leader.hp;
  c.appendChild(lBtn);
  state.players[p].bench.forEach((unit, ui) => {
    const btn = mkBtn(`${unit.name} (${unit.currentHp}/${unit.hp} HP)`, () => {
      act('USE_UNIT_ACTIVE', { benchIdx, targetType: 'bench', targetBenchIdx: ui });
      closeOverlay('target-overlay');
    });
    btn.disabled = unit.currentHp >= unit.hp;
    c.appendChild(btn);
  });
  showOverlay('target-overlay');
}

// ── Silver ────────────────────────────────────────────────────────────────────
function openSilverBounceModal(p, benchIdx) {
  const bench = state.players[p].bench;
  const c = document.getElementById('target-options');
  c.innerHTML = '';
  document.getElementById('target-title').textContent = 'SILVER: BOUNCE TARGET';
  document.getElementById('target-desc').textContent  = 'Return a bench unit to your hand:';
  bench.forEach((unit, ui) => {
    c.appendChild(mkBtn(`${unit.name} (${unit.currentHp}/${unit.hp} HP)`, () => {
      act('USE_UNIT_ACTIVE', { benchIdx, targetBenchIdx: ui });
      closeOverlay('target-overlay');
    }));
  });
  showOverlay('target-overlay');
}

// ── Mighty second attack ───────────────────────────────────────────────────────
function openMightyAttackModal(p) {
  const opp = opponent(p);
  const c   = document.getElementById('mighty-attack-options');
  c.innerHTML = '';
  const leader = state.players[opp].leader;
  c.appendChild(mkBtn(`Leader (${leader.currentHp}/${leader.hp} HP)`, () => {
    act('ATTACK', { targetType: 'leader' });
    closeOverlay('mighty-attack-overlay');
  }));
  state.players[opp].bench.forEach((unit, ui) => {
    c.appendChild(mkBtn(`${unit.name} (${unit.currentHp}/${unit.hp} HP)`, () => {
      act('ATTACK', { targetType: 'unit', targetBenchIdx: ui });
      closeOverlay('mighty-attack-overlay');
    }));
  });
  showOverlay('mighty-attack-overlay');
}

// ── Dragon's Eye ──────────────────────────────────────────────────────────────
function openDragonsEyeModal() {
  const { cards } = state.pendingDragonsEye;
  const c = document.getElementById('dragons-eye-options');
  c.innerHTML = '';
  cards.forEach((card, si) => {
    c.appendChild(mkBtn(`${card.name} (${card.type})`, () => {
      act('RESOLVE_DRAGONS_EYE', { deckIdx: si });
      closeOverlay('dragons-eye-overlay');
    }));
  });
  showOverlay('dragons-eye-overlay');
}

// ── Polaris Pact ──────────────────────────────────────────────────────────────
function openPolarisPactModal() {
  const { opponentIdx } = state.pendingPolarisPact;
  // Only the TARGET player fills this in
  if (myPlayerIdx !== opponentIdx) return; // active player waits

  const hand = state.players[opponentIdx].hand;
  document.getElementById('polaris-pact-desc').textContent =
    `You must discard 1 card (Polaris Pact).`;
  const c = document.getElementById('polaris-pact-options');
  c.innerHTML = '';
  if (hand.length === 0) {
    addLog('🌌 Polaris Pact: no cards to discard', 'phase');
    act('RESOLVE_POLARIS_PACT', { targetHandIdx: -1 });
    return;
  }
  hand.forEach((card, hi) => {
    c.appendChild(mkBtn(`${card.name} (${card.type})`, () => {
      act('RESOLVE_POLARIS_PACT', { targetHandIdx: hi });
      closeOverlay('polaris-pact-overlay');
    }));
  });
  showOverlay('polaris-pact-overlay');
}

// ── Ray active ────────────────────────────────────────────────────────────────
function openRayActiveModal() {
  const { cards } = state.pendingRayActive;
  const c = document.getElementById('ray-active-options');
  c.innerHTML = '';
  cards.forEach((card, si) => {
    c.appendChild(mkBtn(`${card.name} (${card.type})`, () => {
      act('RESOLVE_RAY', { deckIdx: si });
      closeOverlay('ray-active-overlay');
    }));
  });
  showOverlay('ray-active-overlay');
}

// ── Extreme Gear ──────────────────────────────────────────────────────────────
function openExtremeGearModal() {
  const { playerIdx: pi } = state.pendingExtremeGear;
  const hand = state.players[pi].hand;
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