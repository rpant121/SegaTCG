/**
 * EVENT HANDLERS — LOCAL (offline) mode
 * Wires DOM events to engine actions, then re-renders.
 */

import { opponent } from '../engine/state.js';
import { checkWin } from '../engine/combat.js';
import { attackLeader, applyDamageToUnit, resolveIntercept, calcEffectiveDamage } from '../engine/combat.js';
import {
  playCardFromHand, resolveExtremeGear, canAfford, getActiveCost, hasUsedActiveThisTurn,
  tailsActive, knucklesActive, amyActive, creamActive, bigActive,
  silverActive, shadowActive, mightyActive, rougeActive, blazeActive,
  rayActive, charmyActive, espioActive, vectorActive,
  sonicActive, kiryuActive, jokerActiveValidate,
  carolineActive, justineActive, taeTakumiActive, sojiroSakuraActive,
  saeNiijimaActive, sadayoKawakamiActive, suguruKamoshidaActive,
  ryujiSakamotoActive, annTakamakiActive, morganaActive,
  yusukeKitagawaActive, makotoNiijimaActive, futabaSakuraActive,
  haruOkumuraActive, sumireYoshizawaActive,
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

let state     = null;
let _gameOver = false;
let _drag     = { active: false, handIdx: null, ghostEl: null };
let _extremeGearSelected = new Set();

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
  if (loser !== null && !_gameOver) { _gameOver = true; showWinModal(loser, state.turn); }
}

function refreshBoard() { render(state); attachBoardHandlers(); }

function attachBoardHandlers() {
  const p   = state.activePlayer;
  const opp = opponent(p);

  if (state.phase === 'setup') {
    const sp  = state._setupPlayer ?? 0;
    const nsp = sp === 0 ? 1 : 0;
    const setupHandEls = renderHand(`p${sp + 1}-hand`, state, sp, sp);
    setupHandEls.forEach(({ div, idx, card }) => {
      div.addEventListener('contextmenu', (e) => { e.preventDefault(); openCardInspect(card, null); });
      if (card.type !== 'Unit') return;
      if (state.players[sp].bench.length >= 3) return;
      div.classList.add('playable');
      div.onclick = () => { playCardFromHand(state, idx, log); refreshBoard(); };
      attachDragSource(div, idx, card);
    });
    renderBench(`p${sp + 1}-bench`, state, sp);
    attachBenchDropZone(`p${sp + 1}-bench`, sp);
    renderHand(`p${nsp + 1}-hand`, state, nsp, -1);
    renderBench(`p${nsp + 1}-bench`, state, nsp);
    renderLeader('p1-leader-zone', state, 0);
    renderLeader('p2-leader-zone', state, 1);
    return;
  }

  const handEls = renderHand(`p${p + 1}-hand`, state, p);
  handEls.forEach(({ div, idx, card }) => {
    const isEquip = card.type === 'Equipment' || card.type === 'Genesis' || card.type === 'Stage';
    const charmyDiscount = (isEquip && state.equipmentPlayedThisTurn[p] > 0 &&
      state.players[p].bench.some(u => u.id === 'charmy' && !u.exhausted)) ? 1 : 0;
    const effectiveCost = Math.max(0, (card.cost ?? 0) - charmyDiscount);
    const playable = state.phase === 'main' && canAfford(state, effectiveCost);
    const onPlay = (playable && card.type !== 'Unit') ? () => {
      playCardFromHand(state, idx, log);
      refreshBoard(); winGuard(); checkPendingEffects();
    } : null;
    div.addEventListener('contextmenu', (e) => { e.preventDefault(); openCardInspect(card, onPlay); });
    if (state.phase !== 'main') return;
    if (card.type === 'Unit') {
      attachDragSource(div, idx, card);
    } else if (playable) {
      div.classList.add('playable');
      div.onclick = () => { playCardFromHand(state, idx, log); refreshBoard(); winGuard(); checkPendingEffects(); };
    }
  });

  const ownBenchEls = renderBench(`p${p + 1}-bench`, state, p);
  ownBenchEls.forEach(({ div, idx }) => {
    const unit = state.players[p].bench[idx];
    if (!unit || unit.exhausted) return;
    const cost = getActiveCost(state, unit);
    const canUse = state.phase === 'main' && canAfford(state, cost)
      && !(unit.id === 'rouge' && state.rougeUsedThisTurn[p])
      && !hasUsedActiveThisTurn(state, unit);
    if (canUse) div.onclick = () => handleUnitActive(p, idx);
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openCardInspect(unit, canUse ? () => handleUnitActive(p, idx) : null);
    });
  });

  attachBenchDropZone(`p${p + 1}-bench`, p);

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
    if (unit) div.addEventListener('contextmenu', (e) => { e.preventDefault(); openCardInspect(unit, null); });
  });

  const oppLeaderDiv = renderLeader(`p${opp + 1}-leader-zone`, state, opp);
  if (state.phase === 'attack') {
    oppLeaderDiv.onclick = () => {
      const canIntercept = state.players[opp].bench.some(u => !u.exhausted);
      if (!canIntercept) {
        attackLeader(state, p, opp, log);
        winGuard();
        if (!_gameOver) enterEndPhase(state, log, emit);
      } else {
        openInterceptModal(p, opp);
      }
    };
  }
  oppLeaderDiv.addEventListener('contextmenu', (e) => { e.preventDefault(); openCardInspect(state.players[opp].leader, null); });

  const ownLeaderDiv = renderLeader(`p${p + 1}-leader-zone`, state, p);
  if (state.phase === 'main') {
    const leader  = state.players[p].leader;
    const needsHand = leader.id === 'sonic'; // only Sonic requires a card in hand
    const alreadyUsed = (state.leaderUsedThisTurn ?? [false, false])[p];
    const canUse  = canAfford(state, leader.activeCost)
                   && (!needsHand || state.players[p].hand.length > 0)
                   && (leader.id === 'kiryu' || !alreadyUsed); // Kiryu can activate multiple times
    const openFn  = () => openLeaderActiveModal(p);
    ownLeaderDiv.style.cursor = canUse ? 'pointer' : 'default';
    if (canUse) ownLeaderDiv.onclick = openFn;
    ownLeaderDiv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openCardInspect(state.players[p].leader, canUse ? openFn : null);
    });
  }

  if (state.pendingMightyAttack) { state.pendingMightyAttack = false; openMightyAttackModal(p); }
}

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
  el.addEventListener('dragover', (e) => { if (!_drag.active) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drop-hover'); });
  el.addEventListener('dragleave', () => el.classList.remove('drop-hover'));
  el.addEventListener('drop', (e) => {
    e.preventDefault(); el.classList.remove('drop-hover');
    if (!_drag.active || _drag.handIdx === null) return;
    playCardFromHand(state, _drag.handIdx, log);
    endDrag(); refreshBoard(); winGuard(); checkPendingEffects();
  });
}

function buildGhost(card) {
  const el = document.createElement('div');
  el.className = 'card card-type-unit drag-ghost';
  el.style.cssText = `position:fixed;pointer-events:none;z-index:1000;opacity:0.85;transform:rotate(4deg) scale(1.05);box-shadow:0 8px 32px #000a,0 0 16px var(--sonic-blue);border-color:var(--sonic-bright);`;
  el.innerHTML = `<div class="card-type-badge type-unit">UNIT</div><div class="card-name">${card.name}</div><div style="font-size:8px;color:var(--green);">HP:${card.hp}</div><div class="card-effect-text">${card.passiveDesc ?? ''}</div>`;
  return el;
}

function highlightBenchZone(on) {
  const el = document.getElementById(`p${state.activePlayer + 1}-bench`);
  if (el) el.classList.toggle('drop-target-active', on);
}

function endDrag() {
  _drag.active = false; _drag.handIdx = null;
  if (_drag.ghostEl) { _drag.ghostEl.remove(); _drag.ghostEl = null; }
  highlightBenchZone(false);
  document.querySelectorAll('.drop-hover').forEach(el => el.classList.remove('drop-hover'));
}

function checkPendingEffects() {
  if (state.pendingDragonsEye)   { openDragonsEyeModal();   return; }
  if (state.pendingPolarisPact)  { openPolarisPactModal();  return; }
  if (state.pendingRayActive)    { openRayActiveModal();    return; }
  if (state.pendingExtremeGear)  { openExtremeGearModal();  return; }
  if (state.pendingMightyAttack) { openMightyAttackModal(state.activePlayer); state.pendingMightyAttack = false; return; }
}

function handleUnitActive(p, benchIdx) {
  const unit = state.players[p].bench[benchIdx];
  if (!unit) return;
  switch (unit.id) {
    case 'tails':    openTailsModal(p, benchIdx);       break;
    case 'knuckles': openKnucklesModal(p, benchIdx);    break;
    case 'amy':      if (amyActive(state, p, benchIdx, log))    { refreshBoard(); winGuard(); } break;
    case 'cream':    openCreamModal(p, benchIdx);       break;
    case 'big':      if (bigActive(state, p, benchIdx, log))    { refreshBoard(); winGuard(); } break;
    case 'silver':   openSilverBounceModal(p, benchIdx); break;
    case 'shadow':   if (shadowActive(state, p, benchIdx, log)) { refreshBoard(); winGuard(); } break;
    case 'mighty':
      if (mightyActive(state, p, benchIdx, log)) { refreshBoard(); openMightyAttackModal(p); }
      break;
    case 'rouge':    if (rougeActive(state, p, benchIdx, log))  { refreshBoard(); winGuard(); } break;
    case 'blaze':    if (blazeActive(state, p, benchIdx, log))  { refreshBoard(); winGuard(); } break;
    case 'ray':      if (rayActive(state, p, benchIdx, log))    { refreshBoard(); checkPendingEffects(); } break;
    case 'charmy':   if (charmyActive(state, p, benchIdx, log)) { refreshBoard(); winGuard(); } break;
    case 'espio':    if (espioActive(state, p, benchIdx, log))  { refreshBoard(); winGuard(); } break;
    case 'vector':   if (vectorActive(state, p, benchIdx, log)) { refreshBoard(); winGuard(); } break;
    // ── Persona 5 units ────────────────────────────────────────────────
    case 'caroline':          if (carolineActive(state, p, benchIdx, log))         { refreshBoard(); winGuard(); } break;
    case 'justine':           if (justineActive(state, p, benchIdx, log))          { refreshBoard(); winGuard(); } break;
    case 'tae_takumi':        if (taeTakumiActive(state, p, benchIdx, log))        { refreshBoard(); winGuard(); } break;
    case 'sojiro_sakura':     if (sojiroSakuraActive(state, p, benchIdx, log))     { refreshBoard(); winGuard(); } break;
    case 'sae_niijima':       if (saeNiijimaActive(state, p, benchIdx, log))       { refreshBoard(); winGuard(); } break;
    case 'sadayo_kawakami':   if (sadayoKawakamiActive(state, p, benchIdx, log))   { refreshBoard(); winGuard(); } break;
    case 'suguru_kamoshida':  if (suguruKamoshidaActive(state, p, benchIdx, log))  { refreshBoard(); winGuard(); } break;
    case 'ryuji_sakamoto':    if (ryujiSakamotoActive(state, p, benchIdx, log))    { refreshBoard(); winGuard(); } break;
    case 'ann_takamaki':      if (annTakamakiActive(state, p, benchIdx, log))      { refreshBoard(); winGuard(); } break;
    case 'morgana':           openMorganaModal(p, benchIdx); break;
    case 'yusuke_kitagawa':   openYusukeModal(p, benchIdx);  break;
    case 'makoto_niijima':    if (makotoNiijimaActive(state, p, benchIdx, log))    { refreshBoard(); winGuard(); } break;
    case 'futaba_sakura':     if (futabaSakuraActive(state, p, benchIdx, log))     { refreshBoard(); winGuard(); } break;
    case 'haru_okumura':      if (haruOkumuraActive(state, p, benchIdx, log))      { refreshBoard(); winGuard(); } break;
    case 'sumire_yoshizawa':  openSumireModal(p, benchIdx);  break;
  }
}

function openInterceptModal(attackerP, defenderP) {
  const dmg = calcEffectiveDamage(state, attackerP);
  const eligible = state.players[defenderP].bench
    .map((unit, idx) => ({ unit, idx })).filter(({ unit }) => !unit.exhausted);
  document.getElementById('intercept-desc').innerHTML =
    `Player ${attackerP + 1}'s Leader attacks for <strong style="color:var(--red)">${dmg} damage</strong>.<br>Intercept to protect your Leader \u2014 overflow damage applies if the interceptor is KO'd.`;
  const c = document.getElementById('intercept-options');
  c.innerHTML = '';
  eligible.forEach(({ unit, idx }) => {
    const willKO   = unit.currentHp - dmg <= 0;
    const overflow = willKO ? Math.max(20, dmg - unit.currentHp) : 0;
    const label    = `${unit.name} (${unit.currentHp}/${unit.hp} HP)` + (willKO ? `  \u26a0 KO \u2192 ${overflow} overflow` : '');
    const btn = mkBtn(label, () => {
      resolveIntercept(state, attackerP, defenderP, idx, log);
      closeOverlay('intercept-overlay');
      refreshBoard(); winGuard();
      if (!_gameOver) enterEndPhase(state, log, emit);
    });
    if (willKO) btn.style.borderColor = 'var(--red)';
    c.appendChild(btn);
  });
  document.getElementById('btn-take-hit')._attackerP = attackerP;
  document.getElementById('btn-take-hit')._defenderP = defenderP;
  showOverlay('intercept-overlay');
}

function openSilverBounceModal(p, benchIdx) {
  const bench = state.players[p].bench;
  const cost  = getActiveCost(state, bench[benchIdx]);
  if (!canAfford(state, cost)) { addLog('\u274c Not enough energy', 'damage'); return; }
  const c = document.getElementById('target-options');
  c.innerHTML = '';
  document.getElementById('target-title').textContent = 'SILVER: BOUNCE TARGET';
  document.getElementById('target-desc').textContent  = 'Choose a bench unit to return to your hand:';
  bench.forEach((unit, ui) => {
    c.appendChild(mkBtn(`${unit.name} (${unit.currentHp}/${unit.hp} HP)`, () => {
      closeOverlay('target-overlay');
      if (silverActive(state, p, benchIdx, ui, log)) { refreshBoard(); winGuard(); checkPendingEffects(); }
    }));
  });
  showOverlay('target-overlay');
}

function openTailsModal(p, benchIdx) {
  const discard = state.players[p].discard;
  if (discard.length === 0) { addLog('\u267b Tails: Discard is empty', 'phase'); return; }
  const c = document.getElementById('tails-discard-options');
  c.innerHTML = '';
  discard.forEach((card, di) => {
    c.appendChild(mkBtn(`${card.name} (${card.type})`, () => {
      tailsActive(state, p, benchIdx, di, log);
      closeOverlay('tails-overlay');
      refreshBoard(); winGuard();
    }));
  });
  showOverlay('tails-overlay');
}

function openKnucklesModal(p, benchIdx) {
  const opp = opponent(p);
  if (state.players[opp].bench.length === 0) { addLog('\ud83d\udc4a Knuckles: No opponent bench units', 'phase'); return; }
  const c = document.getElementById('target-options');
  c.innerHTML = '';
  document.getElementById('target-title').textContent = 'KNUCKLES: SELECT TARGET';
  document.getElementById('target-desc').textContent  = 'Deal 10 damage to a Support Unit:';
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
  document.getElementById('target-desc').textContent  = 'Heal 10 HP from any friendly unit:';
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

function openMightyAttackModal(p) {
  const opp = opponent(p);
  const c   = document.getElementById('mighty-attack-options');
  c.innerHTML = '';
  const leader = state.players[opp].leader;
  c.appendChild(mkBtn(`Leader (${leader.currentHp}/${leader.hp} HP)`, () => {
    attackLeader(state, p, opp, log);
    closeOverlay('mighty-attack-overlay');
    refreshBoard(); winGuard();
  }));
  state.players[opp].bench.forEach((unit, ui) => {
    c.appendChild(mkBtn(`${unit.name} (${unit.currentHp}/${unit.hp} HP)`, () => {
      applyDamageToUnit(state, p, opp, ui, log);
      closeOverlay('mighty-attack-overlay');
      refreshBoard(); winGuard();
    }));
  });
  showOverlay('mighty-attack-overlay');
}

// ── Leader active router ───────────────────────────────────────────────────
function openLeaderActiveModal(p) {
  const leaderId = state.players[p].leader.id;
  if (leaderId === 'kiryu') {
    if (kiryuActive(state, log)) { refreshBoard(); winGuard(); }
  } else if (leaderId === 'joker') {
    openJokerModal(p);
  } else {
    openSonicModal();
  }
}

// ── Joker: pick a bench unit to copy ──────────────────────────────────────
function openJokerModal(p) {
  const bench = state.players[p].bench;
  if (bench.length === 0) { addLog('\ud83c\udca1 Joker: no bench units to copy', 'damage'); return; }

  const c = document.getElementById('target-options');
  c.innerHTML = '';
  document.getElementById('target-title').textContent = 'JOKER: COPY ACTIVE';
  document.getElementById('target-desc').textContent  =
    'Select a bench unit \u2014 Joker copies its active (1\u26a1 for cost \u22643, 2\u26a1 for cost \u22654):';

  bench.forEach((unit, ui) => {
    const unitCost  = unit.activeCost ?? 0;
    const jokerCost = unitCost >= 4 ? 2 : 1;
    const btn = mkBtn(
      `${unit.name}  [copy: ${jokerCost}\u26a1]  (unit cost: ${unitCost})`,
      () => {
        closeOverlay('target-overlay');
        if (!jokerActiveValidate(state, ui, log)) return;
        handleUnitActiveByUnit(p, ui, unit);
      }
    );
    c.appendChild(btn);
  });
  showOverlay('target-overlay');
}

// Fire a unit active by bench index (Joker already paid — skip energy re-check)
function handleUnitActiveByUnit(p, benchIdx, unit) {
  switch (unit.id) {
    case 'tails':    openTailsModal(p, benchIdx);        break;
    case 'knuckles': openKnucklesModal(p, benchIdx);     break;
    case 'amy':      if (amyActive(state, p, benchIdx, log))    { refreshBoard(); winGuard(); } break;
    case 'cream':    openCreamModal(p, benchIdx);        break;
    case 'big':      if (bigActive(state, p, benchIdx, log))    { refreshBoard(); winGuard(); } break;
    case 'silver':   openSilverBounceModal(p, benchIdx); break;
    case 'shadow':   if (shadowActive(state, p, benchIdx, log)) { refreshBoard(); winGuard(); } break;
    case 'rouge':    if (rougeActive(state, p, benchIdx, log))  { refreshBoard(); winGuard(); } break;
    case 'blaze':    if (blazeActive(state, p, benchIdx, log))  { refreshBoard(); winGuard(); } break;
    case 'ray':      if (rayActive(state, p, benchIdx, log))    { refreshBoard(); checkPendingEffects(); } break;
    case 'charmy':   if (charmyActive(state, p, benchIdx, log)) { refreshBoard(); winGuard(); } break;
    case 'espio':    if (espioActive(state, p, benchIdx, log))  { refreshBoard(); winGuard(); } break;
    case 'vector':   if (vectorActive(state, p, benchIdx, log)) { refreshBoard(); winGuard(); } break;
    // ── Persona 5 units ──────────────────────────────────────────────────
    case 'caroline':          if (carolineActive(state, p, benchIdx, log))         { refreshBoard(); winGuard(); } break;
    case 'justine':           if (justineActive(state, p, benchIdx, log))          { refreshBoard(); winGuard(); } break;
    case 'tae_takumi':        if (taeTakumiActive(state, p, benchIdx, log))        { refreshBoard(); winGuard(); } break;
    case 'sojiro_sakura':     if (sojiroSakuraActive(state, p, benchIdx, log))     { refreshBoard(); winGuard(); } break;
    case 'sae_niijima':       if (saeNiijimaActive(state, p, benchIdx, log))       { refreshBoard(); winGuard(); } break;
    case 'sadayo_kawakami':   if (sadayoKawakamiActive(state, p, benchIdx, log))   { refreshBoard(); winGuard(); } break;
    case 'suguru_kamoshida':  if (suguruKamoshidaActive(state, p, benchIdx, log))  { refreshBoard(); winGuard(); } break;
    case 'ryuji_sakamoto':    if (ryujiSakamotoActive(state, p, benchIdx, log))    { refreshBoard(); winGuard(); } break;
    case 'ann_takamaki':      if (annTakamakiActive(state, p, benchIdx, log))      { refreshBoard(); winGuard(); } break;
    case 'morgana':           openMorganaModal(p, benchIdx); break;
    case 'yusuke_kitagawa':   openYusukeModal(p, benchIdx);  break;
    case 'makoto_niijima':    if (makotoNiijimaActive(state, p, benchIdx, log))    { refreshBoard(); winGuard(); } break;
    case 'futaba_sakura':     if (futabaSakuraActive(state, p, benchIdx, log))     { refreshBoard(); winGuard(); } break;
    case 'haru_okumura':      if (haruOkumuraActive(state, p, benchIdx, log))      { refreshBoard(); winGuard(); } break;
    case 'sumire_yoshizawa':  openSumireModal(p, benchIdx);  break;
    default: addLog(`\ud83c\udca1 Joker: cannot copy ${unit.id} in local mode`, 'damage');
  }
}

// ── Morgana: trade itself for an opponent bench unit ─────────────────────
function openMorganaModal(p, benchIdx) {
  const opp = opponent(p);
  if (state.players[opp].bench.length === 0) {
    addLog('🚌 Morgana: no opponent bench units to target', 'phase'); return;
  }
  const c = document.getElementById('target-options');
  c.innerHTML = '';
  document.getElementById('target-title').textContent = 'MORGANA: SELECT TARGET';
  document.getElementById('target-desc').textContent  = 'Morgana and the chosen unit both go to discard:';
  state.players[opp].bench.forEach((unit, ui) => {
    c.appendChild(mkBtn(`${unit.name} (${unit.currentHp}/${unit.hp} HP)`, () => {
      morganaActive(state, p, benchIdx, ui, log);
      closeOverlay('target-overlay');
      refreshBoard(); winGuard();
    }));
  });
  showOverlay('target-overlay');
}

// ── Yusuke: copy a passive from any bench unit ────────────────────────────
function openYusukeModal(p, benchIdx) {
  const bench = state.players[p].bench.filter((_, i) => i !== benchIdx);
  if (bench.length === 0) {
    addLog('🎨 Yusuke: no other bench units to copy from', 'phase'); return;
  }
  const c = document.getElementById('target-options');
  c.innerHTML = '';
  document.getElementById('target-title').textContent = 'YUSUKE: COPY ACTIVE FROM';
  document.getElementById('target-desc').textContent  = 'Yusuke copies and fires this unit\'s active:';
  // Yusuke copies AND fires another unit's active
  state.players[p].bench.forEach((unit, ui) => {
    if (ui === benchIdx) return; // skip Yusuke himself
    c.appendChild(mkBtn(`${unit.name} (${unit.currentHp}/${unit.hp} HP)`, () => {
      yusukeKitagawaActive(state, p, benchIdx, ui, log);
      closeOverlay('target-overlay');
      refreshBoard(); winGuard();
    }));
  });
  showOverlay('target-overlay');
}

// ── Sumire: 20 unblockable damage to one opponent bench unit ─────────────
function openSumireModal(p, benchIdx) {
  const opp = opponent(p);
  if (state.players[opp].bench.length === 0) {
    addLog('🌸 Sumire: no opponent bench units to target', 'phase'); return;
  }
  const c = document.getElementById('target-options');
  c.innerHTML = '';
  document.getElementById('target-title').textContent = 'SUMIRE: SELECT TARGET';
  document.getElementById('target-desc').textContent  = 'Deal 20 unblockable damage to a bench unit:';
  state.players[opp].bench.forEach((unit, ui) => {
    c.appendChild(mkBtn(`${unit.name} (${unit.currentHp}/${unit.hp} HP)`, () => {
      sumireYoshizawaActive(state, p, benchIdx, ui, log);
      closeOverlay('target-overlay');
      refreshBoard(); winGuard();
    }));
  });
  showOverlay('target-overlay');
}

function openSonicModal() {
  const p = state.activePlayer;
  if (state.players[p].hand.length === 0) { addLog('\u274c Sonic: hand is empty', 'damage'); return; }
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
      addLog(`\ud83d\udc41 Dragon's Eye: ${card.name} taken into hand`, 'draw');
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
  document.getElementById('polaris-pact-desc').textContent = `Player ${opponentIdx + 1}: choose 1 card to discard.`;
  const c = document.getElementById('polaris-pact-options');
  c.innerHTML = '';
  if (hand.length === 0) {
    addLog('\ud83c\udf0c Polaris Pact: opponent has no cards', 'phase');
    state.pendingPolarisPact = null;
    closeOverlay('polaris-pact-overlay');
    refreshBoard(); return;
  }
  hand.forEach((card, hi) => {
    c.appendChild(mkBtn(`${card.name} (${card.type})`, () => {
      const disc = state.players[opponentIdx].hand.splice(hi, 1)[0];
      state.players[opponentIdx].discard.push(disc);
      addLog(`\ud83c\udf0c Polaris Pact: P${opponentIdx + 1} discards ${disc.name}`, 'damage');
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
      state.players[playerIdx].deck.splice(si, 1);
      state.players[playerIdx].discard.push(card);
      addLog(`\ud83d\udc3f Ray: ${card.name} sent to discard`, 'play');
      const rouge = state.players[playerIdx].bench.find(u => u.id === 'rouge' && !u.exhausted);
      if (rouge && state.players[playerIdx].deck.length > 0) {
        const drawn = state.players[playerIdx].deck.shift();
        state.players[playerIdx].hand.push(drawn);
        state.missedDraws[playerIdx] = 0;
        addLog(`\ud83e\udd87 Rouge: draws ${drawn.name} (Ray discard event)`, 'draw');
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
      `${_extremeGearSelected.size} selected \u2192 +${_extremeGearSelected.size} Energy`;
  };
  hand.forEach((card, hi) => {
    const btn = document.createElement('button');
    btn.className = 'modal-card-btn';
    btn.textContent = `${card.name} (${card.type})`;
    btn.dataset.idx = hi;
    btn.onclick = () => {
      if (_extremeGearSelected.has(hi)) {
        _extremeGearSelected.delete(hi); btn.style.borderColor = ''; btn.style.color = '';
      } else {
        _extremeGearSelected.add(hi); btn.style.borderColor = 'var(--gold)'; btn.style.color = 'var(--gold)';
      }
      updateCount();
    };
    c.appendChild(btn);
  });
  updateCount();
  showOverlay('extreme-gear-overlay');
}

function handlePassContinue() {
  closeOverlay('pass-overlay');
  if (_gameOver) return;
  document.getElementById('btn-continue').onclick = handlePassContinue;
  advanceTurn(state, log, emit);
}

function bindStaticButtons() {
  document.getElementById('btn-end-phase').addEventListener('click', () => {
    if (state.phase === 'setup') return;
    if (state.phase === 'main')        enterAttackPhase(state, log, emit);
    else if (state.phase === 'attack') enterEndPhase(state, log, emit);
  });

  document.getElementById('btn-leader-active').addEventListener('click', () => {
    if (state.phase === 'main') openLeaderActiveModal(state.activePlayer);
  });

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

  document.getElementById('btn-take-hit').addEventListener('click', () => {
    const btn = document.getElementById('btn-take-hit');
    const ap = btn._attackerP, dp = btn._defenderP;
    closeOverlay('intercept-overlay');
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

function mkBtn(label, onClick) {
  const btn = document.createElement('button');
  btn.className = 'modal-card-btn';
  btn.textContent = label;
  btn.onclick = onClick;
  return btn;
}

export function initHandlers(gameState) {
  state = gameState;
  bindStaticButtons();
  state.phase = 'setup';
  state._setupPlayer = 0;
  runSetupPhase(0);
}

function runSetupPhase(playerIdx) {
  state.phase = 'setup';
  state._setupPlayer = playerIdx;
  document.getElementById('pass-title').textContent = `PLAYER ${playerIdx + 1} \u2014 SETUP`;
  document.getElementById('pass-msg').textContent =
    `Player ${playerIdx + 1}: deploy any units from your hand to your bench, then press Continue.`;

  const btn = document.getElementById('btn-continue');
  btn.onclick = function onSetupContinue() {
    closeOverlay('pass-overlay');
    refreshBoard();
    document.getElementById('btn-end-phase').textContent = 'Done Setup \u2192';
    document.getElementById('btn-end-phase').disabled = false;
    document.getElementById('btn-end-phase').onclick = function onSetupDone() {
      document.getElementById('btn-end-phase').onclick = null;
      document.getElementById('btn-end-phase').textContent = 'Start Attack \u2192';
      if (playerIdx === 0) {
        document.getElementById('pass-title').textContent = 'PASS TO PLAYER 2';
        document.getElementById('pass-msg').textContent =
          `Player 2: deploy any units from your hand to your bench, then press Continue.`;
        const btn2 = document.getElementById('btn-continue');
        btn2.onclick = function onP2SetupContinue() { closeOverlay('pass-overlay'); runSetupPhase(1); };
        showOverlay('pass-overlay');
      } else {
        state.phase = 'big_scry';
        delete state._setupPlayer;
        document.getElementById('pass-title').textContent = `PLAYER ${state.activePlayer + 1} GOES FIRST`;
        document.getElementById('pass-msg').textContent =
          `Coin flip result: Player ${state.activePlayer + 1} starts! Hand the device over.`;
        const btnF = document.getElementById('btn-continue');
        btnF.onclick = function onFirstContinue() {
          closeOverlay('pass-overlay');
          btnF.onclick = handlePassContinue;
          startTurn(state, log, emit);
          refreshBoard();
        };
        showOverlay('pass-overlay');
      }
    };
  };

  render(state);
  showOverlay('pass-overlay');
}