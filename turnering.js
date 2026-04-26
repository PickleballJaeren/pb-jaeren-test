// ════════════════════════════════════════════════════════
// turnering.js — Turneringslogikk
// Puljeoppsett, rangering, kvalifisering og bracket-motor.
// Ingen UI-avhengigheter — ren logikk.
// ════════════════════════════════════════════════════════

import {
  db, SAM,
  collection, doc, addDoc, updateDoc, getDoc, getDocs,
  query, where, orderBy, serverTimestamp, writeBatch,
} from './firebase.js';
import { app } from './state.js';
import { visMelding, visFBFeil } from './ui.js';
import { blandArray } from './rotasjon.js';

// ── Avhengigheter injisert fra app.js ────────────────────
let _naviger              = () => {};
let _krevAdmin            = () => {};
let _getAktivKlubbId      = () => null;

export function turneringInit(deps) {
  _naviger         = deps.naviger;
  _krevAdmin       = deps.krevAdmin;
  _getAktivKlubbId = deps.getAktivKlubbId;
}

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
  STANDARD: 'standard', // seed 1 vs 8, 2 vs 7 osv
  TREKNING:  'trekning', // trekning innen nivåer
};

export const STANDARD_KAMPFORMAT = {
  type:          'single',   // 'single' | 'best_of_3'
  points_to_win: 11,
  win_by:        2,
  max_points:    15,
};

// Hjelper: bygg kampformat-objekt fra poeng-valg
export function lagKampformat(type, points_to_win) {
  const max_points = points_to_win === 15 ? 18 : 15;
  return { type, points_to_win, win_by: 2, max_points };
}

// ════════════════════════════════════════════════════════
// FIRESTORE — SAMLINGER
// Legges til i SAM-objektet ved oppstart (firebase.js røres ikke)
// ════════════════════════════════════════════════════════
const TS = {
  TURNERINGER: 'turneringer',
  T_KAMPER:    'turneringKamper',
};

// ════════════════════════════════════════════════════════
// OPPRETTING AV TURNERING
// ════════════════════════════════════════════════════════
export async function opprettTurnering(konfig) {
  const klubbId = _getAktivKlubbId();
  if (!klubbId) throw new Error('Ingen aktiv klubb.');

  const {
    navn                 = 'Ny turnering',
    antallPuljer         = 2,
    seedingModus         = SEEDING_MODUS.STANDARD,
    plasseringskamperA   = true,
    plasseringskamperBC  = false,
    kampformatPulje      = { ...STANDARD_KAMPFORMAT },
    kampformatKvartfinale = { ...STANDARD_KAMPFORMAT },
    kampformatSemifinale  = { ...STANDARD_KAMPFORMAT },
    kampformatFinale      = lagKampformat('single', 15),
  } = konfig;

  const doc_ = await addDoc(collection(db, TS.TURNERINGER), {
    klubbId,
    navn,
    status:      T_STATUS.SETUP,
    opprettet:   serverTimestamp(),
    lag:         [],
    puljer:      [],
    sluttspill:  { A: null, B: null, C: null },
    konfig: {
      antallPuljer,
      seedingModus,
      plasseringskamperA,
      plasseringskamperBC,
      kampformatPulje,
      kampformatKvartfinale,
      kampformatSemifinale,
      kampformatFinale,
    },
  });

  app.turnering = { id: doc_.id, status: T_STATUS.SETUP, lag: [], puljer: [], sluttspill: { A: null, B: null, C: null }, konfig };
  return doc_.id;
}

// ════════════════════════════════════════════════════════
// HENT TURNERING
// ════════════════════════════════════════════════════════
export async function hentTurnering(turneringId) {
  const snap = await getDoc(doc(db, TS.TURNERINGER, turneringId));
  if (!snap.exists()) throw new Error('Turnering ikke funnet.');
  return { id: snap.id, ...snap.data() };
}

export async function hentAktiveTurneringer() {
  const klubbId = _getAktivKlubbId();
  if (!klubbId || !db) return [];
  try {
    const snap = await getDocs(
      query(collection(db, TS.TURNERINGER),
        where('klubbId', '==', klubbId),
        where('status', '!=', T_STATUS.FINISHED),
        orderBy('status'),
        orderBy('opprettet', 'desc')
      )
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[Turnering] hentAktiveTurneringer:', e?.message);
    return [];
  }
}

export async function hentAlleTurneringer() {
  const klubbId = _getAktivKlubbId();
  if (!klubbId || !db) return [];
  try {
    const snap = await getDocs(
      query(collection(db, TS.TURNERINGER),
        where('klubbId', '==', klubbId),
        where('status', '!=', 'slettet'),
        orderBy('status'),
        orderBy('opprettet', 'desc')
      )
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[Turnering] hentAlleTurneringer:', e?.message);
    return [];
  }
}

// ════════════════════════════════════════════════════════
// LAG-ADMINISTRASJON
// ════════════════════════════════════════════════════════
export async function leggTilLag(turneringId, lagNavn) {
  if (!lagNavn?.trim()) throw new Error('Lagnavn kan ikke være tomt.');
  const t = await hentTurnering(turneringId);
  if (t.status !== T_STATUS.SETUP) throw new Error('Kan kun endre lag i oppsettfasen.');
  if (t.lag.length >= 32) throw new Error('Maks 32 lag per turnering.');

  const nyttLag = {
    id:   `lag_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    navn: lagNavn.trim(),
    seed: t.lag.length + 1,
  };
  const nyeLag = [...t.lag, nyttLag];
  await updateDoc(doc(db, TS.TURNERINGER, turneringId), { lag: nyeLag });
  return nyttLag;
}

export async function fjernLag(turneringId, lagId) {
  const t = await hentTurnering(turneringId);
  if (t.status !== T_STATUS.SETUP) throw new Error('Kan kun endre lag i oppsettfasen.');
  const nyeLag = t.lag.filter(l => l.id !== lagId)
    .map((l, i) => ({ ...l, seed: i + 1 }));
  await updateDoc(doc(db, TS.TURNERINGER, turneringId), { lag: nyeLag });
}

export async function oppdaterLagNavn(turneringId, lagId, nyttNavn) {
  if (!nyttNavn?.trim()) throw new Error('Navn kan ikke være tomt.');
  const t = await hentTurnering(turneringId);
  if (t.status !== T_STATUS.SETUP) throw new Error('Kan kun endre lag i oppsettfasen.');
  const nyeLag = t.lag.map(l => l.id === lagId ? { ...l, navn: nyttNavn.trim() } : l);
  await updateDoc(doc(db, TS.TURNERINGER, turneringId), { lag: nyeLag });
}

export async function flyttLag(turneringId, lagId, tilPuljeId) {
  const t = await hentTurnering(turneringId);
  if (t.status !== T_STATUS.SETUP) throw new Error('Kan kun flytte lag i oppsettfasen.');
  const nyePuljer = t.puljer.map(p => ({
    ...p,
    lagIds: p.lagIds.filter(id => id !== lagId),
  })).map(p => p.id === tilPuljeId
    ? { ...p, lagIds: [...p.lagIds, lagId] }
    : p
  );
  await updateDoc(doc(db, TS.TURNERINGER, turneringId), { puljer: nyePuljer });
}

// ════════════════════════════════════════════════════════
// PULJEOPPSETT
// Fordeler lag i puljer med maks 1 lags differanse
// ════════════════════════════════════════════════════════
export function genererPuljer(lag, antallPuljer) {
  if (!lag?.length) throw new Error('Ingen lag å fordele.');
  if (antallPuljer < 2 || antallPuljer > 4) throw new Error('Antall puljer må være 2–4.');
  if (lag.length < antallPuljer * 2) throw new Error(`Trenger minst ${antallPuljer * 2} lag for ${antallPuljer} puljer.`);

  // Slange-seeding: lag 1 til bunn, lag 2 tilbake osv — jevner ut styrke
  const puljer = Array.from({ length: antallPuljer }, (_, i) => ({
    id:     `pulje_${i + 1}`,
    navn:   `Pulje ${String.fromCharCode(65 + i)}`, // A, B, C, D
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

export async function lagrePuljer(turneringId, puljer) {
  await updateDoc(doc(db, TS.TURNERINGER, turneringId), { puljer });
}

// ════════════════════════════════════════════════════════
// ROUND ROBIN — kampgenerering
// ════════════════════════════════════════════════════════
export function genererRoundRobin(lagIds) {
  const n      = lagIds.length;
  const kamper = [];
  let kampNr   = 1;

  if (n < 2) return kamper;

  // Berger-tabell algoritme for round robin
  const liste = [...lagIds];
  if (n % 2 !== 0) liste.push('BYE'); // phantom lag ved odde antall
  const m = liste.length;

  for (let runde = 0; runde < m - 1; runde++) {
    for (let i = 0; i < m / 2; i++) {
      const h = liste[i];
      const b = liste[m - 1 - i];
      if (h !== 'BYE' && b !== 'BYE') {
        kamper.push({
          id:      `rr_${kampNr}`,
          kampNr:  kampNr++,
          runde:   runde + 1,
          lag1Id:  h,
          lag2Id:  b,
          lag1Poeng: null,
          lag2Poeng: null,
          ferdig:  false,
          walkover: false,
        });
      }
    }
    // Roter — behold første element fast
    const siste = liste.pop();
    liste.splice(1, 0, siste);
  }

  return kamper;
}

export async function startPuljespill(turneringId) {
  const t = await hentTurnering(turneringId);
  if (t.status !== T_STATUS.SETUP) throw new Error('Turneringen er allerede startet.');
  if (!t.puljer?.length) throw new Error('Generer puljer først.');
  if (!t.lag?.length) throw new Error('Ingen lag registrert.');

  const batch = writeBatch(db);
  const tRef  = doc(db, TS.TURNERINGER, turneringId);

  // Generer kamper for hver pulje og lagre dem
  const puljeMedKamper = t.puljer.map(p => ({
    ...p,
    kamper: genererRoundRobin(p.lagIds),
  }));

  batch.update(tRef, {
    puljer:  puljeMedKamper,
    status:  T_STATUS.GROUP_PLAY,
    startDato: serverTimestamp(),
  });

  await batch.commit();
  visMelding('Puljespill startet!');
  return puljeMedKamper;
}

// ════════════════════════════════════════════════════════
// RESULTATHÅNDTERING — puljekamper
// ════════════════════════════════════════════════════════
export async function registrerPuljeresultat(turneringId, puljeId, kampId, lag1Poeng, lag2Poeng) {
  const t = await hentTurnering(turneringId);
  if (t.status !== T_STATUS.GROUP_PLAY) throw new Error('Puljespill er ikke aktivt.');

  const format  = t.konfig?.kampformatPulje ?? STANDARD_KAMPFORMAT;
  const valider = validerResultat(lag1Poeng, lag2Poeng, format);
  if (!valider.ok) throw new Error(valider.feil);

  const nyePuljer = t.puljer.map(p => {
    if (p.id !== puljeId) return p;
    return {
      ...p,
      kamper: p.kamper.map(k => k.id !== kampId ? k : {
        ...k, lag1Poeng, lag2Poeng, ferdig: true,
      }),
    };
  });

  await updateDoc(doc(db, TS.TURNERINGER, turneringId), { puljer: nyePuljer });
}

export async function registrerWalkover(turneringId, puljeId, kampId, vinnerId) {
  const t = await hentTurnering(turneringId);
  const nyePuljer = t.puljer.map(p => {
    if (p.id !== puljeId) return p;
    return {
      ...p,
      kamper: p.kamper.map(k => {
        if (k.id !== kampId) return k;
        const vinner1 = k.lag1Id === vinnerId;
        return {
          ...k,
          lag1Poeng: vinner1 ? 11 : 0,
          lag2Poeng: vinner1 ? 0  : 11,
          ferdig:    true,
          walkover:  true,
          taperId:   vinner1 ? k.lag2Id : k.lag1Id,
        };
      }),
    };
  });
  await updateDoc(doc(db, TS.TURNERINGER, turneringId), { puljer: nyePuljer });
}

// ════════════════════════════════════════════════════════
// HENT KAMPFORMAT FOR RUNDE
// Sjekker kamp-spesifikt format først, faller tilbake på konfig per runde
// ════════════════════════════════════════════════════════
export function hentFormatForRunde(rundeNavn, konfig, kampFormat = null) {
  // Kamp-spesifikt format overstyrer alt
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
// VALIDERING AV RESULTAT
// ════════════════════════════════════════════════════════
export function validerResultat(p1, p2, format) {
  const { points_to_win, win_by, max_points, type } = format;
  if (isNaN(p1) || isNaN(p2) || p1 < 0 || p2 < 0) {
    return { ok: false, feil: 'Poeng må være positive tall.' };
  }
  if (type === 'single') {
    const vinner   = Math.max(p1, p2);
    const taper    = Math.min(p1, p2);
    const diff     = vinner - taper;
    if (vinner < points_to_win) return { ok: false, feil: `Vinner trenger minst ${points_to_win} poeng.` };
    if (vinner > max_points)    return { ok: false, feil: `Maks ${max_points} poeng.` };
    if (vinner === max_points)  return { ok: true }; // cap nådd
    if (diff < win_by)          return { ok: false, feil: `Vinner med minst ${win_by} poeng.` };
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════
// PULJRANGERING
// Rekkefølge: seire → innbyrdes → poengdifferanse → scorede poeng
// Tie-break: mini-tabell → total poengdifferanse
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

  const lagListe = Object.values(stats);
  return sorterPuljeTabell(lagListe, pulje.kamper ?? []);
}

function sorterPuljeTabell(lagListe, kamper) {
  // Sorter med tie-break
  return [...lagListe].sort((a, b) => {
    if (b.seire !== a.seire) return b.seire - a.seire;

    // Innbyrdes oppgjør (kun relevant mellom to lag)
    const innbyrdes = sjekkInnbyrdes(a.lagId, b.lagId, kamper);
    if (innbyrdes !== 0) return innbyrdes;

    if (b.pd !== a.pd) return b.pd - a.pd;
    return b.pf - a.pf;
  });
}

function sjekkInnbyrdes(idA, idB, kamper) {
  for (const k of kamper) {
    if (!k.ferdig) continue;
    if (k.lag1Id === idA && k.lag2Id === idB) {
      return k.lag1Poeng > k.lag2Poeng ? -1 : 1;
    }
    if (k.lag1Id === idB && k.lag2Id === idA) {
      return k.lag2Poeng > k.lag1Poeng ? -1 : 1;
    }
  }
  return 0;
}

// Tie-break for sammenligning på tvers av puljer (ingen innbyrdes)
// Brukes for å velge beste N.plasser
function sammenlignPaaTvers(a, b) {
  if (b.seire !== a.seire) return b.seire - a.seire;
  if (b.pd    !== a.pd)    return b.pd    - a.pd;
  return b.pf - a.pf;
}

// ════════════════════════════════════════════════════════
// KVALIFISERING TIL SLUTTSPILL
// Returnerer { A: lagId[], B: lagId[], C: lagId[] }
// ════════════════════════════════════════════════════════
export function kvalifiserTilSluttspill(turneringMedTabeller) {
  const { puljer, konfig } = turneringMedTabeller;
  const antallPuljer = puljer.length;

  // Bygg tabeller for alle puljer
  const tabeller = puljer.map(p =>
    beregnPuljetabell(p, turneringMedTabeller.lag)
  );

  // Hvem kvalifiserer til A (topp 8)?
  let aKandidater = [];

  if (antallPuljer === 2) {
    // Topp 4 fra hver
    tabeller.forEach(t => aKandidater.push(...t.slice(0, 4)));
  } else if (antallPuljer === 3) {
    // Topp 2 fra hver (6) + 2 beste 3.plasser (2)
    tabeller.forEach(t => aKandidater.push(...t.slice(0, 2)));
    const tredjepl = tabeller.map(t => t[2]).filter(Boolean)
      .sort(sammenlignPaaTvers);
    aKandidater.push(...tredjepl.slice(0, 2));
  } else if (antallPuljer === 4) {
    // Topp 2 fra hver
    tabeller.forEach(t => aKandidater.push(...t.slice(0, 2)));
  }

  // Sørg for at A har maks 8
  aKandidater = aKandidater.slice(0, 8);
  const aIds  = aKandidater.map(l => l.lagId);

  // Alle gjenværende — global rangering
  const gjenvarende = tabeller.flat()
    .filter(l => !aIds.includes(l.lagId))
    .sort(sammenlignPaaTvers);

  const bIds = gjenvarende.slice(0,  8).map(l => l.lagId);
  const cIds = gjenvarende.slice(8, 24).map(l => l.lagId); // maks 16 til C

  return { A: aIds, B: bIds, C: cIds };
}

// ════════════════════════════════════════════════════════
// BRACKET-MOTOR
// Bygger bracket for A (full), B og C (ferdig ved første tap)
// Dynamisk startnivå basert på antall lag
// ════════════════════════════════════════════════════════

/**
 * Bestemmer startnivå basert på antall lag.
 * Returnerer: 'finale' | 'semifinale' | 'kvartfinale' | 'åttedelsfinale'
 */
export function startnivaa(antallLag) {
  if (antallLag <= 2)  return 'finale';
  if (antallLag <= 4)  return 'semifinale';
  if (antallLag <= 8)  return 'kvartfinale';
  return 'aattedelsfinale';
}

/**
 * Genererer A-bracket (plass 1–8).
 * Alle tapere spiller videre for unik plasseringsbestemmelse.
 * Seeding: 1v8, 2v7, 3v6, 4v5.
 */
export function genererABracket(seededeIds, konfig) {
  const n     = seededeIds.length;
  const kamper = [];

  if (n <= 0) return kamper;

  const plasseringPaa = konfig?.plasseringskamperA !== false;

  if (n === 2) {
    kamper.push(lagKamp('A_FIN', seededeIds[0], seededeIds[1], null, null, '1. plass'));
    return kamper;
  }

  if (n <= 4) {
    // Semifinale-nivå
    kamper.push(lagKamp('A_SF1', seededeIds[0], seededeIds[3] ?? null, 'A_FIN', plasseringPaa ? 'A_BRO' : null, 'Semifinale'));
    kamper.push(lagKamp('A_SF2', seededeIds[1], seededeIds[2] ?? null, 'A_FIN', plasseringPaa ? 'A_BRO' : null, 'Semifinale'));
    kamper.push(lagKamp('A_FIN',  null, null, null, null, '1. plass'));
    if (plasseringPaa) {
      kamper.push(lagKamp('A_BRO', null, null, null, null, '3. plass'));
    }
    return kamper;
  }

  // Kvartfinale (8 lag)
  // Seed-par: 1v8, 2v7, 3v6, 4v5
  const par = [
    [seededeIds[0], seededeIds[7] ?? null],
    [seededeIds[3], seededeIds[4] ?? null],
    [seededeIds[1], seededeIds[6] ?? null],
    [seededeIds[2], seededeIds[5] ?? null],
  ];

  // Kvartfinaler — vinnere til SF, tapere til plasseringskamp 5-8
  kamper.push(lagKamp('A_QF1', par[0][0], par[0][1], 'A_SF1', plasseringPaa ? 'A_P5_SF1' : null, 'Kvartfinale'));
  kamper.push(lagKamp('A_QF2', par[1][0], par[1][1], 'A_SF1', plasseringPaa ? 'A_P5_SF1' : null, 'Kvartfinale'));
  kamper.push(lagKamp('A_QF3', par[2][0], par[2][1], 'A_SF2', plasseringPaa ? 'A_P5_SF2' : null, 'Kvartfinale'));
  kamper.push(lagKamp('A_QF4', par[3][0], par[3][1], 'A_SF2', plasseringPaa ? 'A_P5_SF2' : null, 'Kvartfinale'));

  // Semifinaler
  kamper.push(lagKamp('A_SF1', null, null, 'A_FIN', 'A_BRO', 'Semifinale'));
  kamper.push(lagKamp('A_SF2', null, null, 'A_FIN', 'A_BRO', 'Semifinale'));

  // Finale og bronsefinale
  kamper.push(lagKamp('A_FIN', null, null, null, null, '1. plass'));
  kamper.push(lagKamp('A_BRO', null, null, null, null, '3. plass'));

  if (plasseringPaa) {
    // 5–8 plasseringsspill
    kamper.push(lagKamp('A_P5_SF1', null, null, 'A_P5_FIN', 'A_P7_FIN', 'Plass 5–8'));
    kamper.push(lagKamp('A_P5_SF2', null, null, 'A_P5_FIN', 'A_P7_FIN', 'Plass 5–8'));
    kamper.push(lagKamp('A_P5_FIN', null, null, null, null, '5. plass'));
    kamper.push(lagKamp('A_P7_FIN', null, null, null, null, '7. plass'));
  }

  return kamper;
}

/**
 * Genererer B/C-bracket.
 * Ferdig ved første tap (kun winner_to), delte plasseringer.
 * Startplass beregnes av antall lag.
 */
export function genererBCBracket(lagIds, nivaa, startPlass) {
  const n      = lagIds.length;
  const prefix = nivaa; // 'B' eller 'C'
  const kamper = [];

  if (n < 2) return kamper;

  const nivaaStart = startnivaa(n);

  if (nivaaStart === 'finale') {
    kamper.push(lagKamp(`${prefix}_FIN`, lagIds[0], lagIds[1] ?? null, null, null, `${startPlass}. plass`));
    return kamper;
  }

  if (nivaaStart === 'semifinale') {
    // 3–4 lag
    const s = lagIds;
    kamper.push(lagKamp(`${prefix}_SF1`, s[0], s[3] ?? null, `${prefix}_FIN`, null, 'Semifinale'));
    kamper.push(lagKamp(`${prefix}_SF2`, s[1], s[2] ?? null, `${prefix}_FIN`, null, 'Semifinale'));
    kamper.push(lagKamp(`${prefix}_FIN`, null, null, null, null, `${startPlass}. plass`));
    return kamper;
  }

  if (nivaaStart === 'kvartfinale') {
    // 5–8 lag
    const s = lagIds;
    kamper.push(lagKamp(`${prefix}_QF1`, s[0], s[7] ?? null, `${prefix}_SF1`, null, 'Kvartfinale'));
    kamper.push(lagKamp(`${prefix}_QF2`, s[3], s[4] ?? null, `${prefix}_SF1`, null, 'Kvartfinale'));
    kamper.push(lagKamp(`${prefix}_QF3`, s[1], s[6] ?? null, `${prefix}_SF2`, null, 'Kvartfinale'));
    kamper.push(lagKamp(`${prefix}_QF4`, s[2], s[5] ?? null, `${prefix}_SF2`, null, 'Kvartfinale'));
    kamper.push(lagKamp(`${prefix}_SF1`, null, null, `${prefix}_FIN`, null, 'Semifinale'));
    kamper.push(lagKamp(`${prefix}_SF2`, null, null, `${prefix}_FIN`, null, 'Semifinale'));
    kamper.push(lagKamp(`${prefix}_FIN`, null, null, null, null, `${startPlass}. plass`));
    return kamper;
  }

  // Åttedelsfinale (9–16 lag — kun C)
  const s = lagIds;
  for (let i = 0; i < 8; i++) {
    kamper.push(lagKamp(`${prefix}_R1_${i+1}`, s[i] ?? null, s[15-i] ?? null, `${prefix}_QF${Math.floor(i/2)+1}`, null, 'Åttedelsfinale'));
  }
  kamper.push(lagKamp(`${prefix}_QF1`, null, null, `${prefix}_SF1`, null, 'Kvartfinale'));
  kamper.push(lagKamp(`${prefix}_QF2`, null, null, `${prefix}_SF1`, null, 'Kvartfinale'));
  kamper.push(lagKamp(`${prefix}_QF3`, null, null, `${prefix}_SF2`, null, 'Kvartfinale'));
  kamper.push(lagKamp(`${prefix}_QF4`, null, null, `${prefix}_SF2`, null, 'Kvartfinale'));
  kamper.push(lagKamp(`${prefix}_SF1`, null, null, `${prefix}_FIN`, null, 'Semifinale'));
  kamper.push(lagKamp(`${prefix}_SF2`, null, null, `${prefix}_FIN`, null, 'Semifinale'));
  kamper.push(lagKamp(`${prefix}_FIN`, null, null, null, null, `${startPlass}. plass`));
  return kamper;
}

function lagKamp(id, lag1Id, lag2Id, winnerTo, loserTo, runde) {
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
    format:    null, // null = bruk konfig-default, ellers overstyrt per kamp
  };
}

// ════════════════════════════════════════════════════════
// OPPDATER FORMAT PÅ ENKELT SLUTTSPILLKAMP (setup-fase)
// ════════════════════════════════════════════════════════
export async function oppdaterKampformat(turneringId, nivaa, kampId, format) {
  const t      = await hentTurnering(turneringId);
  const kamper = [...(t.sluttspill?.[nivaa]?.kamper ?? [])];
  const idx    = kamper.findIndex(k => k.id === kampId);
  if (idx < 0) throw new Error('Kamp ikke funnet.');
  kamper[idx] = { ...kamper[idx], format };
  await updateDoc(doc(db, TS.TURNERINGER, turneringId), {
    [`sluttspill.${nivaa}.kamper`]: kamper,
  });
}

// ════════════════════════════════════════════════════════
// SEEDING — Mode A (standard) og Mode B (trekning)
// ════════════════════════════════════════════════════════

/**
 * Seeder A-laget (8 lag) basert på puljeplasseringer.
 * Justerer for å unngå lag fra samme pulje i QF.
 */
export function seedALag(kvalifiserteIds, puljer, modus) {
  if (modus === SEEDING_MODUS.TREKNING) {
    return trekkSeeding(kvalifiserteIds, puljer);
  }
  return standardSeeding(kvalifiserteIds, puljer);
}

function standardSeeding(ids, puljer) {
  // Bruk rekkefølgen fra kvalifisering som seed (allerede rangert)
  // Juster seed 7 og 8 om de er fra samme pulje som seed 1 og 2
  const seeded = [...ids];
  for (let i = 0; i < 4; i++) {
    const motstanderIdx = 7 - i;
    if (samePulje(seeded[i], seeded[motstanderIdx], puljer)) {
      // Bytt motstander med nærmeste seed som er fra annen pulje
      for (let j = motstanderIdx - 1; j > i; j--) {
        if (!samePulje(seeded[i], seeded[j], puljer)) {
          [seeded[motstanderIdx], seeded[j]] = [seeded[j], seeded[motstanderIdx]];
          break;
        }
      }
    }
  }
  return seeded;
}

function trekkSeeding(ids, puljer) {
  // Del i nivåer basert på puljeplassering
  const vinnere = ids.filter(id => erPuljeVinner(id, puljer));
  const resten  = ids.filter(id => !erPuljeVinner(id, puljer));

  // Trekk innen hvert nivå, men unngå samme pulje
  const trekkeListe = [
    ...trekkMedRestriksjon(blandArray(vinnere), puljer),
    ...trekkMedRestriksjon(blandArray(resten),  puljer),
  ];
  return trekkeListe;
}

function trekkMedRestriksjon(lagIds, puljer) {
  // Enkel shuffle som prøver å unngå naboer fra samme pulje
  const resultat = [...lagIds];
  for (let forsok = 0; forsok < 20; forsok++) {
    let ok = true;
    for (let i = 0; i < resultat.length - 1; i++) {
      if (samePulje(resultat[i], resultat[i+1], puljer)) {
        ok = false;
        const j = Math.floor(Math.random() * resultat.length);
        [resultat[i+1], resultat[j]] = [resultat[j], resultat[i+1]];
      }
    }
    if (ok) break;
  }
  return resultat;
}

function samePulje(id1, id2, puljer) {
  for (const p of (puljer ?? [])) {
    if (p.lagIds.includes(id1) && p.lagIds.includes(id2)) return true;
  }
  return false;
}

function erPuljeVinner(lagId, puljer) {
  return puljer?.some(p => p.lagIds[0] === lagId) ?? false;
}

// ════════════════════════════════════════════════════════
// START SLUTTSPILL
// ════════════════════════════════════════════════════════
export async function startSluttspill(turneringId) {
  const t = await hentTurnering(turneringId);
  if (t.status !== T_STATUS.PLAYOFF_SEEDING && t.status !== T_STATUS.GROUP_PLAY) {
    throw new Error('Turneringen er ikke klar for sluttspill.');
  }

  const kval = kvalifiserTilSluttspill(t);

  // Seed A-laget
  const seededeA = seedALag(kval.A, t.puljer, t.konfig?.seedingModus ?? SEEDING_MODUS.STANDARD);

  // Generer brackets
  const aBracket = genererABracket(seededeA, t.konfig);
  const bBracket = kval.B.length >= 2 ? genererBCBracket(kval.B, 'B', 9)  : [];
  const cBracket = kval.C.length >= 2 ? genererBCBracket(kval.C, 'C', 17) : [];

  const sluttspill = {
    A: { lagIds: kval.A, seeding: seededeA, kamper: aBracket },
    B: { lagIds: kval.B, kamper: bBracket },
    C: { lagIds: kval.C, kamper: cBracket },
  };

  await updateDoc(doc(db, TS.TURNERINGER, turneringId), {
    sluttspill,
    status:      T_STATUS.PLAYOFFS,
    kvalifisert: kval,
  });

  visMelding('Sluttspill startet!');
  return sluttspill;
}

// ════════════════════════════════════════════════════════
// REGISTRER SLUTTSPILLRESULTAT + AUTOMATISK PROGRESJON
// ════════════════════════════════════════════════════════
export async function registrerSluttspillResultat(turneringId, nivaa, kampId, lag1Poeng, lag2Poeng) {
  const t = await hentTurnering(turneringId);
  if (t.status !== T_STATUS.PLAYOFFS) throw new Error('Sluttspill er ikke aktivt.');

  const bracket  = [...(t.sluttspill[nivaa]?.kamper ?? [])];
  const kampIdx  = bracket.findIndex(k => k.id === kampId);
  if (kampIdx < 0) throw new Error('Kamp ikke funnet.');

  const kamp   = bracket[kampIdx];
  const format = hentFormatForRunde(kamp.runde, t.konfig, kamp.format ?? null);
  const val    = validerResultat(lag1Poeng, lag2Poeng, format);
  if (!val.ok) throw new Error(val.feil);
  const vinnerId = lag1Poeng > lag2Poeng ? kamp.lag1Id : kamp.lag2Id;
  const taperId  = lag1Poeng > lag2Poeng ? kamp.lag2Id : kamp.lag1Id;

  bracket[kampIdx] = { ...kamp, lag1Poeng, lag2Poeng, ferdig: true, vinnerId, taperId };

  // Automatisk progresjon — flytt lag til neste kamp
  if (kamp.winner_to) {
    const nIdx = bracket.findIndex(k => k.id === kamp.winner_to);
    if (nIdx >= 0) {
      const neste = bracket[nIdx];
      bracket[nIdx] = {
        ...neste,
        lag1Id: neste.lag1Id === null ? vinnerId : neste.lag1Id,
        lag2Id: neste.lag1Id !== null && neste.lag2Id === null ? vinnerId : neste.lag2Id,
      };
    }
  }

  // Loserbane (kun A-bracket)
  if (kamp.loser_to) {
    const nIdx = bracket.findIndex(k => k.id === kamp.loser_to);
    if (nIdx >= 0) {
      const neste = bracket[nIdx];
      bracket[nIdx] = {
        ...neste,
        lag1Id: neste.lag1Id === null ? taperId : neste.lag1Id,
        lag2Id: neste.lag1Id !== null && neste.lag2Id === null ? taperId : neste.lag2Id,
      };
    }
  }

  const nyttSluttspill = {
    ...t.sluttspill,
    [nivaa]: { ...t.sluttspill[nivaa], kamper: bracket },
  };

  await updateDoc(doc(db, TS.TURNERINGER, turneringId), { sluttspill: nyttSluttspill });
  return nyttSluttspill;
}

// ════════════════════════════════════════════════════════
// BEREGN ENDELIG RANGERING
// ════════════════════════════════════════════════════════
export function beregnEndeligRangering(turnering) {
  const { sluttspill, lag } = turnering;
  const lagMap = Object.fromEntries(lag.map(l => [l.id, l]));
  const plasseringer = [];

  // A-bracket plasseringer
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

  // B-bracket
  if (sluttspill?.B?.kamper?.length) {
    const b = sluttspill.B.kamper;
    _hentVinnerFraKamp(b, 'B_FIN',  9,  lagMap, plasseringer);
    _hentTaperFraKamp( b, 'B_FIN',  10, lagMap, plasseringer);
    _hentTapereFraRunde(b, ['B_SF1','B_SF2'],  11, lagMap, plasseringer);
    _hentTapereFraRunde(b, ['B_QF1','B_QF2','B_QF3','B_QF4'], 13, lagMap, plasseringer);
  }

  // C-bracket
  if (sluttspill?.C?.kamper?.length) {
    const c = sluttspill.C.kamper;
    _hentVinnerFraKamp(c, 'C_FIN',  17, lagMap, plasseringer);
    _hentTaperFraKamp( c, 'C_FIN',  18, lagMap, plasseringer);
    _hentTapereFraRunde(c, ['C_SF1','C_SF2'],  19, lagMap, plasseringer);
    _hentTapereFraRunde(c, ['C_QF1','C_QF2','C_QF3','C_QF4'], 21, lagMap, plasseringer);
  }

  return plasseringer.sort((a, b) => a.plass - b.plass);
}

function _hentVinnerFraKamp(kamper, kampId, plass, lagMap, ut) {
  const k = kamper.find(k => k.id === kampId);
  if (k?.ferdig && k.vinnerId && lagMap[k.vinnerId]) {
    ut.push({ plass, lag: lagMap[k.vinnerId] });
  }
}

function _hentTaperFraKamp(kamper, kampId, plass, lagMap, ut) {
  const k = kamper.find(k => k.id === kampId);
  if (k?.ferdig && k.taperId && lagMap[k.taperId]) {
    ut.push({ plass, lag: lagMap[k.taperId] });
  }
}

function _hentTapereFraRunde(kamper, kampIder, plass, lagMap, ut) {
  for (const id of kampIder) {
    const k = kamper.find(k => k.id === id);
    if (k?.ferdig && k.taperId && lagMap[k.taperId]) {
      ut.push({ plass, lag: lagMap[k.taperId] });
    }
  }
}

// ════════════════════════════════════════════════════════
// AVSLUTT TURNERING
// ════════════════════════════════════════════════════════
export async function avsluttTurnering(turneringId) {
  const t           = await hentTurnering(turneringId);
  const rangering   = beregnEndeligRangering(t);
  await updateDoc(doc(db, TS.TURNERINGER, turneringId), {
    status:    T_STATUS.FINISHED,
    avsluttet: serverTimestamp(),
    rangering,
  });
  visMelding('Turnering avsluttet!');
  return rangering;
}

export async function slettTurnering(turneringId) {
  // Myk sletting — sett status til 'slettet' for å beholde historikk
  await updateDoc(doc(db, TS.TURNERINGER, turneringId), {
    status:   'slettet',
    slettet:  serverTimestamp(),
  });
}

// ════════════════════════════════════════════════════════
// FREMGANG-HJELPER — hvor mange kamper er ferdig?
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
