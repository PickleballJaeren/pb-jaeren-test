// ════════════════════════════════════════════════════════
// rotasjon.js — Banefordeling og kampoppsett
// Håndterer americano-rotasjon for 4, 5 og 6 spillere,
// og Mix & Match matchmaking.
// ════════════════════════════════════════════════════════

import { STARTRATING, PARTER, PARTER_5, PARTER_6_DOBBEL, PARTER_6_SINGEL } from './konstanter.js';

// ════════════════════════════════════════════════════════
// HJELPER
// ════════════════════════════════════════════════════════
export function getParter(antall, erSingel = false) {
  if (antall === 5)             return PARTER_5;
  if (antall === 2 || erSingel) return PARTER_6_SINGEL;
  return PARTER;
}

/**
 * Returnerer true dersom banen er en singelbane.
 * Brukes konsekvent i baner.js, poeng.js og resultat.js.
 * @param {object} bane — bane-objekt fra app.baneOversikt
 */
export function erSingelBane(bane) {
  return bane?.erSingel === true || (bane?.spillere?.length === 2);
}

/**
 * Returnerer riktig parter-array for en gitt bane og modus.
 * Samler all bane-type-logikk på ett sted — erstatter duplisert
 * kode i baner.js, poeng.js og resultat.js.
 *
 * @param {object}  bane      — bane-objekt fra app.baneOversikt
 * @param {boolean} isMix     — true i Mix & Match-modus
 * @param {boolean} er6Format — true i 6-spiller-format
 * @returns {Array}            — array av par-objekter
 */
export function hentParter(bane, isMix, er6Format) {
  const singel  = erSingelBane(bane);
  const n       = bane?.spillere?.length ?? 4;
  const dobbel6 = er6Format && bane?.erDobbel === true;

  if (isMix) {
    return singel
      ? PARTER_6_SINGEL
      : [{ nr: 1, lag1: [0, 1], lag2: [2, 3] }];
  }
  if (singel)  return PARTER_6_SINGEL;
  if (dobbel6) return PARTER_6_DOBBEL;
  return getParter(n);
}

/** Fisher-Yates shuffle */
export function blandArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Gir poeng til spillere i en kamp, inkl. hviler-logikk for 5-spillerbaner.
 */
export function beregnPoengForKamp(par, spillere, lag1Poeng, lag2Poeng) {
  const res = [];
  par.lag1.forEach(i => {
    if (spillere[i]) res.push({ spillerId: spillere[i].id, poeng: lag1Poeng });
  });
  par.lag2.forEach(i => {
    if (spillere[i]) res.push({ spillerId: spillere[i].id, poeng: lag2Poeng });
  });
  if (par.hviler != null && spillere[par.hviler]) {
    const hvilPoeng = Math.ceil((lag1Poeng + lag2Poeng) / 2);
    res.push({ spillerId: spillere[par.hviler].id, poeng: hvilPoeng });
  }
  return res;
}

// ════════════════════════════════════════════════════════
// KONKURRANSE — BANEFORDELING
// ════════════════════════════════════════════════════════

/**
 * Fordeler spillere på baner med 4 eller 5 per bane.
 * Sorterer etter rating og bruker 5-spillerbaner der antallet ikke går opp i 4.
 */
export function fordelBaner(spillere, antallBaner, poengPerKamp = 17) {
  if (!spillere?.length) return [];
  const sorterte = [...spillere].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const n = sorterte.length;

  // ── 6-SPILLER MIX SPESIALFORMAT ──
  // Ingen rating — tilfeldig fordeling runde 1
  if (n === 6 && antallBaner === 2) {
    const mp       = poengPerKamp;
    const blandede = blandArray(spillere.map(s => ({ id:s.id, navn:s.navn??'Ukjent' })));
    const dblSpl   = blandede.slice(0, 4);
    const sinSpl   = blandede.slice(4, 6);
    return [
      { baneNr: 1, erDobbel: true,  erSingel: false, maksPoeng: mp, spillere: dblSpl },
      { baneNr: 2, erDobbel: false, erSingel: true,  maksPoeng: mp, spillere: sinSpl },
    ];
  }

  const antall5 = n % 4;
  const baneStorr = [];
  for (let i = 0; i < antall5; i++) baneStorr.push(5);
  const totBaner = antall5 + Math.floor((n - antall5 * 5) / 4);
  for (let i = antall5; i < totBaner; i++) baneStorr.push(4);
  // Bland rekkefølgen slik at 5-spillerbanene ikke alltid havner øverst
  blandArray(baneStorr).forEach((v, i) => { baneStorr[i] = v; });

  const mp  = poengPerKamp;
  const mp5 = Math.round(mp * 3 / 5);
  const baner = [];
  let cursor = 0;
  baneStorr.forEach((storr, i) => {
    baner.push({
      baneNr:    i + 1,
      maksPoeng: storr === 5 ? mp5 : mp,
      spillere:  sorterte.slice(cursor, cursor + storr).map(s => ({
        id: s.id, navn: s.navn ?? 'Ukjent', rating: s.rating ?? STARTRATING,
      })),
    });
    cursor += storr;
  });
  return baner;
}

// ════════════════════════════════════════════════════════
// MIX & MATCH — KOSTNADSVEKTER
// Kontrollerer hvilke faktorer som veier tyngst i trekkingen.
// Høyere tall = sterkere preferanse mot gjentak.
// Endre disse for å tune Mix-algoritmen.
// ════════════════════════════════════════════════════════
const MIX_PARTNER_STRAFF  = 10;  // straff for å spille med samme partner igjen
const MIX_HVILE_BONUS     =  8;  // bonus for spillere som har hvilt mye
const MIX_HVILE_ALDER     =  3;  // ekstra bonus per runde siden siste hvil
const MIX_TILFELDIG_STØY  =  2;  // tilfeldig støy i par-matching (unngår deterministiske mønstre)
const MIX_HVILE_STØY      =  0.5; // tilfeldig støy i hvile-algoritmen

// ════════════════════════════════════════════════════════
// MIX & MATCH — MATCHMAKING
// ════════════════════════════════════════════════════════

function _mixParCost(a, b, playedWith) {
  return ((playedWith[a.id]?.[b.id] ?? 0) + (playedWith[b.id]?.[a.id] ?? 0)) * MIX_PARTNER_STRAFF;
}

function _mixMatchCost(t1, t2, pa) {
  const vs = (x, y) => (pa[x.id]?.[y.id] ?? 0) + (pa[y.id]?.[x.id] ?? 0);
  return vs(t1[0], t2[0]) + vs(t1[0], t2[1]) + vs(t1[1], t2[0]) + vs(t1[1], t2[1]);
}

function velgAktiveOgHvilere(spillere, gamesPlayed, sitOutCount, lastSitOutRunde, plasser, runde) {
  if (spillere.length <= plasser) return { aktive: [...spillere], hviler: [] };

  const sortert = spillere.map(s => ({
    s,
    kost: (gamesPlayed[s.id] ?? 0) * MIX_PARTNER_STRAFF
        - (sitOutCount[s.id] ?? 0) * MIX_HVILE_BONUS
        - (runde - (lastSitOutRunde[s.id] ?? 0)) * MIX_HVILE_ALDER
        + Math.random() * MIX_HVILE_STØY,
  })).sort((a, b) => a.kost - b.kost);

  return {
    aktive: sortert.slice(0, plasser).map(x => x.s),
    hviler: sortert.slice(plasser).map(x => x.s),
  };
}

/**
 * Lager kampoppsett for én runde av Mix & Match.
 * @returns {{ baneOversikt, hviler }}
 */
export function lagMixKampoppsett(spillere, playedWith, playedAgainst, gamesPlayed, sitOutCount, lastSitOutRunde, antallBaner, runde, mp) {
  if (!spillere?.length) return { baneOversikt: [], hviler: [] };

  const poengPerKamp = mp ?? 15;
  const plasser      = antallBaner * 4;

  const { aktive, hviler } = velgAktiveOgHvilere(spillere, gamesPlayed, sitOutCount, lastSitOutRunde, plasser, runde);
  if (aktive.length < 4) return { baneOversikt: [], hviler };

  // Bygg par: greedy, minimiser partner-gjentak
  const pool  = blandArray([...aktive]);
  const brukt = new Set();
  const par   = [];

  for (const sp of pool) {
    if (brukt.has(sp.id)) continue;
    brukt.add(sp.id);
    let best = null, bestKost = Infinity;
    for (const k of pool) {
      if (brukt.has(k.id)) continue;
      const kost = _mixParCost(sp, k, playedWith) + Math.random() * MIX_TILFELDIG_STØY;
      if (kost < bestKost) { bestKost = kost; best = k; }
    }
    if (best) { brukt.add(best.id); par.push([sp, best]); }
  }

  if (par.length < 2) return { baneOversikt: [], hviler };

  // Sett par mot hverandre: minimiser motstander-gjentak
  const bruktPar = new Set();
  const kamper   = [];

  for (let i = 0; i < par.length; i++) {
    if (bruktPar.has(i)) continue;
    bruktPar.add(i);
    let bestJ = -1, bestKost = Infinity;
    for (let j = i + 1; j < par.length; j++) {
      if (bruktPar.has(j)) continue;
      const kost = _mixMatchCost(par[i], par[j], playedAgainst) + Math.random() * MIX_TILFELDIG_STØY;
      if (kost < bestKost) { bestKost = kost; bestJ = j; }
    }
    if (bestJ >= 0) { bruktPar.add(bestJ); kamper.push({ t1: par[i], t2: par[bestJ] }); }
  }

  const baneOversikt = kamper.slice(0, antallBaner).map((k, i) => ({
    baneNr:    i + 1,
    maksPoeng: poengPerKamp,
    erDobbel:  true,
    erSingel:  false,
    spillere:  [...k.t1, ...k.t2].map(s => ({
      id:     s.id,
      navn:   s.navn   ?? 'Ukjent',
      rating: s.rating ?? STARTRATING,
    })),
  }));

  return { baneOversikt, hviler };
}

/** Oppdaterer Mix-statistikk in-place etter en runde. */
export function oppdaterMixStatistikk(baneOversikt, hvilerDenne, playedWith, playedAgainst, gamesPlayed, sitOutCount, lastSitOutRunde, rundeNr) {
  baneOversikt.forEach(({ spillere: [a, b, c, d] }) => {
    if (!a || !b || !c || !d) return;

    const incPW = (x, y) => {
      if (!playedWith[x.id]) playedWith[x.id] = {};
      if (!playedWith[y.id]) playedWith[y.id] = {};
      playedWith[x.id][y.id] = (playedWith[x.id][y.id] ?? 0) + 1;
      playedWith[y.id][x.id] = (playedWith[y.id][x.id] ?? 0) + 1;
    };
    const incPA = (x, y) => {
      if (!playedAgainst[x.id]) playedAgainst[x.id] = {};
      if (!playedAgainst[y.id]) playedAgainst[y.id] = {};
      playedAgainst[x.id][y.id] = (playedAgainst[x.id][y.id] ?? 0) + 1;
      playedAgainst[y.id][x.id] = (playedAgainst[y.id][x.id] ?? 0) + 1;
    };

    incPW(a, b); incPW(c, d);
    incPA(a, c); incPA(a, d);
    incPA(b, c); incPA(b, d);
    [a, b, c, d].forEach(s => { gamesPlayed[s.id] = (gamesPlayed[s.id] ?? 0) + 1; });
  });

  (hvilerDenne ?? []).forEach(s => {
    sitOutCount[s.id]     = (sitOutCount[s.id]     ?? 0) + 1;
    lastSitOutRunde[s.id] = rundeNr;
  });
}

/** Henter Mix-statistikk fra Firestore-treningsdokument. */
export function hentMixStatistikk(treningData) {
  return {
    playedWith:      treningData?.mixPlayedWith      ?? {},
    playedAgainst:   treningData?.mixPlayedAgainst   ?? {},
    gamesPlayed:     treningData?.mixGamesPlayed     ?? {},
    sitOutCount:     treningData?.mixSitOutCount     ?? {},
    lastSitOutRunde: treningData?.mixLastSitOutRunde ?? {},
  };
}

/** Runde 1 — ingen statistikk ennå. */
export function fordelBanerMix(spillere, antallBaner, poengPerKamp = 15) {
  return lagMixKampoppsett(spillere, {}, {}, {}, {}, {}, antallBaner, 1, poengPerKamp);
}

/**
 * Genererer neste runde for 6-spiller Mix & Match format.
 *
 * Regler:
 * - Vinnerne fra dobbel splittes og får nye partnere
 * - Singelspillerne kommer inn som partnere til vinnerne (tilfeldig, unngå gjentak)
 * - Taperne fra dobbel går til singel
 *
 * @param {Object} dobbelResultat - { lag1Spillere, lag2Spillere, vinnerId } (vinnerId: 1 eller 2)
 * @param {Array}  singelSpillere - de to spillerne fra singelbanen
 * @param {Object} playedWith     - historikk over hvem som har spilt med hvem
 * @returns {{ baneOversikt: Array }}
 */
export function neste6SpillerRunde(dobbelResultat, singelSpillere, playedWith = {}, poengPerKamp = 15) {
  const { lag1Spillere, lag2Spillere, vinnerId } = dobbelResultat;
  const vinnere = vinnerId === 2 ? lag2Spillere : lag1Spillere;
  const tapere  = vinnerId === 2 ? lag1Spillere : lag2Spillere;

  // Singelspillerne blir nye dobbel-partnere — tilfeldig, unngå gjentak
  const [v1, v2]   = blandArray([...vinnere]);
  const [s1, s2]   = _parSingelMedVinnere(v1, v2, singelSpillere, playedWith);

  // Lag ny dobbelbane: v1+s1 vs v2+s2
  const dobbelSpl = [v1, s1, v2, s2].map(s => ({ id: s.id, navn: s.navn ?? 'Ukjent' }));

  // Taperne fra dobbel går til singel
  const singelSpl = tapere.map(s => ({ id: s.id, navn: s.navn ?? 'Ukjent' }));

  return {
    baneOversikt: [
      { baneNr: 1, erDobbel: true,  erSingel: false, maksPoeng: poengPerKamp, spillere: dobbelSpl },
      { baneNr: 2, erDobbel: false, erSingel: true,  maksPoeng: poengPerKamp, spillere: singelSpl },
    ],
  };
}

/**
 * Parer to singelspillere med to vinnere — unngå samme par som tidligere.
 * Prøver begge kombinasjoner og velger den med færrest gjentak.
 */
function _parSingelMedVinnere(v1, v2, singelSpillere, playedWith) {
  const [sA, sB] = singelSpillere;
  if (!sA || !sB) return [sA ?? sB, sB ?? sA];

  // Kombinasjon A: v1+sA, v2+sB
  const kostA = _parKost(v1, sA, playedWith) + _parKost(v2, sB, playedWith);
  // Kombinasjon B: v1+sB, v2+sA
  const kostB = _parKost(v1, sB, playedWith) + _parKost(v2, sA, playedWith);

  // Legg til litt tilfeldighet ved lik kost
  const velgA = kostA <= kostB + Math.random() * 0.5;
  return velgA ? [sA, sB] : [sB, sA];
}

function _parKost(a, b, playedWith) {
  return (playedWith[a?.id]?.[b?.id] ?? 0) + (playedWith[b?.id]?.[a?.id] ?? 0);
}
