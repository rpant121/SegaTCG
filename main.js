/**
 * MAIN
 * Application entry point.
 * Creates the initial game state and hands off to the event handler module.
 */

import { createInitialState } from './engine/state.js';
import { addLog }             from './ui/renderer.js';
import { initHandlers }       from './ui/handlers.js';

const state = createInitialState();

addLog('=== SEGA CARD GAME TCG ===', 'phase');
addLog(`Coin flip → Player ${state.activePlayer + 1} goes first!`, 'phase');

initHandlers(state);
