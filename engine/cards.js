/**
 * CARD DATA
 * All card definitions. Pure data — no DOM, no state mutations.
 */

export const LEADER_DATA = {
  sonic: {
    id: 'sonic', name: 'Sonic the Hedgehog', type: 'Leader', ip: 'Sonic',
    hp: 100, damage: 10, activeCost: 1,
    activeDesc: 'Discard 1 card from hand → Draw 2 cards. Requires ≥1 card in hand.',
  },
  joker: {
    id: 'joker', name: 'Joker', type: 'Leader', ip: 'Persona 5',
    hp: 150, damage: 10, activeCost: 1,
    activeDesc: 'Gain and activate any 3-cost or below active from your bench. Pay 1 extra to copy 4-cost or above abilities.',
  },
  kiryu: {
    id: 'kiryu', name: 'Kazuma Kiryu', type: 'Leader', ip: 'Yakuza',
    hp: 200, damage: 20, activeCost: 2,
    activeDesc: '+10 attack this turn. Can be activated multiple times per turn.',
  },
};

// Default leader for backwards compatibility
export const LEADER_DATA_DEFAULT = LEADER_DATA.sonic;

export const UNIT_DATA = {

  // ── Sonic IP ──────────────────────────────────────────────────────────────

  tails: {
    id: 'tails', name: 'Tails', type: 'Unit', ip: 'Sonic', cost: 0, hp: 40,
    passive: { type: 'draw_end', amount: 1 },
    passiveDesc: 'Draw 1 card at end of turn',
    activeCost: 2,
    activeDesc: 'Play 1 card from your discard pile — card shuffles back into deck after use.',
  },
  knuckles: {
    id: 'knuckles', name: 'Knuckles', type: 'Unit', ip: 'Sonic', cost: 0, hp: 60,
    passive: { type: 'attack_boost', amount: 10 },
    passiveDesc: '+10 to Leader Attack',
    activeCost: 1,
    activeDesc: 'Deal 10 damage to 1 opponent Support Unit',
  },
  amy: {
    id: 'amy', name: 'Amy', type: 'Unit', ip: 'Sonic', cost: 0, hp: 50,
    passive: { type: 'attack_boost', amount: 10 },
    passiveDesc: '+10 to Leader Attack',
    activeCost: 1,
    activeDesc: "Deal 10 damage to opponent's Leader",
  },
  cream: {
    id: 'cream', name: 'Cream', type: 'Unit', ip: 'Sonic', cost: 0, hp: 40,
    passive: { type: 'damage_reduction', amount: 10 },
    passiveDesc: '-10 to damage taken by Leader',
    activeCost: 1,
    activeDesc: 'Heal 10 HP from any friendly unit (cannot exceed max HP)',
  },
  big: {
    id: 'big', name: 'Big', type: 'Unit', ip: 'Sonic', cost: 0, hp: 60,
    passive: { type: 'big_scry', amount: 0 },
    passiveDesc: 'Start of turn: look at top deck card, may discard it',
    activeCost: 3,
    activeDesc: "Discard a random card from opponent's hand",
  },
  silver: {
    id: 'silver', name: 'Silver', type: 'Unit', ip: 'Sonic', cost: 0, hp: 50,
    passive: { type: 'silver_cost_reduce', amount: 1 },
    passiveDesc: 'All friendly unit actives cost 1 less energy (minimum 1)',
    activeCost: 3,
    activeDesc: 'Return one of your bench units to your hand (active resets).',
  },
  shadow: {
    id: 'shadow', name: 'Shadow', type: 'Unit', ip: 'Sonic', cost: 0, hp: 60,
    passive: { type: 'shadow_boost', amount: 1 },
    passiveDesc: "While on bench: double your Leader's base damage. Stacks per Shadow.",
    activeCost: 2,
    activeDesc: 'Both Leaders take 10 unblockable, unreducible damage.',
  },
  mighty: {
    id: 'mighty', name: 'Mighty', type: 'Unit', ip: 'Sonic', cost: 0, hp: 50,
    passive: { type: 'mighty_draw', amount: 0 },
    passiveDesc: 'After your Leader attacks, if damage dealt was 30 or higher, draw 1 card',
    activeCost: 2,
    activeDesc: 'Your Leader attacks a second time this turn. Opponent may block.',
  },
  rouge: {
    id: 'rouge', name: 'Rouge', type: 'Unit', ip: 'Sonic', cost: 0, hp: 40,
    passive: { type: 'rouge_draw', amount: 0 },
    passiveDesc: 'When a card is milled from deck to discard, draw 1 card',
    activeCost: 1,
    activeDesc: 'Place the top card of your deck directly into your discard pile. Rouge does NOT exhaust.',
  },
  blaze: {
    id: 'blaze', name: 'Blaze', type: 'Unit', ip: 'Sonic', cost: 0, hp: 50,
    passive: { type: 'blaze_sustain', amount: 0 },
    passiveDesc: 'At the end of your turn, if your discard pile has 5+ cards, heal your Leader 10 HP',
    activeCost: 3,
    activeDesc: 'Shuffle your entire discard pile back into your deck, then draw 2 cards. Blaze exhausts.',
  },
  ray: {
    id: 'ray', name: 'Ray', type: 'Unit', ip: 'Sonic', cost: 0, hp: 60,
    passive: { type: 'ray_passive', amount: 0 },
    passiveDesc: 'When you play a card from your discard pile, draw 1 card',
    activeCost: 2,
    activeDesc: 'Look at the top 3 cards of your deck — place 1 directly into your discard, return the rest in any order',
  },
  charmy: {
    id: 'charmy', name: 'Charmy', type: 'Unit', ip: 'Sonic', cost: 0, hp: 60,
    passive: { type: 'charmy_discount', amount: 0 },
    passiveDesc: 'Each equipment card played this turn after the first costs 1 less energy (minimum 0)',
    activeCost: 2,
    activeDesc: 'Draw 1 card for each equipment card played this turn',
  },
  espio: {
    id: 'espio', name: 'Espio', type: 'Unit', ip: 'Sonic', cost: 0, hp: 50,
    passive: { type: 'espio_draw', amount: 0 },
    passiveDesc: 'After your Draw Phase: draw 1 extra card for each equipment card in your discard (max 2 extra)',
    activeCost: 2,
    activeDesc: 'Shuffle up to 3 equipment cards from your discard back into your deck, then draw 1',
  },
  vector: {
    id: 'vector', name: 'Vector', type: 'Unit', ip: 'Sonic', cost: 0, hp: 40,
    passive: { type: 'vector_passive', amount: 0 },
    passiveDesc: 'Each time your Leader takes damage this turn, draw 1 card',
    activeCost: 3,
    activeDesc: "Deal damage equal to the total energy spent this turn ×10 (including this active's cost)",
  },

  // ── Persona 5 IP ──────────────────────────────────────────────────────────

  caroline: {
    id: 'caroline', name: 'Caroline', type: 'Unit', ip: 'Persona 5', cost: 0, hp: 40,
    passive: { type: 'caroline_passive', amount: 0 },
    passiveDesc: 'If Justine is on bench: the opponent can only play 1 equipment card this turn.',
    activeCost: 2,
    activeDesc: 'If Justine was sent from the bench to the discard alone on your previous turn, revive her to your bench.',
  },
  justine: {
    id: 'justine', name: 'Justine', type: 'Unit', ip: 'Persona 5', cost: 0, hp: 40,
    passive: { type: 'justine_passive', amount: 0 },
    passiveDesc: 'If Caroline is on bench: disable an enemy active ability until your next turn.',
    activeCost: 2,
    activeDesc: 'If Caroline was sent from the bench to the discard alone on your previous turn, revive her to your bench.',
  },
  tae_takumi: {
    id: 'tae_takumi', name: 'Tae Takumi', type: 'Unit', ip: 'Persona 5', cost: 0, hp: 50,
    passive: { type: 'damage_reduction', amount: 10 },
    passiveDesc: "Your leader gains -10 damage taken during your opponent's turn.",
    activeCost: 2,
    activeDesc: 'Heal your leader for 20 HP (cannot exceed max HP).',
  },
  sojiro_sakura: {
    id: 'sojiro_sakura', name: 'Sojiro Sakura', type: 'Unit', ip: 'Persona 5', cost: 0, hp: 60,
    passive: { type: 'damage_reduction', amount: 10 },
    passiveDesc: "Your leader gains -10 damage taken during your opponent's turn.",
    activeCost: 2,
    activeDesc: 'Gain taunt until your next turn (opponent must attack this unit first if able).',
  },
  sae_niijima: {
    id: 'sae_niijima', name: 'Sae Niijima', type: 'Unit', ip: 'Persona 5', cost: 0, hp: 60,
    passive: { type: 'sae_passive', amount: 0 },
    passiveDesc: "Opponent's damage reduction effects are reduced by 10.",
    activeCost: 4,
    activeDesc: 'Your next Leader attack this turn cannot be blocked.',
  },
  sadayo_kawakami: {
    id: 'sadayo_kawakami', name: 'Sadayo Kawakami', type: 'Unit', ip: 'Persona 5', cost: 0, hp: 40,
    passive: { type: 'attack_boost', amount: 10 },
    passiveDesc: '+10 to Leader Attack.',
    activeCost: 2,
    activeDesc: "Deal 10 damage to each support unit on the opponent's bench.",
  },
  suguru_kamoshida: {
    id: 'suguru_kamoshida', name: 'Suguru Kamoshida', type: 'Unit', ip: 'Persona 5', cost: 0, hp: 50,
    passive: { type: 'kamoshida_passive', amount: 0 },
    passiveDesc: 'When damage is dealt to the opposing leader this turn, they discard 1 card at random.',
    activeCost: 3,
    activeDesc: 'Your opponent discards 2 cards at random.',
  },
  ryuji_sakamoto: {
    id: 'ryuji_sakamoto', name: 'Ryuji Sakamoto', type: 'Unit', ip: 'Persona 5', cost: 0, hp: 60,
    passive: { type: 'ryuji_passive', amount: 0 },
    passiveDesc: 'After your Leader attacks, if damage dealt was 20 or higher, your leader heals 10 HP.',
    activeCost: 1,
    activeDesc: "Deal 10 damage to your opponent's leader.",
  },
  ann_takamaki: {
    id: 'ann_takamaki', name: 'Ann Takamaki', type: 'Unit', ip: 'Persona 5', cost: 0, hp: 40,
    passive: { type: 'ann_passive', amount: 0 },
    passiveDesc: 'Whenever the opponent discards a card, deal 10 damage to their leader.',
    activeCost: 2,
    activeDesc: "Exile a card from the opponent's discard for each card they discarded this turn.",
  },
  morgana: {
    id: 'morgana', name: 'Morgana', type: 'Unit', ip: 'Persona 5', cost: 0, hp: 40,
    passive: { type: 'none', amount: 0 },
    passiveDesc: 'No passive.',
    activeCost: 2,
    activeDesc: 'Morgana and one enemy benched support unit are both sent to the discard.',
  },
  yusuke_kitagawa: {
    id: 'yusuke_kitagawa', name: 'Yusuke Kitagawa', type: 'Unit', ip: 'Persona 5', cost: 0, hp: 40,
    passive: { type: 'yusuke_passive', amount: 0 },
    passiveDesc: 'When Yusuke is placed on the bench, copy a passive from any benched support unit.',
    activeCost: 2,
    activeDesc: "Copy and activate any friendly supporter's active ability.",
  },
  makoto_niijima: {
    id: 'makoto_niijima', name: 'Makoto Niijima', type: 'Unit', ip: 'Persona 5', cost: 0, hp: 40,
    passive: { type: 'makoto_passive', amount: 0 },
    passiveDesc: 'After your Leader attacks, if damage dealt was 20 or higher, your leader heals 10 HP.',
    activeCost: 2,
    activeDesc: 'Deal damage to the opposing leader equal to total HP healed this turn.',
  },
  futaba_sakura: {
    id: 'futaba_sakura', name: 'Futaba Sakura', type: 'Unit', ip: 'Persona 5', cost: 0, hp: 40,
    passive: { type: 'futaba_passive', amount: 0 },
    passiveDesc: 'You may scry 1 at the end of each turn.',
    activeCost: 2,
    activeDesc: 'Draw cards equal to total damage dealt to enemy units this turn.',
  },
  haru_okumura: {
    id: 'haru_okumura', name: 'Haru Okumura', type: 'Unit', ip: 'Persona 5', cost: 0, hp: 40,
    passive: { type: 'haru_passive', amount: 0 },
    passiveDesc: 'Haru cannot be targeted by opposing damage or abilities unless it is a direct Leader attack.',
    activeCost: 2,
    activeDesc: 'Prevent all damage to your leader until your next turn. Haru stays exhausted until the end of your next turn.',
  },
  sumire_yoshizawa: {
    id: 'sumire_yoshizawa', name: 'Sumire Yoshizawa', type: 'Unit', ip: 'Persona 5', cost: 0, hp: 40,
    passive: { type: 'ann_passive', amount: 0 },
    passiveDesc: 'Whenever the opponent discards a card, deal 10 damage to their leader.',
    activeCost: 3,
    activeDesc: 'Deal 20 damage to one opposing benched supporter. Cannot be blocked.',
  },
};

export const EQUIP_DATA = {

  // ── Sonic IP — Equipment ──────────────────────────────────────────────────

  ring: {
    id: 'ring', name: 'Ring', type: 'Equipment', ip: 'Sonic', cost: 0,
    isPersistent: false,
    effectDesc: 'Gain 1 Energy immediately.',
  },
  chaos_emerald: {
    id: 'chaos_emerald', name: 'Chaos Emerald', type: 'Equipment', ip: 'Sonic', cost: 2,
    isPersistent: false,
    effectDesc: 'Leader gains +20 Damage until end of this turn.',
  },
  elemental_shield: {
    id: 'elemental_shield', name: 'Elemental Shield', type: 'Equipment', ip: 'Sonic', cost: 1,
    isPersistent: false,
    effectDesc: '-20 to the next instance of damage you receive (applies once, then clears).',
  },
  chili_dog: {
    id: 'chili_dog', name: 'Chili Dog', type: 'Equipment', ip: 'Sonic', cost: 1,
    isPersistent: false,
    effectDesc: 'Heal your Leader for 20 HP. Cannot exceed max HP.',
  },
  dragons_eye: {
    id: 'dragons_eye', name: "Dragon's Eye", type: 'Equipment', ip: 'Sonic', cost: 2,
    isPersistent: false,
    effectDesc: 'Look at the top 3 cards of your deck. Put 1 into your hand; return the rest on top in any order.',
  },
  power_glove: {
    id: 'power_glove', name: 'Power Glove', type: 'Equipment', ip: 'Sonic', cost: 3,
    isPersistent: false,
    effectDesc: 'Your Leader deals +30 Damage this turn only.',
  },
  speed_shoes: {
    id: 'speed_shoes', name: 'Speed Shoes', type: 'Equipment', ip: 'Sonic', cost: 1,
    isPersistent: false,
    effectDesc: 'Gain 3 Energy immediately.',
  },
  extreme_gear: {
    id: 'extreme_gear', name: 'Extreme Gear', type: 'Equipment', ip: 'Sonic', cost: 0,
    isPersistent: false,
    effectDesc: 'Discard up to 3 cards from your hand — gain 1 Energy per card discarded.',
  },

  // ── Sonic IP — Stages ─────────────────────────────────────────────────────

  green_hill_zone: {
    id: 'green_hill_zone', name: 'Green Hill Zone', type: 'Stage', ip: 'Sonic', cost: 1,
    isPersistent: true,
    effectDesc: 'While active: both players draw 1 extra card during Draw Phase.',
  },
  midnight_carnival: {
    id: 'midnight_carnival', name: 'Midnight Carnival', type: 'Stage', ip: 'Sonic', cost: 2,
    isPersistent: true,
    effectDesc: "While active: KO'd bench units deal 0 penalty damage to their controller.",
  },
  radical_highway: {
    id: 'radical_highway', name: 'Radical Highway', type: 'Stage', ip: 'Sonic', cost: 1,
    isPersistent: true,
    effectDesc: 'While active: each player gains 1 extra energy at the start of their turn.',
  },

  // ── Sonic IP — Genesis ────────────────────────────────────────────────────

  master_emerald: {
    id: 'master_emerald', name: 'Master Emerald', type: 'Genesis', ip: 'Sonic', cost: 4,
    isGenesis: true, isPersistent: false,
    effectDesc: 'This turn: all bench unit actives cost 0 and do not exhaust. Cleared in End Phase.',
  },
  polaris_pact: {
    id: 'polaris_pact', name: 'Polaris Pact', type: 'Genesis', ip: 'Sonic', cost: 2,
    isGenesis: true, isPersistent: false,
    effectDesc: 'If a friendly support died last turn: both players shuffle their hands into their decks. You draw 5, opponent draws 2.',
  },
  super_form: {
    id: 'super_form', name: 'Super Form', type: 'Genesis', ip: 'Sonic', cost: 4,
    isGenesis: true, isPersistent: false,
    effectDesc: 'Double your current energy.',
  },

  // ── Persona 5 IP — Equipment ──────────────────────────────────────────────

  calling_card: {
    id: 'calling_card', name: 'Calling Card', type: 'Equipment', ip: 'Persona 5', cost: 0,
    isPersistent: false,
    effectDesc: 'Your opponent discards a card from their hand at random.',
  },
  treasure_distorted_desire: {
    id: 'treasure_distorted_desire', name: 'Treasure (Distorted Desire)', type: 'Equipment', ip: 'Persona 5', cost: 2,
    isPersistent: false,
    effectDesc: 'Your Leader gains +20 Damage this turn. If your opponent has 3 or fewer cards in hand, gain +40 instead.',
  },
  leblanc_coffee: {
    id: 'leblanc_coffee', name: 'LeBlanc Coffee', type: 'Equipment', ip: 'Persona 5', cost: 1,
    isPersistent: false,
    effectDesc: 'Heal your Leader for 20 HP. Then you may discard 1 card and draw 1.',
  },
  third_eye: {
    id: 'third_eye', name: 'Third Eye', type: 'Equipment', ip: 'Persona 5', cost: 2,
    isPersistent: false,
    effectDesc: 'Look at the top 3 cards of your deck. Take 1 into hand. Your opponent discards a card from their hand at random.',
  },
  phantom_thief_tools: {
    id: 'phantom_thief_tools', name: 'Phantom Thief Tools', type: 'Equipment', ip: 'Persona 5', cost: 1,
    isPersistent: false,
    effectDesc: 'Gain 2 Energy for this turn. If your opponent has more cards than you, gain 3 instead.',
  },
  metaverse_navigator: {
    id: 'metaverse_navigator', name: 'Metaverse Navigator', type: 'Equipment', ip: 'Persona 5', cost: 2,
    isPersistent: false,
    effectDesc: 'Both players discard their hand and draw that many cards.',
  },
  guard_persona: {
    id: 'guard_persona', name: 'Guard Persona', type: 'Equipment', ip: 'Persona 5', cost: 3,
    isPersistent: false,
    effectDesc: "Prevent ALL damage to yourself during your opponent's next turn. Afterward, your opponent discards 1 card.",
  },
  all_out_attack: {
    id: 'all_out_attack', name: 'All-Out Attack', type: 'Equipment', ip: 'Persona 5', cost: 3,
    isPersistent: false,
    effectDesc: 'Your Leader deals +30 Damage this turn. If your opponent has 2 or fewer cards in hand, deal +50 instead.',
  },

  // ── Persona 5 IP — Stages ─────────────────────────────────────────────────

  shibuya_crossing: {
    id: 'shibuya_crossing', name: 'Shibuya Crossing', type: 'Stage', ip: 'Persona 5', cost: 1,
    isPersistent: true,
    effectDesc: 'While active: both players draw 1 extra card during Draw Phase. Whenever your opponent draws outside Draw Phase, they discard 1.',
  },
  mementos_depths: {
    id: 'mementos_depths', name: 'Mementos Depths', type: 'Stage', ip: 'Persona 5', cost: 2,
    isPersistent: true,
    effectDesc: "While active: when a support unit is KO'd, its controller discards 1 card.",
  },
  palace_infiltration_route: {
    id: 'palace_infiltration_route', name: 'Palace Infiltration Route', type: 'Stage', ip: 'Persona 5', cost: 1,
    isPersistent: true,
    effectDesc: "While active: each player gains 10 extra energy at the start of their turn and takes 10 damage to their leader.",
  },

  // ── Persona 5 IP — Genesis ────────────────────────────────────────────────

  holy_grail: {
    id: 'holy_grail', name: 'Holy Grail', type: 'Genesis', ip: 'Persona 5', cost: 4,
    isGenesis: true, isPersistent: false,
    effectDesc: 'This turn: all support unit actives cost 0 and do not exhaust.',
  },
  contract_of_rebellion: {
    id: 'contract_of_rebellion', name: 'Contract of Rebellion', type: 'Genesis', ip: 'Persona 5', cost: 5,
    isGenesis: true, isPersistent: false,
    effectDesc: 'Both players draw until they have 6 cards. Then your opponent discards 2 cards and cannot draw outside Draw Phase until your next turn.',
  },
  arsene_unleashed: {
    id: 'arsene_unleashed', name: 'Arsène Unleashed', type: 'Genesis', ip: 'Persona 5', cost: 4,
    isGenesis: true, isPersistent: false,
    effectDesc: "Set a leader's HP to half of their original max HP (rounded down).",
  },
};