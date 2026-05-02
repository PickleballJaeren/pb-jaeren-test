// ════════════════════════════════════════════════════════
// turnering-logikk.js — Ren turneringslogikk
// Ingen Firebase-avhengigheter, ingen async/await.
// Alle funksjoner er rene beregninger som kan testes isolert.
//
// Importeres av turnering.js og turnering-ui.js.
// ════════════════════════════════════════════════════════

import { blandArray } from './rotasjon.js';

// ════════════════════════════════════════════════════════
// KONSTANTER
// ════════════════════════════════════════════════════════
export const T_STATUS = {
  SETUP:           'setup',
  GROUP_PLAY:      'group_play',
  PLAYOFF_SEEDING: 'playoff_seeding',
  PLAYOFFS:        'playoffs',
  FINISHED:        'finished',
};

export const SEEDING_MODUS = {
  STANDARD: 'standard',
  TREKNING:  'trekning',
  KRYSS:     'kryss',
};

export const STANDARD_KAMPFORMAT = {
  type:          'single',
  points_to_win: 11,
  win_by:        2,
  max_points:    15,
};

/** Bygg kampformat-objekt fra poeng-valg. */
export function lagKampformat(type, points_to_win) {
  const max_points = points_to_win === 15 ? 18 : 15;
  return { type, points_to_win, win_by: 2, max_points };
}

// ════════════════════════════════════════════════════════
// VALIDERING AV RESULTAT
// ════════════════════════════════════════════════════════
export function validerResultat(p1, p2, format) {
  const f = { ...STANDARD_KAMPFORMAT, ...(format ?? {}) };
  const { points_to_win, win_by, max_points } = f;

  if (isNaN(p1) || isNaN(p2) || p1 < 0 || p2 < 0)
    return { ok: false, feil: 'Poeng må være positive tall.' };

  const vinner = Math.max(p1, p2);
  const taper  = Math.min(p1, p2);
  const diff   = vinner - taper;

  if (vinner > max_points)
    return { ok: false, feil: `Maks ${max_points} poeng for vinner.` };
  if (vinner < points_to_win)
    return { ok: false, feil: `Vinner trenger minst ${points_to_win} poeng.` };

  // Cap-situasjon: begge nådde max_points-1 (f.eks. 14–14 ved til-15)
  if (taper === max_points - 1) {
    if (vinner !== max_points)
      return { ok: false, feil: `Ved ${taper}–${taper} må vinner ha nøyaktig ${max_points}.` };
    return { ok: true };
  }

  // Deuce-situasjon: taper har nådd points_to_win-1 eller mer
  if (taper >= points_to_win - 1) {
    if (diff !== win_by)
      return { ok: false, feil: `Etter ${taper}–${taper} må vinner lede med nøyaktig ${win_by} (f.eks. ${taper + win_by}–${taper}).` };
    return { ok: true };
  }

  // Normalt spill
  if (vinner !== points_to_win)
    return { ok: false, feil: `Ugyldig resultat: kampen avsluttes ved ${points_to_win} når motstanderen ikke har nådd ${points_to_win - 1}.` };
  if (diff < win_by)
    return { ok: false, feil: `Vinn med minst ${win_by} poeng.` };

  return { ok: true };
}

// ════════════════════════════════════════════════════════
// HENT KAMPFORMAT FOR RUNDE
// ════════════════════════════════════════════════════════
export function hentFormatForRunde(rundeNavn, konfig, kampFormat = null) {
  if (kampFormat) return kampFormat;

  const finale      = ['1. plass', '3. plass', '5. plass', '7. plass', '9. plass', '17. plass', 'Finale'];
  const semifinale  = ['Semifinale'];
  const kvartfinale = ['Kvartfinale', 'Åttedelsfinale', 'Plass 5–8'];

  if (finale.includes(rundeNavn))      return konfig?.kampformatFinale      ?? lagKampformat('single', 15);
  if (semifinale.includes(rundeNavn))  return konfig?.kampformatSemifinale  ?? STANDARD_KAMPFORMAT;
  if (kvartfinale.includes(rundeNavn)) return konfig?.kampformatKvartfinale ?? STANDARD_KAMPFORMAT;
  return STANDARD_KAMPFORMAT;
}

// ════════════════════════════════════════════════════════
// PULJEOPPSETT — slange-seeding
// ════════════════════════════════════════════════════════
export function genererPuljer(lag, antallPuljer) {
  if (!lag?.length) throw new Error('Ingen lag å fordele.');
  if (antallPuljer < 2 || antallPuljer > 4) throw new Error('Antall puljer må være 2–4.');
  if (lag.length < antallPuljer * 2) throw new Error(`Trenger minst ${antallPuljer * 2} lag for ${antallPuljer} puljer.`);

  const puljer = Array.from({ length: antallPuljer }, (_, i) => ({
    id:     `pulje_${i + 1}`,
    navn:   `Pulje ${String.fromCharCode(65 + i)}`,
    lagIds: [],
  }));

  let retning = 1;
  let pIdx    = 0;
  for (const l of lag) {
    puljer[pIdx].lagIds.push(l.id);
    pIdx += retning;
    if (pIdx >= antallPuljer) { pIdx = antallPuljer - 1; retning = -1; }
    else if (pIdx < 0)        { pIdx = 0;                retning =  1; }
  }

  return puljer;
}

// ════════════════════════════════════════════════════════
// ROUND ROBIN — kampgenerering (Berger-tabell)
// ════════════════════════════════════════════════════════
export function genererRoundRobin(lagIds) {
  const n      = lagIds.length;
  const kamper = [];
  let kampNr   = 1;

  if (n < 2) return kamper;

  const liste = [...lagIds];
  if (n % 2 !== 0) liste.push('BYE');
  const m = liste.length;

  for (let runde = 0; runde < m - 1; runde++) {
    for (let i = 0; i < m / 2; i++) {
      const h = liste[i];
      const b = liste[m - 1 - i];
      if (h !== 'BYE' && b !== 'BYE') {
        kamper.push({
          id:        `rr_${kampNr}`,
          kampNr:    kampNr++,
          runde:     runde + 1,
          lag1Id:    h,
          lag2Id:    b,
          lag1Poeng: null,
          lag2Poeng: null,
          ferdig:    false,
          walkover:  false,
        });
      }
    }
    const siste = liste.pop();
    liste.splice(1, 0, siste);
  }

  return kamper;
}

// ════════════════════════════════════════════════════════
// PULJETABELL — rangering med tie-break
// Rekkefølge: seire → innbyrdes → poengdifferanse → scorede poeng
// ════════════════════════════════════════════════════════
export function beregnPuljetabell(pulje, alleLag) {
  const lagMap = Object.fromEntries(alleLag.map(l => [l.id, l]));
  const stats  = {};

  for (const id of pulje.lagIds) {
    stats[id] = { lagId: id, seire: 0, tap: 0, pf: 0, pm: 0, pd: 0, kamper: 0 };
  }

  for (const k of (pulje.kamper ?? [])) {
    if (!k.ferdig || k.lag1Poeng == null || k.lag2Poeng == null) continue;
    const s1 = stats[k.lag1Id];
    const s2 = stats[k.lag2Id];
    if (!s1 || !s2) continue;

    s1.pf += k.lag1Poeng; s1.pm += k.lag2Poeng;
    s2.pf += k.lag2Poeng; s2.pm += k.lag1Poeng;
    s1.kamper++; s2.kamper++;

    if (k.lag1Poeng > k.lag2Poeng) { s1.seire++; s2.tap++; }
    else                            { s2.seire++; s1.tap++; }
  }

  for (const s of Object.values(stats)) {
    s.pd = s.pf - s.pm;
  }

  return _sorterPuljeTabell(Object.values(stats), pulje.kamper ?? []);
}

function _sorterPuljeTabell(lagListe, kamper) {
  return [...lagListe].sort((a, b) => {
    if (b.seire !== a.seire) return b.seire - a.seire;
    const innbyrdes = _sjekkInnbyrdes(a.lagId, b.lagId, kamper);
    if (innbyrdes !== 0) return innbyrdes;
    if (b.pd !== a.pd) return b.pd - a.pd;
    return b.pf - a.pf;
  });
}

function _sjekkInnbyrdes(idA, idB, kamper) {
  for (const k of kamper) {
    if (!k.ferdig) continue;
    if (k.lag1Id === idA && k.lag2Id === idB)
      return k.lag1Poeng > k.lag2Poeng ? -1 : 1;
    if (k.lag1Id === idB && k.lag2Id === idA)
      return k.lag2Poeng > k.lag1Poeng ? -1 : 1;
  }
  return 0;
}

function _sammenlignPaaTvers(a, b) {
  if (b.seire !== a.seire) return b.seire - a.seire;
  if (b.pd    !== a.pd)    return b.pd    - a.pd;
  return b.pf - a.pf;
}

// ════════════════════════════════════════════════════════
// KVALIFISERING TIL SLUTTSPILL
// Returnerer { A: lagId[], B: lagId[], C: lagId[], ... }
// ════════════════════════════════════════════════════════
export function kvalifiserTilSluttspill(turneringMedTabeller) {
  const { puljer, konfig } = turneringMedTabeller;
  const antallPuljer = puljer.length;

  const tabeller = puljer.map(p =>
    beregnPuljetabell(p, turneringMedTabeller.lag)
  );

  let aKandidater = [];

  if (antallPuljer === 2) {
    tabeller.forEach((t, pi) => t.slice(0, 4).forEach((l, ri) =>
      aKandidater.push({ ...l, puljeIdx: pi, puljeRang: ri + 1 })
    ));
  } else if (antallPuljer === 3) {
    tabeller.forEach((t, pi) => t.slice(0, 2).forEach((l, ri) =>
      aKandidater.push({ ...l, puljeIdx: pi, puljeRang: ri + 1 })
    ));
    const tredjepl = tabeller.map((t, pi) => t[2] ? { ...t[2], puljeIdx: pi, puljeRang: 3 } : null)
      .filter(Boolean).sort(_sammenlignPaaTvers);
    aKandidater.push(...tredjepl.slice(0, 2));
  } else if (antallPuljer === 4) {
    tabeller.forEach((t, pi) => t.slice(0, 2).forEach((l, ri) =>
      aKandidater.push({ ...l, puljeIdx: pi, puljeRang: ri + 1 })
    ));
  }

  aKandidater = aKandidater.slice(0, 8);
  const aIds  = aKandidater.map(l => l.lagId);

  const gjenvarende = tabeller.flat()
    .filter(l => !aIds.includes(l.lagId))
    .sort(_sammenlignPaaTvers);

  const bIds = gjenvarende.slice(0,  8).map(l => l.lagId);
  const cIds = gjenvarende.slice(8, 24).map(l => l.lagId);

  return { A: aIds, B: bIds, C: cIds, aMeta: aKandidater, tabeller, antallPuljer };
}

// ════════════════════════════════════════════════════════
// BRACKET-MOTOR
// ════════════════════════════════════════════════════════

/** Bestemmer startnivå basert på antall lag. */
export function startnivaa(antallLag) {
  if (antallLag <= 2)  return 'finale';
  if (antallLag <= 4)  return 'semifinale';
  if (antallLag <= 8)  return 'kvartfinale';
  return 'aattedelsfinale';
}

/** Genererer A-bracket (plass 1–8). */
export function genererABracket(seededeIds, konfig, parOverstyr = null) {
  const n      = seededeIds.length;
  const kamper = [];

  if (n <= 0) return kamper;

  const plasseringPaa = konfig?.plasseringskamperA !== false;

  if (n === 2) {
    kamper.push(_lagKamp('A_FIN', seededeIds[0], seededeIds[1], null, null, '1. plass'));
    return kamper;
  }

  if (n <= 4) {
    kamper.push(_lagKamp('A_SF1', seededeIds[0], seededeIds[3] ?? null, 'A_FIN', plasseringPaa ? 'A_BRO' : null, 'Semifinale'));
    kamper.push(_lagKamp('A_SF2', seededeIds[1], seededeIds[2] ?? null, 'A_FIN', plasseringPaa ? 'A_BRO' : null, 'Semifinale'));
    kamper.push(_lagKamp('A_FIN',  null, null, null, null, '1. plass'));
    if (plasseringPaa) kamper.push(_lagKamp('A_BRO', null, null, null, null, '3. plass'));
    return kamper;
  }

  // Kvartfinale (8 lag)
  let par;
  if (parOverstyr && parOverstyr.length === 8) {
    par = [
      [parOverstyr[0], parOverstyr[1]],
      [parOverstyr[2], parOverstyr[3]],
      [parOverstyr[4], parOverstyr[5]],
      [parOverstyr[6], parOverstyr[7]],
    ];
  } else {
    par = [
      [seededeIds[0], seededeIds[7] ?? null],
      [seededeIds[3], seededeIds[4] ?? null],
      [seededeIds[1], seededeIds[6] ?? null],
      [seededeIds[2], seededeIds[5] ?? null],
    ];
  }

  kamper.push(_lagKamp('A_QF1', par[0][0], par[0][1], 'A_SF1', plasseringPaa ? 'A_P5_SF1' : null, 'Kvartfinale'));
  kamper.push(_lagKamp('A_QF2', par[1][0], par[1][1], 'A_SF1', plasseringPaa ? 'A_P5_SF1' : null, 'Kvartfinale'));
  kamper.push(_lagKamp('A_QF3', par[2][0], par[2][1], 'A_SF2', plasseringPaa ? 'A_P5_SF2' : null, 'Kvartfinale'));
  kamper.push(_lagKamp('A_QF4', par[3][0], par[3][1], 'A_SF2', plasseringPaa ? 'A_P5_SF2' : null, 'Kvartfinale'));

  kamper.push(_lagKamp('A_SF1', null, null, 'A_FIN', 'A_BRO', 'Semifinale'));
  kamper.push(_lagKamp('A_SF2', null, null, 'A_FIN', 'A_BRO', 'Semifinale'));
  kamper.push(_lagKamp('A_FIN', null, null, null, null, '1. plass'));
  kamper.push(_lagKamp('A_BRO', null, null, null, null, '3. plass'));

  if (plasseringPaa) {
    kamper.push(_lagKamp('A_P5_SF1', null, null, 'A_P5_FIN', 'A_P7_FIN', 'Plass 5–8'));
    kamper.push(_lagKamp('A_P5_SF2', null, null, 'A_P5_FIN', 'A_P7_FIN', 'Plass 5–8'));
    kamper.push(_lagKamp('A_P5_FIN', null, null, null, null, '5. plass'));
    kamper.push(_lagKamp('A_P7_FIN', null, null, null, null, '7. plass'));
  }

  return kamper;
}

/**
 * Genererer B/C-bracket.
 * Bronsekamp (11./19. plass) inkluderes kun om konfig.plasseringskamperBC === true.
 *
 * Støttede størrelser:
 *   2 lag   → finale
 *   3–4 lag → semifinale + finale [+ bronsekamp]
 *   5 lag   → 1 QF + semifinale + finale [+ bronsekamp]
 *   6 lag   → 2 QF + semifinale + finale [+ bronsekamp]
 *   7 lag   → bye til seed 1, 3 QF + semifinale + finale [+ bronsekamp]
 *   8 lag   → 4 QF + semifinale + finale [+ bronsekamp]
 */
export function genererBCBracket(lagIds, nivaa, startPlass, konfig = null) {
  const n         = lagIds.length;
  const prefix    = nivaa;
  const kamper    = [];
  const bronse    = startPlass + 2;
  const medBronse = konfig?.plasseringskamperBC === true;

  if (n < 2) return kamper;

  // 2 lag — bare finale
  if (n === 2) {
    kamper.push(_lagKamp(`${prefix}_FIN`, lagIds[0], lagIds[1], null, null, `${startPlass}. plass`));
    return kamper;
  }

  // 3–4 lag — semifinale + finale + bronsekamp
  if (n <= 4) {
    const s = lagIds;
    kamper.push(_lagKamp(`${prefix}_SF1`, s[0], s[3] ?? null, `${prefix}_FIN`, medBronse ? `${prefix}_BRO` : null, 'Semifinale'));
    kamper.push(_lagKamp(`${prefix}_SF2`, s[1], s[2] ?? null, `${prefix}_FIN`, medBronse ? `${prefix}_BRO` : null, 'Semifinale'));
    kamper.push(_lagKamp(`${prefix}_FIN`, null, null, null, null, `${startPlass}. plass`));
    if (medBronse) kamper.push(_lagKamp(`${prefix}_BRO`, null, null, null, null, `${bronse}. plass`));
    return kamper;
  }

  // 5 lag — seed1 bye til SF1, seed2 vs seed3 i SF2, seed4 vs seed5 i QF
  if (n === 5) {
    const s = lagIds;
    kamper.push(_lagKamp(`${prefix}_QF1`, s[3], s[4],  `${prefix}_SF1`, null,                              'Kvartfinale'));
    kamper.push(_lagKamp(`${prefix}_SF1`, s[0], null,   `${prefix}_FIN`, medBronse ? `${prefix}_BRO` : null, 'Semifinale'));
    kamper.push(_lagKamp(`${prefix}_SF2`, s[1], s[2],   `${prefix}_FIN`, medBronse ? `${prefix}_BRO` : null, 'Semifinale'));
    kamper.push(_lagKamp(`${prefix}_FIN`, null, null,   null,             null,                               `${startPlass}. plass`));
    if (medBronse) kamper.push(_lagKamp(`${prefix}_BRO`, null, null, null, null, `${bronse}. plass`));
    return kamper;
  }

  // 6 lag — seed1 og seed2 bye til SF, seed3v6 og seed4v5 i QF
  if (n === 6) {
    const s = lagIds;
    kamper.push(_lagKamp(`${prefix}_QF1`, s[2], s[5],  `${prefix}_SF1`, null,                              'Kvartfinale'));
    kamper.push(_lagKamp(`${prefix}_QF2`, s[3], s[4],  `${prefix}_SF2`, null,                              'Kvartfinale'));
    kamper.push(_lagKamp(`${prefix}_SF1`, s[0], null,   `${prefix}_FIN`, medBronse ? `${prefix}_BRO` : null, 'Semifinale'));
    kamper.push(_lagKamp(`${prefix}_SF2`, s[1], null,   `${prefix}_FIN`, medBronse ? `${prefix}_BRO` : null, 'Semifinale'));
    kamper.push(_lagKamp(`${prefix}_FIN`, null, null,   null,             null,                               `${startPlass}. plass`));
    if (medBronse) kamper.push(_lagKamp(`${prefix}_BRO`, null, null, null, null, `${bronse}. plass`));
    return kamper;
  }

  // 7 lag — seed1 bye til SF1, seed2v7/seed3v6/seed4v5 i QF
  if (n === 7) {
    const s = lagIds;
    kamper.push(_lagKamp(`${prefix}_QF1`, s[1], s[6],  `${prefix}_SF1`, null,                              'Kvartfinale'));
    kamper.push(_lagKamp(`${prefix}_QF2`, s[2], s[5],  `${prefix}_SF2`, null,                              'Kvartfinale'));
    kamper.push(_lagKamp(`${prefix}_QF3`, s[3], s[4],  `${prefix}_SF2`, null,                              'Kvartfinale'));
    kamper.push(_lagKamp(`${prefix}_SF1`, s[0], null,   `${prefix}_FIN`, medBronse ? `${prefix}_BRO` : null, 'Semifinale'));
    kamper.push(_lagKamp(`${prefix}_SF2`, null, null,   `${prefix}_FIN`, medBronse ? `${prefix}_BRO` : null, 'Semifinale'));
    kamper.push(_lagKamp(`${prefix}_FIN`, null, null,   null,             null,                               `${startPlass}. plass`));
    if (medBronse) kamper.push(_lagKamp(`${prefix}_BRO`, null, null, null, null, `${bronse}. plass`));
    return kamper;
  }

  // 8 lag — standard kvartfinale, ingen byer
  const s = lagIds;
  kamper.push(_lagKamp(`${prefix}_QF1`, s[0], s[7], `${prefix}_SF1`, null,                              'Kvartfinale'));
  kamper.push(_lagKamp(`${prefix}_QF2`, s[3], s[4], `${prefix}_SF1`, null,                              'Kvartfinale'));
  kamper.push(_lagKamp(`${prefix}_QF3`, s[1], s[6], `${prefix}_SF2`, null,                              'Kvartfinale'));
  kamper.push(_lagKamp(`${prefix}_QF4`, s[2], s[5], `${prefix}_SF2`, null,                              'Kvartfinale'));
  kamper.push(_lagKamp(`${prefix}_SF1`, null, null, `${prefix}_FIN`, medBronse ? `${prefix}_BRO` : null, 'Semifinale'));
  kamper.push(_lagKamp(`${prefix}_SF2`, null, null, `${prefix}_FIN`, medBronse ? `${prefix}_BRO` : null, 'Semifinale'));
  kamper.push(_lagKamp(`${prefix}_FIN`, null, null, null,             null,                               `${startPlass}. plass`));
  if (medBronse) kamper.push(_lagKamp(`${prefix}_BRO`, null, null, null, null, `${bronse}. plass`));
  return kamper;
}

function _lagKamp(id, lag1Id, lag2Id, winnerTo, loserTo, runde) {
  return {
    id, runde,
    lag1Id:    lag1Id ?? null,
    lag2Id:    lag2Id ?? null,
    lag1Poeng: null,
    lag2Poeng: null,
    ferdig:    false,
    walkover:  false,
    winnerId:  null,
    taperId:   null,
    winner_to: winnerTo ?? null,
    loser_to:  loserTo  ?? null,
    format:    null,
  };
}

// ════════════════════════════════════════════════════════
// SEEDING
// ════════════════════════════════════════════════════════
export function seedALag(kvalifiserteIds, puljer, modus, kval = null) {
  if (modus === SEEDING_MODUS.TREKNING) return _trekkSeeding(kvalifiserteIds, puljer);
  if (modus === SEEDING_MODUS.KRYSS)    return _kryssSeeding(kval, puljer);
  return _standardSeeding(kvalifiserteIds, puljer);
}

function _standardSeeding(ids, puljer) {
  const seeded = [...ids];
  for (let i = 0; i < 4; i++) {
    const motstanderIdx = 7 - i;
    if (_samePulje(seeded[i], seeded[motstanderIdx], puljer)) {
      for (let j = motstanderIdx - 1; j > i; j--) {
        if (!_samePulje(seeded[i], seeded[j], puljer)) {
          [seeded[motstanderIdx], seeded[j]] = [seeded[j], seeded[motstanderIdx]];
          break;
        }
      }
    }
  }
  return seeded;
}

function _kryssSeeding(kval, puljer) {
  if (!kval) return [];
  const { aMeta, antallPuljer } = kval;
  if (antallPuljer === 2) return _kryssSeeding2Puljer(aMeta, puljer);
  if (antallPuljer === 3) return _kryssSeeding3Puljer(aMeta, puljer);
  if (antallPuljer === 4) return _kryssSeeding4Puljer(aMeta, puljer);
  return aMeta.map(l => l.lagId);
}

function _kryssSeeding2Puljer(meta, puljer) {
  const grp = _grupperPerPulje(meta);
  const [p0, p1] = [grp[0] ?? [], grp[1] ?? []];
  const par = [
    _velg(p0, 1), _velg(p1, 2),
    _velg(p1, 1), _velg(p0, 2),
    _velg(p0, 3), _velg(p1, 4),
    _velg(p1, 3), _velg(p0, 4),
  ];
  return _justerSammePulje(par, puljer);
}

function _kryssSeeding3Puljer(meta, puljer) {
  const vinnere    = meta.filter(l => l.puljeRang === 1).sort(_sammenlignPaaTvers);
  const andrePlass = meta.filter(l => l.puljeRang === 2).sort(_sammenlignPaaTvers);
  const tredjepl   = meta.filter(l => l.puljeRang === 3).sort(_sammenlignPaaTvers);

  const tilgjVinnere = [...vinnere];
  const tilgj3       = [tredjepl[0], tredjepl[1]].filter(Boolean);
  const qfPar        = [];

  for (const t of tilgj3) {
    const idx = tilgjVinnere.findIndex(v => !_samePulje(v.lagId, t.lagId, puljer));
    if (idx >= 0) {
      qfPar.push([tilgjVinnere[idx].lagId, t.lagId]);
      tilgjVinnere.splice(idx, 1);
    }
  }

  const gjenvarendeVinner = tilgjVinnere[0];
  const nr2Sortert        = [...andrePlass];
  const svakNr2Idx        = nr2Sortert.reverse().findIndex(
    n => !_samePulje(gjenvarendeVinner?.lagId, n.lagId, puljer)
  );
  const svakNr2Real = nr2Sortert[svakNr2Idx >= 0 ? svakNr2Idx : 0];
  nr2Sortert.reverse();

  if (gjenvarendeVinner && svakNr2Real) {
    qfPar.push([gjenvarendeVinner.lagId, svakNr2Real.lagId]);
  }

  const brukte  = new Set(qfPar.flat());
  const restNr2 = andrePlass.filter(n => !brukte.has(n.lagId));
  if (restNr2[0] && restNr2[1]) qfPar.push([restNr2[0].lagId, restNr2[1].lagId]);

  const par = qfPar.flat();
  while (par.length < 8) par.push(null);
  return par;
}

function _kryssSeeding4Puljer(meta, puljer) {
  const grp = _grupperPerPulje(meta);
  const [pA, pB, pC, pD] = [grp[0] ?? [], grp[1] ?? [], grp[2] ?? [], grp[3] ?? []];
  const par = [
    _velg(pA, 1), _velg(pB, 2),
    _velg(pC, 1), _velg(pD, 2),
    _velg(pB, 1), _velg(pA, 2),
    _velg(pD, 1), _velg(pC, 2),
  ];
  return _justerSammePulje(par, puljer);
}

function _grupperPerPulje(meta) {
  const grp = {};
  for (const l of meta) {
    if (!grp[l.puljeIdx]) grp[l.puljeIdx] = [];
    grp[l.puljeIdx].push(l);
  }
  Object.values(grp).forEach(g => g.sort((a, b) => a.puljeRang - b.puljeRang));
  return Object.values(grp);
}

function _velg(puljeLag, rang) {
  return puljeLag.find(l => l.puljeRang === rang)?.lagId ?? null;
}

function _justerSammePulje(par, puljer) {
  for (let qf = 0; qf < 4; qf++) {
    const h = par[qf * 2], b = par[qf * 2 + 1];
    if (h && b && _samePulje(h, b, puljer)) {
      const neste = (qf + 1) % 4;
      [par[qf * 2 + 1], par[neste * 2 + 1]] = [par[neste * 2 + 1], par[qf * 2 + 1]];
    }
  }
  return par;
}

function _trekkSeeding(ids, puljer) {
  const vinnere = ids.filter(id => _erPuljeVinner(id, puljer));
  const resten  = ids.filter(id => !_erPuljeVinner(id, puljer));
  return [
    ..._trekkMedRestriksjon(blandArray(vinnere), puljer),
    ..._trekkMedRestriksjon(blandArray(resten),  puljer),
  ];
}

function _trekkMedRestriksjon(lagIds, puljer) {
  const resultat = [...lagIds];
  for (let forsok = 0; forsok < 20; forsok++) {
    let ok = true;
    for (let i = 0; i < resultat.length - 1; i++) {
      if (_samePulje(resultat[i], resultat[i+1], puljer)) {
        ok = false;
        const j = Math.floor(Math.random() * resultat.length);
        [resultat[i+1], resultat[j]] = [resultat[j], resultat[i+1]];
      }
    }
    if (ok) break;
  }
  return resultat;
}

function _samePulje(id1, id2, puljer) {
  for (const p of (puljer ?? [])) {
    if (p.lagIds.includes(id1) && p.lagIds.includes(id2)) return true;
  }
  return false;
}

function _erPuljeVinner(lagId, puljer) {
  return puljer?.some(p => p.lagIds[0] === lagId) ?? false;
}

// ════════════════════════════════════════════════════════
// ENDELIG RANGERING
// ════════════════════════════════════════════════════════
export function beregnEndeligRangering(turnering) {
  const { sluttspill, lag } = turnering;
  const lagMap = {};
  for (const l of (lag ?? [])) {
    if (l.id)    lagMap[l.id]    = l;
    if (l.lagId) lagMap[l.lagId] = l;
  }
  const plasseringer = [];

  if (sluttspill?.A?.kamper?.length) {
    const a = sluttspill.A.kamper;
    _hentVinnerFraKamp(a, 'A_FIN',     1,  lagMap, plasseringer);
    _hentTaperFraKamp( a, 'A_FIN',     2,  lagMap, plasseringer);
    _hentVinnerFraKamp(a, 'A_BRO',     3,  lagMap, plasseringer);
    _hentTaperFraKamp( a, 'A_BRO',     4,  lagMap, plasseringer);
    _hentVinnerFraKamp(a, 'A_P5_FIN',  5,  lagMap, plasseringer);
    _hentTaperFraKamp( a, 'A_P5_FIN',  6,  lagMap, plasseringer);
    _hentVinnerFraKamp(a, 'A_P7_FIN',  7,  lagMap, plasseringer);
    _hentTaperFraKamp( a, 'A_P7_FIN',  8,  lagMap, plasseringer);
  }

  if (sluttspill?.B?.kamper?.length) {
    const b = sluttspill.B.kamper;
    _hentVinnerFraKamp(b,  'B_FIN', 9,  lagMap, plasseringer);
    _hentTaperFraKamp( b,  'B_FIN', 10, lagMap, plasseringer);
    _hentVinnerFraKamp(b,  'B_BRO', 11, lagMap, plasseringer);
    _hentTaperFraKamp( b,  'B_BRO', 12, lagMap, plasseringer);
    // QF-tapere: antall varierer (1 ved 5 lag, 2 ved 6 lag, 3 ved 7 lag, 4 ved 8 lag)
    // _hentTapereFraRunde hopper over kamper som ikke finnes eller ikke er ferdig
    _hentTapereFraRunde(b, ['B_QF1','B_QF2','B_QF3','B_QF4'], 13, lagMap, plasseringer);
  }

  if (sluttspill?.C?.kamper?.length) {
    const c = sluttspill.C.kamper;
    _hentVinnerFraKamp(c,  'C_FIN', 17, lagMap, plasseringer);
    _hentTaperFraKamp( c,  'C_FIN', 18, lagMap, plasseringer);
    _hentTapereFraRunde(c, ['C_SF1','C_SF2'],                       19, lagMap, plasseringer);
    _hentTapereFraRunde(c, ['C_QF1','C_QF2','C_QF3','C_QF4'],      21, lagMap, plasseringer);
  }

  return plasseringer.sort((a, b) => a.plass - b.plass);
}

function _hentVinnerFraKamp(kamper, kampId, plass, lagMap, ut) {
  const k = kamper.find(k => k.id === kampId);
  if (!k?.ferdig) return;
  const id = k.vinnerId ?? k.winnerId
    ?? (k.lag1Poeng != null && k.lag2Poeng != null
        ? (k.lag1Poeng > k.lag2Poeng ? k.lag1Id : k.lag2Id)
        : null);
  if (id) { const lag = lagMap[id]; if (lag) ut.push({ plass, lag }); }
}

function _hentTaperFraKamp(kamper, kampId, plass, lagMap, ut) {
  const k = kamper.find(k => k.id === kampId);
  if (!k?.ferdig) return;
  const id = k.taperId ?? k.loserId
    ?? (k.lag1Poeng != null && k.lag2Poeng != null
        ? (k.lag1Poeng < k.lag2Poeng ? k.lag1Id : k.lag2Id)
        : null);
  if (id) { const lag = lagMap[id]; if (lag) ut.push({ plass, lag }); }
}

function _hentTapereFraRunde(kamper, kampIder, plass, lagMap, ut) {
  for (const kampId of kampIder) {
    const k = kamper.find(k => k.id === kampId);
    if (!k?.ferdig) continue;
    const id = k.taperId ?? k.loserId
      ?? (k.lag1Poeng != null && k.lag2Poeng != null
          ? (k.lag1Poeng < k.lag2Poeng ? k.lag1Id : k.lag2Id)
          : null);
    if (id) { const lag = lagMap[id]; if (lag) ut.push({ plass, lag }); }
  }
}

// ════════════════════════════════════════════════════════
// FREMGANG-HJELPER
// ════════════════════════════════════════════════════════
export function beregnFremgang(puljer) {
  let totalt = 0, ferdig = 0;
  for (const p of (puljer ?? [])) {
    for (const k of (p.kamper ?? [])) {
      totalt++;
      if (k.ferdig) ferdig++;
    }
  }
  return { totalt, ferdig, prosent: totalt > 0 ? Math.round((ferdig / totalt) * 100) : 0 };
}

// ════════════════════════════════════════════════════════
// BEST AV 3 — LOGIKK
// ════════════════════════════════════════════════════════

/**
 * Beregner stilling og vinner for en best-av-3-kamp.
 * @param {Array<{l1: number, l2: number}>} games
 * @returns {{ lag1Seire, lag2Seire, ferdig, vinnerLag: 1|2|null }}
 */
export function beregnBestOf3(games) {
  let lag1Seire = 0;
  let lag2Seire = 0;

  for (const g of (games ?? [])) {
    if (g == null || g.l1 == null || g.l2 == null) continue;
    if (g.l1 > g.l2) lag1Seire++;
    else if (g.l2 > g.l1) lag2Seire++;
  }

  const ferdig    = lag1Seire >= 2 || lag2Seire >= 2;
  const vinnerLag = ferdig ? (lag1Seire >= 2 ? 1 : 2) : null;

  return { lag1Seire, lag2Seire, ferdig, vinnerLag };
}

/**
 * Validerer ett enkelt game i en best-av-3-kamp.
 * Gjenbruker validerResultat med game-formatet.
 * @param {number} l1
 * @param {number} l2
 * @param {object} format  — kampformat-objekt
 * @returns {{ ok: boolean, feil?: string }}
 */
export function validerGame(l1, l2, format) {
  return validerResultat(l1, l2, format);
}
