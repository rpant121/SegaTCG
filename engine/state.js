/**
 * STATE
 * gameState factory and pure utility helpers.
 * No DOM. No side-effects beyond returning new/mutated state objects.
 */

import { LEADER_DATA, UNIT_DATA, EQUIP_DATA } from './cards.js';

let _counter = 0;
export function uid() { return `c${++_counter}`; }

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const opponent = (p) => (p === 0 ? 1 : 0);

/**
 * Build a full card object array from a list of card IDs.
 */
function idsToCards(idList) {
  return idList.map(id => {
    const data = UNIT_DATA[id] ?? Object.values(EQUIP_DATA).find(c => c.id === id);
    if (!data) throw new Error(`Unknown card id: ${id}`);
    return { ...data, uid: uid() };
  });
}

/**
 * @param {string[]} deckIds0  - ordered card id list for Player 1 (30 cards)
 * @param {string[]} deckIds1  - ordered card id list for Player 2 (30 cards)
 */
export function createInitialState(deckIds0, deckIds1) {
  const deck0 = shuffle(idsToCards(deckIds0));
  const deck1 = shuffle(idsToCards(deckIds1));
  const hand0 = deck0.splice(0, 5);
  const hand1 = deck1.splice(0, 5);
  const firstPlayer = Math.random() < 0.5 ? 0 : 1;

  return {
    turn: 1,
    activePlayer: firstPlayer,
    _firstPlayer: firstPlayer,
    phase: 'big_scry',

    missedDraws: [0, 0],
    energy:      [0, 0],
    energyMax:   [0, 0],

    // Board-wide effects (all cleared in End Phase unless noted)
    activeStage:         null,
    chaosEmeraldBuff:    [0, 0],
    powerGloveBuff:      [0, 0],
    shieldActive:        [false, false],  // cleared after absorbing 1 turn
    masterEmeraldActive: false,

    // ── Per-turn tracking (reset in End Phase) ────────────────────────────
    activesUsedThisTurn:    0,      // Silver active: count actives fired this turn
    equipmentPlayedThisTurn:[0, 0], // Charmy passive/active: equipment plays per player
    energySpentThisTurn:    [0, 0], // Vector active: total energy spent this turn
    leaderDamageTakenThisTurn: [false, false], // legacy; replaced by per-event draw
    rougeUsedThisTurn:      [false, false], // Rouge active: once per turn despite no exhaust
    leaderUsedThisTurn:     [false, false], // Leader active: once per turn

    // ── Omega: persistent exhaust ─────────────────────────────────────────
    // Maps unit uid → the turn number on which the lock expires (unlocks at
    // the START of the Omega-player's NEXT turn).
    persistentExhaust: [{}, {}],

    // ── Pending async UI prompts ──────────────────────────────────────────
    pendingBigScry:      null,  // { playerIdx, card }
    pendingDragonsEye:   null,  // { playerIdx, cards }
    pendingPolarisPact:  null,  // { opponentIdx }
    pendingRayActive:    null,  // { playerIdx, cards }  (Ray's top-3 discard choice)
    pendingExtremeGear:  null,  // { playerIdx }         (choose cards to discard)
    pendingMightyAttack: false, // true while second attack target selection is open
    pendingBlock:        null,  // { attackerP, defenderP } — awaiting blocker choice

    firstTurn: true,

    players: [
      makePlayerState(deck0, hand0),
      makePlayerState(deck1, hand1),
    ],
  };
}

function makePlayerState(deck, hand) {
  return {
    leader:  { ...LEADER_DATA, uid: uid(), currentHp: LEADER_DATA.hp },
    bench:   [],
    hand,
    deck,
    discard: [],
  };
}
