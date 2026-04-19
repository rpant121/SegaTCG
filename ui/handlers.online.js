/**
 * ONLINE HANDLERS -- ui/handlers.online.js
 * Every player action is sent to the server as act(type, payload).
 * The server validates, mutates state, and broadcasts sanitized state back.
 */

import {
  render, addLog, showOverlay, closeOverlay,
  showScryModal, showWinModal,
  renderLeader, renderBench, renderHand, openCardInspect,
  buildCardEl,
} from './renderer.js';
import { opponent } from '../engine/state.js';
import { calcEffectiveDamage } from '../engine/combat.js';
import { canAfford, getActiveCost, hasUsedActiveThisTurn } from '../engine/actions.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let socket      = null;
let roomCode    = null;
let myPlayerIdx = null;
let state       = null;
let _gameOver   = false;
let _extremeGearSelected = new Set();

// ---------------------------------------------------------------------------
// Public init
// ---------------------------------------------------------------------------
export function initOnlineHandlers(_socket, _roomCode, _playerIdx) {
  socket      = _socket;
  roomCode    = _roomCode;
  myPlayerIdx = _playerIdx;
  bindStaticButtons();
  bindSocketListeners();
}

function act(type, payload = {}) {
  if (_gameOver) return;
  socket.emit('action', { roomCode, type, payload });
}

// ---------------------------------------------------------------------------
// Socket listeners
// ---------------------------------------------------------------------------
function bindSocketListeners() {

  socket.on('state_update', ({ state: newState, logEntries, winner, pendingBlock }) => {
    state = newState;

    // Always dismiss any waiting/pass overlay when fresh state arrives.
    // Paths that need the overlay (end-phase wait, block wait) re-show it below.
    closeOverlay('pass-overlay');
    document.getElementById('btn-continue').style.display = '';

    if (Array.isArray(logEntries)) logEntries.forEach(({ msg, type }) => addLog(msg, type));

    if (winner !== undefined && !_gameOver) {
      _gameOver = true;
      showWinModal(opponent(winner), state.turn);
      return;
    }

    // Reset Done Setup button when leaving setup
    if (state.phase !== 'setup') {
      const btn = document.getElementById('btn-end-phase');
      if (btn && btn.dataset.setupReady) { delete btn.dataset.setupReady; btn.disabled = false; }
    }

    if (state._genesisPlayedBy !== undefined) triggerGenesisGlow(state._genesisPlayedBy);

    if (state.phase === 'setup') { refreshBoard(); return; }

    if (state.phase === 'end') {
      if (state.activePlayer === myPlayerIdx) {
        // Don't render the transient end-phase board; just advance the turn.
        setTimeout(() => act('ADVANCE_TURN'), 400);
      } else {
        // Render the board state, THEN place the waiting overlay on top.
        // If overlay is shown first, refreshBoard would immediately clear it.
        refreshBoard();
        showWaitingOverlay('Waiting for Player ' + (state.activePlayer + 1) + ' to finish their turn...');
      }
      return;
    }

    if (pendingBlock) {
      if (pendingBlock.defenderP === myPlayerIdx) {
        refreshBoard(); openBlockModal(pendingBlock.attackerP, pendingBlock.defenderP); return;
      } else {
        refreshBoard();
        showWaitingOverlay('Opponent is choosing whether to block...');
        return;
      }
    }

    if (state.pendingBigScry && state.pendingBigScry.playerIdx === myPlayerIdx) {
      showScryModal(state.pendingBigScry.card);
      // Update modal title based on who triggered the scry
      const scryTitle = document.querySelector('#scry-overlay h2');
      if (scryTitle) scryTitle.textContent = state.pendingBigScry.isFutaba ? "FUTABA'S SCRY" : "BIG'S SCRY";
    }

    if (myPlayerIdx === state.activePlayer) checkPendingEffects();

    refreshBoard();
  });

  socket.on('action_error',         ({ message }) => addLog('! ' + message, 'damage'));
  socket.on('opponent_disconnected',({ message }) => { addLog(message, 'damage'); showWaitingOverlay(message); });
  socket.on('setup_turn', () => refreshBoard());
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------
function refreshBoard() {
  if (!state) return;
  render(state);
  if (myPlayerIdx !== null) {
    const opp = opponent(myPlayerIdx);
    renderHand('p' + (myPlayerIdx + 1) + '-hand', state, myPlayerIdx, myPlayerIdx);
    renderHand('p' + (opp + 1) + '-hand', state, opp, -1);
    if (state.phase === 'setup') {
      const oppBenchEl = document.getElementById('p' + (opp + 1) + '-bench');
      if (oppBenchEl) {
        oppBenchEl.innerHTML = '';
        const count = (state.players[opp].bench || []).length;
        if (count === 0) {
          const ph = document.createElement('div');
          ph.style.cssText = 'opacity:0.25;font-size:9px;color:#6677aa;text-align:center;padding:20px;font-family:var(--font-mono);';
          ph.textContent = 'Opponent is setting up...';
          oppBenchEl.appendChild(ph);
        } else {
          for (let i = 0; i < count; i++) {
            const fd = document.createElement('div');
            fd.className = 'bench-unit';
            fd.style.cssText = 'background:repeating-linear-gradient(45deg,#0a1a2e,#0a1a2e 4px,#0d2040 4px,#0d2040 8px);cursor:default;opacity:0.7;';
            fd.innerHTML = '<div style="font-size:18px;text-align:center;padding:12px;color:#445566;">?</div>';
            oppBenchEl.appendChild(fd);
          }
        }
      }
    }
  }
  renderStatusEffects(state);
  const myLabel  = document.getElementById('p' + (myPlayerIdx + 1) + '-label');
  const oppLabel = document.getElementById('p' + (opponent(myPlayerIdx) + 1) + '-label');
  if (myLabel)  myLabel.textContent  = 'YOU (P' + (myPlayerIdx + 1) + ')';
  if (oppLabel) oppLabel.textContent = 'OPP (P' + (opponent(myPlayerIdx) + 1) + ')';
  attachBoardHandlers();
}

function showWaitingOverlay(msg) {
  document.getElementById('pass-title').textContent = 'WAITING...';
  document.getElementById('pass-msg').textContent   = msg;
  document.getElementById('btn-continue').style.display = 'none';
  showOverlay('pass-overlay');
}

function isMyTurn() { return state && state.activePlayer === myPlayerIdx; }

// ---------------------------------------------------------------------------
// Board handlers -- attach events to ALREADY-RENDERED DOM only.
// ---------------------------------------------------------------------------
function attachBoardHandlers() {
  if (!state) return;
  const p   = myPlayerIdx;
  const opp = opponent(p);

  // SETUP
  if (state.phase === 'setup') {
    if (state._setupPlayer !== undefined && state._setupPlayer !== myPlayerIdx) return;

    const ownHandEl = document.getElementById('p' + (p + 1) + '-hand');
    if (ownHandEl) {
      ownHandEl.querySelectorAll('.card').forEach((div, i) => {
        const card = state.players[p].hand[i];
        if (!card || card.hidden) return;
        if (card.type === 'Unit') {
          attachDragToHandCard(div, i, p);
          // Also allow click-to-deploy during setup (not just drag)
          div.style.cursor = 'pointer';
          div.onclick = () => {
            if (state.players[p].bench.length >= 3) { addLog('Bench is full', 'damage'); return; }
            act('PLAY_CARD', { handIdx: i });
          };
        }
        div.addEventListener('contextmenu', e => { e.preventDefault(); openCardInspect(card, null); });
      });
    }

    const _ownBenchFresh = attachBenchDropZoneOnce('p' + (p + 1) + '-bench', p);
    if (_ownBenchFresh) {
      _ownBenchFresh.querySelectorAll('.bench-unit').forEach((div, i) => {
        const unit = state.players[p].bench[i];
        if (unit) div.addEventListener('contextmenu', e => { e.preventDefault(); openCardInspect(unit, null); });
      });
    }

    const ownLdr = document.querySelector('#p' + (p + 1) + '-leader-zone .leader-card');
    if (ownLdr) ownLdr.addEventListener('contextmenu', e => { e.preventDefault(); openCardInspect(state.players[p].leader, null); });
    const oppLdr = document.querySelector('#p' + (opp + 1) + '-leader-zone .leader-card');
    if (oppLdr) oppLdr.addEventListener('contextmenu', e => { e.preventDefault(); openCardInspect(state.players[opp].leader, null); });

    const btnEnd = document.getElementById('btn-end-phase');
    const ready  = btnEnd.dataset.setupReady === '1';
    btnEnd.textContent = ready ? 'Waiting for opponent...' : 'Done Setup ->';
    btnEnd.disabled    = ready;
    return;
  }

  // ALL PHASES -- right-click for both players
  const ownHandEl = document.getElementById('p' + (p + 1) + '-hand');
  if (ownHandEl) {
    ownHandEl.querySelectorAll('.card').forEach((div, i) => {
      const card = state.players[p].hand[i];
      if (!card || card.hidden) return;
      div.addEventListener('contextmenu', e => { e.preventDefault(); openCardInspect(card, null); });
      if (isMyTurn()) {
        if (card.type === 'Unit') attachDragToHandCard(div, i, p);
        else div.onclick = () => { if (state.phase === 'main') act('PLAY_CARD', { handIdx: i }); };
      }
    });
  }

  const _freshBench = isMyTurn()
    ? attachBenchDropZoneOnce('p' + (p + 1) + '-bench', p)
    : document.getElementById('p' + (p + 1) + '-bench');
  const ownBenchEl = _freshBench;
  if (ownBenchEl) {
    ownBenchEl.querySelectorAll('.bench-unit').forEach((div, i) => {
      const unit = state.players[p].bench[i];
      if (!unit) return;
      const cost = getActiveCost(state, unit);
      const canActivate = isMyTurn() && state.phase === 'main' && !unit.exhausted
        && canAfford(state, cost)
        && !(unit.id === 'rouge' && (state.rougeUsedThisTurn || [false,false])[p])
        && !hasUsedActiveThisTurn(state, unit);
      div.addEventListener('contextmenu', e => { e.preventDefault(); openCardInspect(unit, canActivate ? () => handleUnitActive(p, i) : null); });
      if (canActivate) div.onclick = () => handleUnitActive(p, i);
    });
  }

  const ownLeaderEl = document.querySelector('#p' + (p + 1) + '-leader-zone .leader-card');
  if (ownLeaderEl) {
    const canUse = isMyTurn() && state.phase === 'main'
      && canAfford(state, state.players[p].leader.activeCost)
      && state.players[p].hand.length > 0
      && !(state.leaderUsedThisTurn || [false,false])[p];
    ownLeaderEl.addEventListener('contextmenu', e => { e.preventDefault(); openCardInspect(state.players[p].leader, canUse ? openLeaderActiveModal : null); });
    if (canUse) { ownLeaderEl.style.cursor = 'pointer'; ownLeaderEl.onclick = openLeaderActiveModal; }
  }

  const oppBenchEl = document.getElementById('p' + (opp + 1) + '-bench');
  if (oppBenchEl) {
    oppBenchEl.querySelectorAll('.bench-unit').forEach((div, i) => {
      const unit = state.players[opp].bench[i];
      if (!unit) return;
      div.addEventListener('contextmenu', e => { e.preventDefault(); openCardInspect(unit, null); });
      if (isMyTurn() && state.phase === 'attack') {
        const tauntUid = state.tauntUnit && state.tauntUnit[opp];
        if (!tauntUid || unit.uid === tauntUid)
          div.onclick = () => act('ATTACK', { targetType: 'unit', targetBenchIdx: i });
      }
    });
  }

  const oppLeaderEl = document.querySelector('#p' + (opp + 1) + '-leader-zone .leader-card');
  if (oppLeaderEl) {
    oppLeaderEl.addEventListener('contextmenu', e => { e.preventDefault(); openCardInspect(state.players[opp].leader, null); });
    if (isMyTurn() && state.phase === 'attack' && !(state.tauntUnit && state.tauntUnit[opp]))
      oppLeaderEl.onclick = () => act('ATTACK', { targetType: 'leader' });
  }
}

// ---------------------------------------------------------------------------
// Drag-and-drop
// ---------------------------------------------------------------------------
let _drag = { active: false, handIdx: null };

function attachDragToHandCard(div, handIdx, p) {
  div.draggable = true;
  div.addEventListener('dragstart', e => {
    _drag = { active: true, handIdx };
    e.dataTransfer.effectAllowed = 'move';
    highlightBenchZone(true, p);
    // Disable pointer events on bench children so drag events land on the container
    const benchEl = document.getElementById('p' + (p + 1) + '-bench');
    if (benchEl) benchEl.querySelectorAll('.bench-unit, .bench-slot').forEach(el => { el.style.pointerEvents = 'none'; });
  });
  div.addEventListener('dragend', () => endDrag(p));
}

function attachBenchDropZoneOnce(benchId, p) {
  const el = document.getElementById(benchId);
  if (!el) return null;
  // Clone to strip all stale event listeners, then re-attach fresh ones
  const fresh = el.cloneNode(true);
  el.parentNode.replaceChild(fresh, el);
  fresh.dataset.dropWired = '1';
  fresh.addEventListener('dragover',  e => { e.preventDefault(); }); // must preventDefault to allow drop
  fresh.addEventListener('dragenter', e => { e.preventDefault(); fresh.classList.add('drop-hover'); });
  fresh.addEventListener('dragleave', e => {
    // Only remove hover if leaving the bench entirely (not just entering a child)
    if (!fresh.contains(e.relatedTarget)) fresh.classList.remove('drop-hover');
  });
  fresh.addEventListener('drop', e => {
    e.preventDefault();
    fresh.classList.remove('drop-hover');
    if (_drag.active) { act('PLAY_CARD', { handIdx: _drag.handIdx }); endDrag(p); }
  });
  return fresh; // return new element so callers don't use stale ref
}

function highlightBenchZone(on, p) { const el = document.getElementById('p' + (p + 1) + '-bench'); if (el) el.classList.toggle('drop-target-active', on); }
function endDrag(p) {
  _drag = { active: false, handIdx: null };
  highlightBenchZone(false, p);
  document.querySelectorAll('.drop-hover').forEach(el => el.classList.remove('drop-hover'));
  // Restore pointer events on bench children
  const benchEl = document.getElementById('p' + (p + 1) + '-bench');
  if (benchEl) benchEl.querySelectorAll('.bench-unit, .bench-slot').forEach(el => { el.style.pointerEvents = ''; });
}

function triggerGenesisGlow(playerIdx) {
  ['p' + (playerIdx+1) + '-hand', 'p' + (playerIdx+1) + '-bench', 'p' + (playerIdx+1) + '-leader-row'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('genesis-glow');
    setTimeout(() => el.classList.remove('genesis-glow'), 1800);
  });
}

// ---------------------------------------------------------------------------
// Status effects
// ---------------------------------------------------------------------------
function renderStatusEffects(st) {
  const el = document.getElementById('status-effects-panel');
  if (!el || !st) return;
  const p = myPlayerIdx || 0; const opp = opponent(p);
  const fx = [];
  if (st.activeStage)                        fx.push({ label: 'Stage: ' + st.activeStage.name, cls: 'status-stage' });
  if ((st.chaosEmeraldBuff  && st.chaosEmeraldBuff[p])  > 0) fx.push({ label: '+' + st.chaosEmeraldBuff[p]  + ' Chaos Emerald',     cls: 'status-positive' });
  if ((st.chaosEmeraldBuff  && st.chaosEmeraldBuff[opp])> 0) fx.push({ label: 'Opp +' + st.chaosEmeraldBuff[opp]  + ' Emerald',    cls: 'status-negative' });
  if ((st.powerGloveBuff    && st.powerGloveBuff[p])    > 0) fx.push({ label: '+' + st.powerGloveBuff[p]    + ' Power Glove',       cls: 'status-positive' });
  if ((st.powerGloveBuff    && st.powerGloveBuff[opp])  > 0) fx.push({ label: 'Opp +' + st.powerGloveBuff[opp]    + ' Glove',       cls: 'status-negative' });
  if (st.masterEmeraldActive)                fx.push({ label: 'Master Emerald Active',  cls: 'status-positive' });
  if (st.haruShield  && st.haruShield[p])    fx.push({ label: 'Haru Shield: Leader immune',  cls: 'status-positive' });
  if (st.haruShield  && st.haruShield[opp])  fx.push({ label: 'Opp Haru Shield active',       cls: 'status-negative' });
  if (st.unblockableAttack && st.unblockableAttack[p]) fx.push({ label: 'Sae: Next attack unblockable', cls: 'status-positive' });
  if (st.tauntUnit   && st.tauntUnit[opp])   fx.push({ label: 'Taunt: Sojiro must be attacked', cls: 'status-negative' });
  if (st.tauntUnit   && st.tauntUnit[p])     fx.push({ label: 'Your Taunt active',               cls: 'status-positive' });
  const exhausted = (st.players[p].bench || []).filter(u => u.exhausted);
  if (exhausted.length) fx.push({ label: 'Exhausted: ' + exhausted.map(u => u.name).join(', '), cls: 'status-warn' });
  el.innerHTML = fx.length
    ? fx.map(e => '<div class="status-tag ' + e.cls + '">' + e.label + '</div>').join('')
    : '<div class="status-tag status-none">No active effects</div>';
}

// ---------------------------------------------------------------------------
// Pending effects
// ---------------------------------------------------------------------------
function checkPendingEffects() {
  if (state.pendingDragonsEye)  { openDragonsEyeModal();  return; }
  if (state.pendingRayActive)   { openRayActiveModal();   return; }
  if (state.pendingExtremeGear) { openExtremeGearModal(); return; }
  if (state.pendingMightyAttack){ openMightyAttackModal(myPlayerIdx); return; }
  if (state.pendingLeblanc     && state.pendingLeblanc.playerIdx     === myPlayerIdx) { openLeBlancModal();       return; }
  if (state.pendingArsene      && state.pendingArsene.playerIdx      === myPlayerIdx) { openArseneModal();        return; }
  if (state.pendingYusukeTarget && state.pendingYusukeTarget.p       === myPlayerIdx) { openYusukeResolveModal(); return; }
}

// ---------------------------------------------------------------------------
// Unit active dispatch
// ---------------------------------------------------------------------------
function handleUnitActive(p, benchIdx) {
  const unit = state.players[p].bench[benchIdx];
  if (!unit) return;
  openUnitActiveConfirm(unit, benchIdx, p);
}

function openUnitActiveConfirm(unit, benchIdx, p) {
  const cost = getActiveCost(state, unit);
  const ov = document.getElementById('unit-confirm-overlay');
  if (!ov) { fireUnitActive(p, benchIdx); return; }
  document.getElementById('unit-confirm-name').textContent = unit.name;
  document.getElementById('unit-confirm-desc').textContent = unit.activeDesc || '';
  document.getElementById('unit-confirm-cost').textContent = cost + ' Energy';
  document.getElementById('btn-unit-confirm-yes').onclick    = () => { closeOverlay('unit-confirm-overlay'); fireUnitActive(p, benchIdx); };
  document.getElementById('btn-unit-confirm-cancel').onclick = () => closeOverlay('unit-confirm-overlay');
  ov.onclick = e => { if (e.target === ov) closeOverlay('unit-confirm-overlay'); };
  showOverlay('unit-confirm-overlay');
}

function fireUnitActive(p, benchIdx) {
  const unit = state.players[p].bench[benchIdx];
  if (!unit) return;
  switch (unit.id) {
    case 'tails':            openTailsModal(p, benchIdx);        break;
    case 'knuckles':         openKnucklesModal(p, benchIdx);     break;
    case 'cream':            openCreamModal(p, benchIdx);        break;
    case 'silver':           openSilverBounceModal(p, benchIdx); break;
    case 'morgana':          openMorganaModal(p, benchIdx);      break;
    case 'sumire_yoshizawa': openSumireModal(p, benchIdx);       break;
    case 'yusuke_kitagawa':  openYusukeModal(p, benchIdx);       break;
    default:                 act('USE_UNIT_ACTIVE', { benchIdx }); break;
  }
}

// ---------------------------------------------------------------------------
// Static buttons
// ---------------------------------------------------------------------------
function bindStaticButtons() {
  document.getElementById('btn-end-phase').addEventListener('click', () => {
    if (!state) return;
    if (state.phase === 'setup') {
      const btn = document.getElementById('btn-end-phase');
      if (btn.dataset.setupReady === '1') return;
      btn.textContent = 'Waiting for opponent...'; btn.disabled = true; btn.dataset.setupReady = '1';
      act('SETUP_DONE'); return;
    }
    if (!isMyTurn()) return;
    if (state.phase === 'main')        act('ENTER_ATTACK_PHASE');
    else if (state.phase === 'attack') act('SKIP_ATTACK');
  });

  document.getElementById('btn-leader-active').addEventListener('click', () => {
    if (isMyTurn() && state && state.phase === 'main') openLeaderActiveModal();
  });

  document.getElementById('btn-continue').addEventListener('click', () => {
    closeOverlay('pass-overlay');
    document.getElementById('btn-continue').style.display = '';
    if (_gameOver || !state) return;
    if (state.phase === 'end' && isMyTurn()) act('ADVANCE_TURN');
  });

  document.getElementById('btn-scry-discard').addEventListener('click', () => { closeOverlay('scry-overlay'); act('RESOLVE_BIG_SCRY', { shouldDiscard: true  }); });
  document.getElementById('btn-scry-keep')   .addEventListener('click', () => { closeOverlay('scry-overlay'); act('RESOLVE_BIG_SCRY', { shouldDiscard: false }); });

  document.getElementById('btn-cancel-target').addEventListener('click', () => closeOverlay('target-overlay'));
  document.getElementById('btn-cancel-tails') .addEventListener('click', () => closeOverlay('tails-overlay'));
  document.getElementById('btn-cancel-sonic') .addEventListener('click', () => closeOverlay('sonic-overlay'));
  document.getElementById('btn-cancel-mighty').addEventListener('click', () => closeOverlay('mighty-attack-overlay'));

  document.getElementById('btn-take-hit').addEventListener('click', () => { closeOverlay('block-overlay'); act('RESOLVE_BLOCK', { blockBenchIdx: null }); });

  document.getElementById('btn-extreme-gear-cancel') .addEventListener('click', () => { _extremeGearSelected = new Set(); act('RESOLVE_EXTREME_GEAR', { handIndices: [] }); closeOverlay('extreme-gear-overlay'); });
  document.getElementById('btn-extreme-gear-confirm').addEventListener('click', () => { act('RESOLVE_EXTREME_GEAR', { handIndices: [..._extremeGearSelected] }); _extremeGearSelected = new Set(); closeOverlay('extreme-gear-overlay'); });
}

// ---------------------------------------------------------------------------
// Modal helpers
// ---------------------------------------------------------------------------
function mkBtn(label, onClick) {
  const btn = document.createElement('button');
  btn.className = 'modal-card-btn'; btn.textContent = label; btn.onclick = onClick;
  return btn;
}

function mkCardBtn(card, onClick, extra) {
  const w = document.createElement('div');
  w.style.cssText = 'position:relative;cursor:pointer;display:inline-block;transition:transform 0.15s;';
  const cel = buildCardEl(card, false); cel.style.pointerEvents = 'none';
  w.appendChild(cel);
  if (extra) {
    const b = document.createElement('div');
    b.style.cssText = 'position:absolute;bottom:4px;left:0;right:0;text-align:center;font-size:8px;color:var(--gold);background:#000a;padding:2px;';
    b.textContent = extra; w.appendChild(b);
  }
  w.addEventListener('mouseenter', () => w.style.transform = 'translateY(-4px)');
  w.addEventListener('mouseleave', () => w.style.transform = '');
  w.onclick = onClick;
  return w;
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
function openBlockModal(attackerP, defenderP) {
  const dmg = calcEffectiveDamage(state, attackerP);
  document.getElementById('block-desc').innerHTML =
    'Player ' + (attackerP+1) + "'s Leader attacks for <strong style='color:var(--red)'>" + dmg + '</strong>.<br>Choose a unit to block, or take the hit.';
  const c = document.getElementById('block-options'); c.innerHTML = '';
  state.players[defenderP].bench.map((u,i) => ({ u, i })).filter(({ u }) => !u.exhausted).forEach(({ u, i }) => {
    const willKO = u.currentHp - dmg <= 0;
    const btn = mkBtn(u.name + ' (' + u.currentHp + '/' + u.hp + ' HP)' + (willKO ? ' will KO' : ''), () => { closeOverlay('block-overlay'); act('RESOLVE_BLOCK', { blockBenchIdx: i }); });
    if (willKO) btn.style.borderColor = 'var(--red)';
    c.appendChild(btn);
  });
  showOverlay('block-overlay');
}

function openLeaderActiveModal() {
  const p = myPlayerIdx;
  const leader = state.players[p].leader;
  if (leader.id === 'kiryu') { act('USE_LEADER_ACTIVE', {}); return; }
  if (leader.id === 'joker') {
    // Joker: choose a bench unit to copy their active
    const bench = state.players[p].bench;
    if (bench.length === 0) { addLog('! Joker: no bench units to copy', 'damage'); return; }
    const c = document.getElementById('target-options'); c.innerHTML = '';
    document.getElementById('target-title').textContent = 'JOKER: COPY ACTIVE';
    document.getElementById('target-desc').textContent  = 'Choose a bench unit to activate:';
    bench.forEach((unit, bi) => {
      c.appendChild(mkBtn(unit.name + ' — ' + unit.activeDesc, () => {
        act('USE_LEADER_ACTIVE', { benchIdx: bi });
        closeOverlay('target-overlay');
      }));
    });
    showOverlay('target-overlay');
    return;
  }
  // Sonic (default): pick hand card to discard
  if (state.players[p].hand.length === 0) { addLog('! ' + leader.name + ': hand is empty', 'damage'); return; }
  const c = document.getElementById('sonic-discard-options'); c.innerHTML = '';
  state.players[p].hand.filter(card => card && !card.hidden).forEach((card, hi) => {
    c.appendChild(mkCardBtn(card, () => { act('USE_LEADER_ACTIVE', { handIdx: hi }); closeOverlay('sonic-overlay'); }, 'Discard -> Draw 2'));
  });
  showOverlay('sonic-overlay');
}

function openTailsModal(p, benchIdx) {
  const discard = state.players[p].discard;
  const playable = discard.map((card, di) => ({ card, di })).filter(({ card }) => card.type !== 'Stage');
  if (playable.length === 0) { addLog('Tails: No playable cards in discard', 'phase'); return; }
  const c = document.getElementById('tails-discard-options'); c.innerHTML = '';
  playable.forEach(({ card, di }) => {
    const div = buildCardEl(card, false); div.style.cursor = 'pointer';
    div.addEventListener('contextmenu', e => { e.preventDefault(); openCardInspect(card, null); });
    div.addEventListener('click', () => { act('USE_UNIT_ACTIVE', { benchIdx, discardIdx: di }); closeOverlay('tails-overlay'); });
    c.appendChild(div);
  });
  showOverlay('tails-overlay');
}

function openKnucklesModal(p, benchIdx) {
  const opp = opponent(p);
  if (state.players[opp].bench.length === 0) { addLog('Knuckles: No opponent bench units', 'phase'); return; }
  const c = document.getElementById('target-options'); c.innerHTML = '';
  document.getElementById('target-title').textContent = 'KNUCKLES: SELECT TARGET';
  document.getElementById('target-desc').textContent  = 'Deal 10 damage to a Support Unit:';
  state.players[opp].bench.forEach((unit, ui) => {
    c.appendChild(mkBtn(unit.name + ' (' + unit.currentHp + '/' + unit.hp + ' HP)', () => { act('USE_UNIT_ACTIVE', { benchIdx, targetBenchIdx: ui }); closeOverlay('target-overlay'); }));
  });
  showOverlay('target-overlay');
}

function openCreamModal(p, benchIdx) {
  const c = document.getElementById('target-options'); c.innerHTML = '';
  document.getElementById('target-title').textContent = 'CREAM: HEAL TARGET';
  document.getElementById('target-desc').textContent  = 'Heal 10 HP from any friendly unit:';
  const leader = state.players[p].leader;
  const lBtn = mkBtn('Leader (' + leader.currentHp + '/' + leader.hp + ' HP)', () => { act('USE_UNIT_ACTIVE', { benchIdx, targetType: 'leader', targetBenchIdx: null }); closeOverlay('target-overlay'); });
  lBtn.disabled = leader.currentHp >= leader.hp; c.appendChild(lBtn);
  state.players[p].bench.forEach((unit, ui) => {
    const btn = mkBtn(unit.name + ' (' + unit.currentHp + '/' + unit.hp + ' HP)', () => { act('USE_UNIT_ACTIVE', { benchIdx, targetType: 'bench', targetBenchIdx: ui }); closeOverlay('target-overlay'); });
    btn.disabled = unit.currentHp >= unit.hp; c.appendChild(btn);
  });
  showOverlay('target-overlay');
}

function openSilverBounceModal(p, benchIdx) {
  const c = document.getElementById('target-options'); c.innerHTML = '';
  document.getElementById('target-title').textContent = 'SILVER: BOUNCE TARGET';
  document.getElementById('target-desc').textContent  = 'Return a bench unit to your hand:';
  state.players[p].bench.forEach((unit, ui) => {
    c.appendChild(mkBtn(unit.name + ' (' + unit.currentHp + '/' + unit.hp + ' HP)', () => { act('USE_UNIT_ACTIVE', { benchIdx, targetBenchIdx: ui }); closeOverlay('target-overlay'); }));
  });
  showOverlay('target-overlay');
}

function openMightyAttackModal(p) {
  const opp = opponent(p);
  const c = document.getElementById('mighty-attack-options'); c.innerHTML = '';
  const leader = state.players[opp].leader;
  c.appendChild(mkBtn('Leader (' + leader.currentHp + '/' + leader.hp + ' HP)', () => { act('ATTACK', { targetType: 'leader' }); closeOverlay('mighty-attack-overlay'); }));
  state.players[opp].bench.forEach((unit, ui) => {
    c.appendChild(mkBtn(unit.name + ' (' + unit.currentHp + '/' + unit.hp + ' HP)', () => { act('ATTACK', { targetType: 'unit', targetBenchIdx: ui }); closeOverlay('mighty-attack-overlay'); }));
  });
  showOverlay('mighty-attack-overlay');
}

function openDragonsEyeModal() {
  const { cards } = state.pendingDragonsEye;
  const c = document.getElementById('dragons-eye-options'); c.innerHTML = '';
  cards.forEach((card, si) => { c.appendChild(mkCardBtn(card, () => { act('RESOLVE_DRAGONS_EYE', { deckIdx: si }); closeOverlay('dragons-eye-overlay'); }, 'Add to hand')); });
  showOverlay('dragons-eye-overlay');
}

function openRayActiveModal() {
  const { cards } = state.pendingRayActive;
  const c = document.getElementById('ray-active-options'); c.innerHTML = '';
  cards.forEach((card, si) => { c.appendChild(mkCardBtn(card, () => { act('RESOLVE_RAY', { deckIdx: si }); closeOverlay('ray-active-overlay'); }, 'Send to discard')); });
  showOverlay('ray-active-overlay');
}

function openExtremeGearModal() {
  const { playerIdx: pi, maxDiscards = 3 } = state.pendingExtremeGear;
  _extremeGearSelected = new Set();
  const c = document.getElementById('extreme-gear-options'); c.innerHTML = '';
  const updateCount = () => {
    const n = _extremeGearSelected.size;
    document.getElementById('extreme-gear-count').textContent = n + '/' + maxDiscards + ' selected -> +' + n + ' Energy';
    c.querySelectorAll('.eg-wrap').forEach(w => { const atCap = n >= maxDiscards && !_extremeGearSelected.has(+w.dataset.i); w.style.opacity = atCap ? '0.4' : '1'; w.style.pointerEvents = atCap ? 'none' : ''; });
  };
  state.players[pi].hand.forEach((card, hi) => {
    if (!card || card.hidden) return;
    const w = document.createElement('div'); w.className = 'eg-wrap'; w.dataset.i = hi;
    w.style.cssText = 'position:relative;cursor:pointer;display:inline-block;';
    const cel = buildCardEl(card, false); cel.style.pointerEvents = 'none';
    const badge = document.createElement('div');
    badge.style.cssText = 'position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;background:var(--gold);color:#000;font-size:10px;display:flex;align-items:center;justify-content:center;opacity:0;';
    badge.textContent = 'v'; w.append(cel, badge);
    w.onclick = () => {
      if (_extremeGearSelected.has(hi)) { _extremeGearSelected.delete(hi); cel.style.borderColor=''; badge.style.opacity='0'; }
      else if (_extremeGearSelected.size < maxDiscards) { _extremeGearSelected.add(hi); cel.style.borderColor='var(--gold)'; badge.style.opacity='1'; }
      updateCount();
    };
    c.appendChild(w);
  });
  updateCount(); showOverlay('extreme-gear-overlay');
}

function openMorganaModal(p, benchIdx) {
  const opp = opponent(p);
  if (state.players[opp].bench.length === 0) { addLog('Morgana: no opponent bench units', 'phase'); return; }
  const c = document.getElementById('target-options'); c.innerHTML = '';
  document.getElementById('target-title').textContent = 'MORGANA: CHOOSE TARGET';
  document.getElementById('target-desc').textContent  = 'Morgana trades with an enemy unit -- both go to discard:';
  state.players[opp].bench.forEach((unit, ui) => {
    c.appendChild(mkBtn(unit.name + ' (' + unit.currentHp + '/' + unit.hp + ' HP)', () => { act('USE_UNIT_ACTIVE', { benchIdx, targetBenchIdx: ui }); closeOverlay('target-overlay'); }));
  });
  showOverlay('target-overlay');
}

function openSumireModal(p, benchIdx) {
  const opp = opponent(p);
  if (state.players[opp].bench.length === 0) { addLog('Sumire: no opponent bench units', 'phase'); return; }
  const c = document.getElementById('target-options'); c.innerHTML = '';
  document.getElementById('target-title').textContent = 'SUMIRE: CHOOSE TARGET';
  document.getElementById('target-desc').textContent  = 'Deal 20 unblockable damage to a support unit:';
  state.players[opp].bench.forEach((unit, ui) => {
    const willKO = unit.currentHp - 20 <= 0;
    c.appendChild(mkBtn(unit.name + ' (' + unit.currentHp + '/' + unit.hp + ' HP)' + (willKO ? ' will KO' : ''), () => { act('USE_UNIT_ACTIVE', { benchIdx, targetBenchIdx: ui }); closeOverlay('target-overlay'); }));
  });
  showOverlay('target-overlay');
}

function openYusukeModal(p, benchIdx) {
  const c = document.getElementById('target-options'); c.innerHTML = '';
  document.getElementById('target-title').textContent = 'YUSUKE: COPY ACTIVE';
  document.getElementById('target-desc').textContent  = 'Choose a friendly unit to copy their active:';
  state.players[p].bench.forEach((unit, ui) => {
    if (ui === benchIdx) return;
    c.appendChild(mkBtn(unit.name + ' -- ' + unit.activeDesc, () => { act('USE_UNIT_ACTIVE', { benchIdx, targetBenchIdx: ui }); closeOverlay('target-overlay'); }));
  });
  showOverlay('target-overlay');
}

function openYusukeResolveModal() { act('RESOLVE_YUSUKE', {}); }

function openLeBlancModal() {
  const pi = state.pendingLeblanc.playerIdx;
  const hand = state.players[pi].hand.filter(c => c && !c.hidden);
  const c = document.getElementById('sonic-discard-options'); c.innerHTML = '';
  hand.forEach((card, hi) => { c.appendChild(mkCardBtn(card, () => { act('RESOLVE_LEBLANC', { handIdx: hi }); closeOverlay('sonic-overlay'); }, 'Discard -> Draw 1')); });
  const skip = document.createElement('button'); skip.className = 'modal-card-btn'; skip.textContent = 'Skip';
  skip.onclick = () => { act('RESOLVE_LEBLANC', { handIdx: null }); closeOverlay('sonic-overlay'); };
  c.appendChild(skip); showOverlay('sonic-overlay');
}

function openArseneModal() {
  const c = document.getElementById('target-options'); c.innerHTML = '';
  document.getElementById('target-title').textContent = 'ARSENE UNLEASHED';
  document.getElementById('target-desc').textContent  = "Set a leader's HP to half their max:";
  state.players.forEach((pl, pi) => {
    const ldr = pl.leader; const halfHp = Math.max(1, Math.floor(ldr.hp / 2));
    c.appendChild(mkBtn('P' + (pi+1) + ': ' + ldr.name + ' (' + ldr.currentHp + '/' + ldr.hp + ' -> ' + halfHp + ' HP)', () => { act('RESOLVE_ARSENE', { targetPlayerIdx: pi }); closeOverlay('target-overlay'); }));
  });
  showOverlay('target-overlay');
}