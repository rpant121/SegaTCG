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

function idsToCards(idList) {
  return idList.map(id => {
    const data = UNIT_DATA[id] ?? Object.values(EQUIP_DATA).find(c => c.id === id);
    if (!data) throw new Error(`Unknown card id: ${id}`);
    return { ...data, uid: uid() };
  });
}

export function createInitialState(deckIds0, deckIds1, leaderId0 = 'sonic', leaderId1 = 'sonic') {
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

    activeStage:         null,
    chaosEmeraldBuff:    [0, 0],
    powerGloveBuff:      [0, 0],
    shieldActive:        [false, false],
    masterEmeraldActive: false,

    activesUsedThisTurn:       0,
    usedActivesThisTurn:       [],
    equipmentPlayedThisTurn:   [0, 0],
    energySpentThisTurn:       [0, 0],
    leaderDamageTakenThisTurn: [false, false],
    rougeUsedThisTurn:         [false, false],
    leaderUsedThisTurn:        [false, false],
    shieldReduction:           [0, 0],
    supportDiedLastTurn:       [false, false],

    // P5 passive/active tracking
    haruShield:                [false, false],   // Haru: full damage prevention
    tauntUnit:                 [null, null],      // Sojiro: taunt uid
    unblockableAttack:         [false, false],    // Sae: next attack unblockable
    healedThisTurn:            [0, 0],            // Tae/Makoto: HP healed tracking
    dmgToEnemyUnitsThisTurn:   [0, 0],            // Futaba: damage dealt to units
    opponentDiscardsThisTurn:  [0, 0],            // Ann/Sumire/Kamoshida: discard count
    carolineLock:              [false, false],    // Caroline revival condition
    justineLock:               [false, false],    // Justine revival condition
    kamoshidaPassive:          [false, false],    // Kamoshida: damage triggers discard
    contractNoDrawUntil:       [0, 0],            // Contract of Rebellion draw lock
    pendingYusukeTarget:       null,
    justineDisabledUid:        null,   // Justine passive: this unit uid cannot use active
    pendingLeblanc:            null,
    pendingGuardPersona:       null,
    pendingArsene:             null,

    pendingBigScry:      null,
    pendingDragonsEye:   null,
    pendingPolarisPact:  null,
    pendingRayActive:    null,
    pendingExtremeGear:  null,
    pendingMightyAttack: false,
    pendingBlock:        null,

    firstTurn: true,

    players: [
      makePlayerState(deck0, hand0, leaderId0),
      makePlayerState(deck1, hand1, leaderId1),
    ],
  };
}

function makePlayerState(deck, hand, leaderId = 'sonic') {
  const leaderDef = LEADER_DATA[leaderId] ?? LEADER_DATA.sonic;
  return {
    leader:  { ...leaderDef, uid: uid(), currentHp: leaderDef.hp },
    bench:   [],
    hand,
    deck,
    discard: [],
  };
}