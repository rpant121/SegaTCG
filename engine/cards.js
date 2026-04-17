/**
 * CARD DATA
 * All card definitions. Pure data — no DOM, no state mutations.
 */

export const LEADER_DATA = {
  id: 'sonic',
  name: 'Sonic the Hedgehog',
  type: 'Leader',
  hp: 100,
  damage: 10,
  activeCost: 1,
  activeDesc: 'Discard 1 card from hand → Draw 2 cards. Requires ≥1 card in hand.',
};

export const UNIT_DATA = {

  // ── Original Units ────────────────────────────────────────────────────────

  tails: {
    id: 'tails', name: 'Tails', type: 'Unit', cost: 0, hp: 20,
    passive: { type: 'draw_end', amount: 1 },
    passiveDesc: 'Draw 1 card at end of turn',
    activeCost: 2,
    activeDesc: 'Play 1 card from your discard pile',
  },
  knuckles: {
    id: 'knuckles', name: 'Knuckles', type: 'Unit', cost: 0, hp: 40,
    passive: { type: 'attack_boost', amount: 10 },
    passiveDesc: '+10 to Leader Attack',
    activeCost: 1,
    activeDesc: 'Deal 1 damage to 1 opponent Support Unit',
  },
  amy: {
    id: 'amy', name: 'Amy', type: 'Unit', cost: 0, hp: 30,
    passive: { type: 'attack_boost', amount: 10 },
    passiveDesc: '+10 to Leader Attack',
    activeCost: 1,
    activeDesc: "Deal 1 damage to opponent's Leader",
  },
  cream: {
    id: 'cream', name: 'Cream', type: 'Unit', cost: 0, hp: 20,
    passive: { type: 'damage_reduction', amount: 10 },
    passiveDesc: '-10 to damage taken by Leader',
    activeCost: 1,
    activeDesc: 'Heal 1 HP from any friendly unit (cannot exceed max HP)',
  },
  big: {
    id: 'big', name: 'Big', type: 'Unit', cost: 0, hp: 40,
    passive: { type: 'big_scry', amount: 0 },
    passiveDesc: 'Start of turn: look at top deck card, may discard it',
    activeCost: 3,
    activeDesc: "Discard a random card from opponent's hand",
  },

  // ── Archetype: Aggro ─────────────────────────────────────────────────────
  // Core: Knuckles + Amy stack attack passives. Silver keeps them un-exhausted
  // while their actives fire. Shadow doubles base damage, Mighty closes games
  // with a second Leader attack.

  silver: {
    id: 'silver', name: 'Silver', type: 'Unit', cost: 0, hp: 30,
    passive: { type: 'silver_cost_reduce', amount: 1 },
    passiveDesc: 'All friendly unit actives cost 1 less energy (minimum 1)',
    activeCost: 3,
    activeDesc: 'Return one of your bench units to your hand.',
  },
  shadow: {
    id: 'shadow', name: 'Shadow', type: 'Unit', cost: 0, hp: 40,
    passive: { type: 'shadow_boost', amount: 1 },
    passiveDesc: "While on bench: double your Leader's base damage. Stacks per Shadow.",
    activeCost: 3,
    activeDesc: "Deal 3 damage to the opponent's Leader. Your Leader takes 10 unblockable, unreducible damage.",
  },
  mighty: {
    id: 'mighty', name: 'Mighty', type: 'Unit', cost: 0, hp: 30,
    passive: { type: 'mighty_draw', amount: 0 },
    passiveDesc: 'After your Leader attacks, if damage dealt was 300 or higher, draw 1 card',
    activeCost: 2,
    activeDesc: 'Your Leader attacks a second time this turn with full target selection. Mighty exhausts.',
  },

  // ── Archetype: Setup / Discard Engine ────────────────────────────────────
  // Core: Big mills expensive cards to discard. Tails replays them cheaply.
  // Sonic active deliberately discards power cards. Rouge draws on each discard
  // event. Blaze resets the loop. Ray surgically feeds the discard.

  rouge: {
    id: 'rouge', name: 'Rouge', type: 'Unit', cost: 0, hp: 20,
    passive: { type: 'rouge_draw', amount: 0 },
    passiveDesc: 'When a card is milled from the top of your deck to your discard, draw 1 card',
    activeCost: 1,
    activeDesc: 'Place the top card of your deck directly into your discard pile. Rouge does NOT exhaust.',
  },
  blaze: {
    id: 'blaze', name: 'Blaze', type: 'Unit', cost: 0, hp: 30,
    passive: { type: 'blaze_sustain', amount: 0 },
    passiveDesc: 'At the end of your turn, if your discard pile has 5+ cards, heal your Leader 1 HP',
    activeCost: 3,
    activeDesc: 'Shuffle your entire discard pile back into your deck, then draw 2 cards. Blaze exhausts.',
  },
  ray: {
    id: 'ray', name: 'Ray', type: 'Unit', cost: 0, hp: 40,
    passive: { type: 'ray_passive', amount: 0 },
    passiveDesc: 'When you play a card from your discard pile, draw 1 card',
    activeCost: 2,
    activeDesc: 'Look at the top 3 cards of your deck — place 1 directly into your discard, return the rest in any order',
  },

  // ── Archetype: Rings / Resource Burst ────────────────────────────────────
  // Core: Stack energy via Ring + Speed Shoes + Extreme Gear + Radical Highway.
  // Charmy reduces cost of chained equipment. Espio recovers hand after the nova.
  // Vector cashes in total energy spent as direct damage. Super Form doubles
  // available energy for the ultimate burst turn.

  charmy: {
    id: 'charmy', name: 'Charmy', type: 'Unit', cost: 0, hp: 40,
    passive: { type: 'charmy_discount', amount: 0 },
    passiveDesc: 'Each equipment card played this turn after the first costs 1 less energy (minimum 0)',
    activeCost: 2,
    activeDesc: 'Draw 1 card for each equipment card played this turn',
  },
  espio: {
    id: 'espio', name: 'Espio', type: 'Unit', cost: 0, hp: 30,
    passive: { type: 'espio_draw', amount: 0 },
    passiveDesc: 'After your Draw Phase: draw 1 extra card for each equipment card in your discard (max 2 extra)',
    activeCost: 2,
    activeDesc: 'Shuffle up to 3 equipment cards from your discard back into your deck, then draw 1',
  },
  vector: {
    id: 'vector', name: 'Vector', type: 'Unit', cost: 0, hp: 20,
    passive: { type: 'vector_passive', amount: 0 },
    passiveDesc: 'Each time your Leader takes damage this turn, draw 1 card',
    activeCost: 3,
    activeDesc: 'Deal damage equal to the total energy spent this turn (including this active\'s cost)',
  },
};

export const EQUIP_DATA = {

  // ── Original Equipment ────────────────────────────────────────────────────

  ring: {
    id: 'ring', name: 'Ring', type: 'Equipment', cost: 0,
    isPersistent: false,
    effectDesc: 'Gain 1 Energy immediately.',
  },
  chaos_emerald: {
    id: 'chaos_emerald', name: 'Chaos Emerald', type: 'Equipment', cost: 2,
    isPersistent: false,
    effectDesc: 'Leader gains +20 Damage until end of this turn.',
  },
  master_emerald: {
    id: 'master_emerald', name: 'Master Emerald', type: 'Equipment', cost: 4,
    isGenesis: true, isPersistent: false,
    effectDesc: 'This turn: all bench unit actives cost 0 and do not exhaust. Cleared in End Phase.',
  },
  green_hill_zone: {
    id: 'green_hill_zone', name: 'Green Hill Zone', type: 'Stage', cost: 1,
    isPersistent: true,
    effectDesc: 'While active: both players draw 1 extra card during Draw Phase.',
  },
  elemental_shield: {
    id: 'elemental_shield', name: 'Elemental Shield', type: 'Equipment', cost: 1,
    isPersistent: false,
    effectDesc: "Prevent ALL damage to yourself during your opponent's next turn (including KO penalty). Shield clears after absorbing.",
  },

  // ── General Equipment (non-IP-specific) ───────────────────────────────────

  heat_barrier: {
    id: 'heat_barrier', name: 'Heat Barrier', type: 'Equipment', cost: 1,
    isPersistent: false,
    effectDesc: 'Heal your Leader for 20 HP. Cannot exceed max HP.',
  },
  dragons_eye: {
    id: 'dragons_eye', name: "Dragon's Eye", type: 'Equipment', cost: 2,
    isPersistent: false,
    effectDesc: 'Look at the top 3 cards of your deck. Put 1 into your hand; return the rest on top in any order.',
  },
  power_glove: {
    id: 'power_glove', name: 'Power Glove', type: 'Equipment', cost: 3,
    isPersistent: false,
    effectDesc: 'Your Leader deals +30 Damage this turn only.',
  },
  midnight_carnival: {
    id: 'midnight_carnival', name: 'Midnight Carnival', type: 'Stage', cost: 2,
    isPersistent: true,
    effectDesc: "While active: when a bench unit is KO'd, its controller takes 0 penalty damage instead of 2.",
  },
  polaris_pact: {
    id: 'polaris_pact', name: 'Polaris Pact', type: 'Genesis', cost: 5,
    isGenesis: true, isPersistent: false,
    effectDesc: 'Both players draw until they have 6 cards in hand. Then your opponent discards 1 card of their choice.',
  },

  // ── Rings Archetype Equipment ─────────────────────────────────────────────

  speed_shoes: {
    id: 'speed_shoes', name: 'Speed Shoes', type: 'Equipment', cost: 1,
    isPersistent: false,
    effectDesc: 'Gain 3 Energy immediately.',
  },
  extreme_gear: {
    id: 'extreme_gear', name: 'Extreme Gear', type: 'Equipment', cost: 0,
    isPersistent: false,
    effectDesc: 'Discard any number of cards from your hand — gain 1 Energy for each card discarded.',
  },
  radical_highway: {
    id: 'radical_highway', name: 'Radical Highway', type: 'Stage', cost: 1,
    isPersistent: true,
    effectDesc: 'While active: each player gains 1 extra energy at the start of their turn.',
  },
  super_form: {
    id: 'super_form', name: 'Super Form', type: 'Genesis', cost: 4,
    isGenesis: true, isPersistent: false,
    effectDesc: 'Double your current energy.',
  },
};

/**
 * Build a legal 30-card deck for the default game.
 * Players will customise this via the deck builder.
 * @deprecated — use deck builder instead; kept for reference.
 */
export function makeDeck(uidFn) {
  const cards = [];
  const add = (data, n) => {
    for (let i = 0; i < n; i++) cards.push({ ...data, uid: uidFn() });
  };

  // Units (3 × 10 = 30... too many — pick a balanced mix)
  add(UNIT_DATA.tails,    2);
  add(UNIT_DATA.knuckles, 2);
  add(UNIT_DATA.amy,      2);
  add(UNIT_DATA.cream,    1);
  add(UNIT_DATA.big,      1);
  add(UNIT_DATA.silver,   1);
  add(UNIT_DATA.shadow,   1);
  add(UNIT_DATA.mighty,   1);
  add(UNIT_DATA.rouge,    1);
  add(UNIT_DATA.blaze,    1);
  add(UNIT_DATA.ray,      1);
  add(UNIT_DATA.charmy,   1);
  add(UNIT_DATA.espio,    1);
  add(UNIT_DATA.vector,   1); // 16 units

  // Equipment
  add(EQUIP_DATA.ring,             2);
  add(EQUIP_DATA.chaos_emerald,    2);
  add(EQUIP_DATA.elemental_shield, 1);
  add(EQUIP_DATA.green_hill_zone,  1);
  add(EQUIP_DATA.heat_barrier,     1);
  add(EQUIP_DATA.power_glove,      1);
  add(EQUIP_DATA.speed_shoes,      2);
  add(EQUIP_DATA.extreme_gear,     1);
  add(EQUIP_DATA.radical_highway,  1);
  add(EQUIP_DATA.dragons_eye,      1); // 13 equipment

  // Genesis (max 1 per deck)
  add(EQUIP_DATA.master_emerald,   1); // 1 genesis

  return cards; // 30 total — caller shuffles
}
