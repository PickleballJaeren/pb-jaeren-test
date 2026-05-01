// ════════════════════════════════════════════════════════
// state.js — Delt applikasjonstilstand
// Én enkelt sannhetskilde for alle moduler.
// Import: import { app } from './state.js';
// ════════════════════════════════════════════════════════

export const app = {
  spillere:          [],
  valgtIds:          new Set(),
  antallBaner:       3,
  poengPerKamp:      15,
  maksRunder:        4,
  runde:             1,
  treningId:         null,
  baneOversikt:      [],
  venteliste:        [],
  rangerteBaner:     [],
  ratingEndringer:   [],
  aktivBane:         null,
  lyttere:           [],
  er6SpillerFormat:  false,
  // 'konkurranse' | 'mix'
  spillModus:        'konkurranse',
  // 'americano' | 'best_of_3'
  scoringsFormat:    'americano',
  // Aktiv turnering — settes av turnering-ui.js
  aktivTurnering:    null,
};

/** Returnerer true når gjeldende økt kjøres i Mix & Match-modus. */
export const erMix = () => app.spillModus === 'mix';
