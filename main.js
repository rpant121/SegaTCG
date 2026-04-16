/**
 * MAIN
 * Application entry point.
 * Reads both player decks from sessionStorage (set by deck-builder).
 * If either deck is missing, redirects to the deck builder.
 */

import { createInitialState } from './engine/state.js';
import { addLog }             from './ui/renderer.js';
import { initHandlers }       from './ui/handlers.js';

// ---------------------------------------------------------------------------
// Load saved decks — redirect to builder if missing
// ---------------------------------------------------------------------------
const raw1 = sessionStorage.getItem('deck_p1');
const raw2 = sessionStorage.getItem('deck_p2');

if (!raw1 || !raw2) {
  // Clear any partial state and send players to build their decks
  sessionStorage.removeItem('deck_p1');
  sessionStorage.removeItem('deck_p2');
  window.location.href = 'deck-builder.html';
  throw new Error('Redirecting to deck builder'); // stops further execution
}

const saved1 = JSON.parse(raw1); // { leaderId, deck: string[] }
const saved2 = JSON.parse(raw2);

// ---------------------------------------------------------------------------
// Boot game
// ---------------------------------------------------------------------------
const state = createInitialState(saved1.deck, saved2.deck);

addLog('=== SEGA CARD GAME TCG ===', 'phase');
addLog(`Player 1: ${saved1.deckName ?? 'Custom Deck'} | Player 2: ${saved2.deckName ?? 'Custom Deck'}`, 'phase');
addLog(`Coin flip → Player ${state.activePlayer + 1} goes first!`, 'phase');

initHandlers(state);
