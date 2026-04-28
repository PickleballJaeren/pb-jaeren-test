// ════════════════════════════════════════════════════════
// turnering.js — Firestore-operasjoner for turneringer
// All beregningslogikk ligger i turnering-logikk.js.
// ════════════════════════════════════════════════════════

import {
  db,
  collection, doc, addDoc, updateDoc, getDoc, getDocs,
  query, where, orderBy, serverTimestamp, writeBatch,
} from './firebase.js';
import { app } from './state.js';
import { visMelding, visFBFeil } from './ui.js';
import {
  T_STATUS,
  SEEDING_MODUS,
  STANDARD_KAMPFORMAT,
  lagKampformat,
  validerResultat,
  hentFormatForRunde,
  genererPuljer,
  genererRoundRobin,
  beregnPuljetabell,
  kvalifiserTilSluttspill,
  startnivaa,
  genererABracket,
  genererBCBracket,
  seedALag,
  beregnEndeligRangering,
  beregnFremgang,
  beregnBestOf3,
  validerGame,
} from './turnering-logikk.js';

// Re-eksporter logikk-funksjoner slik at eksisterende import-setninger
// i turnering-ui.js og arkiv.js ikke trenger å endres.
export {
  T_STATUS,
  SEEDING_MODUS,
  STANDARD_KAMPFORMAT,
  lagKampformat,
  validerResultat,
  hentFormatForRunde,
  genererPuljer,
  genererRoundRobin,
  beregnPuljetabell,
  kvalifiserTilSluttspill,
  startnivaa,
  genererABracket,
  genererBCBracket,
  seedALag,
  beregnEndeligRangering,
  beregnFremgang,
  beregnBestOf3,
  validerGame,
};

// ── Avhengigheter injisert fra app.js ────────────────────
let _naviger         = () => {};
let _krevAdmin       = () => {};
let _getAktivKlubbId = () => null;

export function turneringInit(deps) {
  _naviger         = deps.naviger;
  _krevAdmin       = deps.krevAdmin;
  _getAktivKlubbId = deps.getAktivKlubbId;
}

// ════════════════════════════════════════════════════════
// FIRESTORE — SAMLINGER
// ════════════════════════════════════════════════════════
const TS = {
  TURNERINGER: 'turneringer',
  T_KAMPER:    'turneringKamper',
};

// ════════════════════════════════════════════════════════
// OPPRETTING
// ════════════════════════════════════════════════════════
export async function opprettTurnering(konfig) {
  const klubbId = _getAktivKlubbId();
  if (!klubbId) throw new Error('Ingen aktiv klubb.');

  const {
    navn                  = 'Ny turnering',
    antallPuljer          = 2,
    seedingModus          = SEEDING_MODUS.STANDARD,
    plasseringskamperA    = true,
    plasseringskamperBC   = false,
    kampformatPulje       = { ...STANDARD_KAMPFORMAT },
    kampformatKvartfinale = { ...STANDARD_KAMPFORMAT },
    kampformatSemifinale  = { ...STANDARD_KAMPFORMAT },
    kampformatFinale      = lagKampformat('single', 15),
  } = konfig;

  const doc_ = await addDoc(collection(db, TS.TURNERINGER), {
    klubbId,
    navn,
    status:     T_STATUS.SETUP,
    opprettet:  serverTimestamp(),
    lag:        [],
    puljer:     [],
    sluttspill: { A: null, B: null, C: null },
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

  app.turnering = {
    id: doc_.id, status: T_STATUS.SETUP,
    lag: [], puljer: [], sluttspill: { A: null, B: null, C: null }, konfig,
  };
  return doc_.id;
}

// ════════════════════════════════════════════════════════
// HENT
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
  await updateDoc(doc(db, TS.TURNERINGER, turneringId), { lag: [...t.lag, nyttLag] });
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
  const nyePuljer = t.puljer
    .map(p => ({ ...p, lagIds: p.lagIds.filter(id => id !== lagId) }))
    .map(p => p.id === tilPuljeId ? { ...p, lagIds: [...p.lagIds, lagId] } : p);
  await updateDoc(doc(db, TS.TURNERINGER, turneringId), { puljer: nyePuljer });
}

// ════════════════════════════════════════════════════════
// PULJESPILL
// ════════════════════════════════════════════════════════
export async function lagrePuljer(turneringId, puljer) {
  await updateDoc(doc(db, TS.TURNERINGER, turneringId), { puljer });
}

export async function startPuljespill(turneringId) {
  const t = await hentTurnering(turneringId);
  if (t.status !== T_STATUS.SETUP) throw new Error('Turneringen er allerede startet.');
  if (!t.puljer?.length) throw new Error('Generer puljer først.');
  if (!t.lag?.length) throw new Error('Ingen lag registrert.');

  const puljeMedKamper = t.puljer.map(p => ({
    ...p,
    kamper: genererRoundRobin(p.lagIds),
  }));

  const batch = writeBatch(db);
  batch.update(doc(db, TS.TURNERINGER, turneringId), {
    puljer:    puljeMedKamper,
    status:    T_STATUS.GROUP_PLAY,
    startDato: serverTimestamp(),
  });
  await batch.commit();

  visMelding('Puljespill startet!');
  return puljeMedKamper;
}

export async function registrerPuljeresultat(turneringId, puljeId, kampId, lag1Poeng, lag2Poeng, games = null) {
  const t = await hentTurnering(turneringId);
  if (t.status !== T_STATUS.GROUP_PLAY) throw new Error('Puljespill er ikke aktivt.');

  const format = t.konfig?.kampformatPulje ?? STANDARD_KAMPFORMAT;

  if (format.type === 'best_of_3' && games?.length) {
    // Best av 3 — valider hvert enkelt game
    for (let i = 0; i < games.length; i++) {
      const val = validerResultat(games[i].l1, games[i].l2, format);
      if (!val.ok) throw new Error(`Game ${i + 1}: ${val.feil}`);
    }
  } else {
    // Single game — valider som før
    const valider = validerResultat(lag1Poeng, lag2Poeng, format);
    if (!valider.ok) throw new Error(valider.feil);
  }

  const nyePuljer = t.puljer.map(p => p.id !== puljeId ? p : ({
    ...p,
    kamper: p.kamper.map(k => k.id !== kampId ? k : {
      ...k,
      lag1Poeng,
      lag2Poeng,
      ferdig: true,
      ...(games ? { games } : {}),
    }),
  }));
  await updateDoc(doc(db, TS.TURNERINGER, turneringId), { puljer: nyePuljer });
}

export async function registrerWalkover(turneringId, puljeId, kampId, vinnerId) {
  const t = await hentTurnering(turneringId);
  const nyePuljer = t.puljer.map(p => p.id !== puljeId ? p : {
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
  });
  await updateDoc(doc(db, TS.TURNERINGER, turneringId), { puljer: nyePuljer });
}

// ════════════════════════════════════════════════════════
// SLUTTSPILL
// ════════════════════════════════════════════════════════
export async function startSluttspill(turneringId) {
  const t = await hentTurnering(turneringId);
  if (t.status !== T_STATUS.PLAYOFF_SEEDING && t.status !== T_STATUS.GROUP_PLAY) {
    throw new Error('Turneringen er ikke klar for sluttspill.');
  }

  const kval      = kvalifiserTilSluttspill(t);
  const modus     = t.konfig?.seedingModus ?? SEEDING_MODUS.STANDARD;
  const seededeA  = seedALag(kval.A, t.puljer, modus, kval);
  const erKryss   = modus === SEEDING_MODUS.KRYSS;
  const parOverstyr = erKryss && seededeA.length === 8 ? seededeA : null;

  const aBracket = genererABracket(kval.A, t.konfig, parOverstyr);
  const bBracket = kval.B.length >= 2 ? genererBCBracket(kval.B, 'B', 9)  : [];
  const cBracket = kval.C.length >= 2 ? genererBCBracket(kval.C, 'C', 17) : [];

  const sluttspill = {
    A: { lagIds: kval.A, seeding: erKryss ? parOverstyr : seededeA, kamper: aBracket },
    B: { lagIds: kval.B, kamper: bBracket },
    C: { lagIds: kval.C, kamper: cBracket },
  };

  await updateDoc(doc(db, TS.TURNERINGER, turneringId), {
    sluttspill,
    status:      T_STATUS.PLAYOFFS,
    kvalifisert: { A: kval.A, B: kval.B, C: kval.C },
  });

  visMelding('Sluttspill startet!');
  return sluttspill;
}

export async function registrerSluttspillResultat(turneringId, nivaa, kampId, lag1Poeng, lag2Poeng, games = null) {
  const t = await hentTurnering(turneringId);
  if (t.status !== T_STATUS.PLAYOFFS) throw new Error('Sluttspill er ikke aktivt.');

  const bracket = [...(t.sluttspill[nivaa]?.kamper ?? [])];
  const kampIdx = bracket.findIndex(k => k.id === kampId);
  if (kampIdx < 0) throw new Error('Kamp ikke funnet.');

  const kamp   = bracket[kampIdx];
  const format = hentFormatForRunde(kamp.runde, t.konfig, kamp.format ?? null);

  if (format.type === 'best_of_3' && games?.length) {
    for (let i = 0; i < games.length; i++) {
      const val = validerResultat(games[i].l1, games[i].l2, format);
      if (!val.ok) throw new Error('Game ' + (i + 1) + ': ' + val.feil);
    }
  } else {
    const val = validerResultat(lag1Poeng, lag2Poeng, format);
    if (!val.ok) throw new Error(val.feil);
  }

  const vinnerId = lag1Poeng > lag2Poeng ? kamp.lag1Id : kamp.lag2Id;
  const taperId  = lag1Poeng > lag2Poeng ? kamp.lag2Id : kamp.lag1Id;

  bracket[kampIdx] = { ...kamp, lag1Poeng, lag2Poeng, ferdig: true, vinnerId, taperId, ...(games ? { games } : {}) };

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

export async function nullstillNedstrømsKamper(turneringId, nivaa, kampId) {
  const t      = await hentTurnering(turneringId);
  const kamper = [...(t.sluttspill?.[nivaa]?.kamper ?? [])];
  const kamp   = kamper.find(k => k.id === kampId);
  if (!kamp) throw new Error('Kamp ikke funnet.');

  const nullstillIds = new Set();
  const samleNedstrøms = (id) => {
    const k = kamper.find(k => k.id === id);
    if (!k) return;
    nullstillIds.add(id);
    if (k.winner_to) samleNedstrøms(k.winner_to);
    if (k.loser_to)  samleNedstrøms(k.loser_to);
  };
  if (kamp.winner_to) samleNedstrøms(kamp.winner_to);
  if (kamp.loser_to)  samleNedstrøms(kamp.loser_to);

  const nyeKamper = kamper.map(k => {
    if (!nullstillIds.has(k.id)) return k;
    const forrigeFerdigKamp = kamper.find(fk =>
      fk.ferdig && fk.id !== kampId &&
      (fk.winner_to === k.id || fk.loser_to === k.id)
    );
    return {
      ...k,
      lag1Id:    forrigeFerdigKamp ? k.lag1Id : null,
      lag2Id:    forrigeFerdigKamp ? k.lag2Id : null,
      lag1Poeng: null,
      lag2Poeng: null,
      ferdig:    false,
      vinnerId:  null,
      taperId:   null,
    };
  });

  const redigertIdx = nyeKamper.findIndex(k => k.id === kampId);
  if (redigertIdx >= 0) {
    nyeKamper[redigertIdx] = {
      ...nyeKamper[redigertIdx],
      lag1Poeng: null, lag2Poeng: null,
      ferdig: false, vinnerId: null, taperId: null,
    };
  }

  await updateDoc(doc(db, TS.TURNERINGER, turneringId), {
    [`sluttspill.${nivaa}.kamper`]: nyeKamper,
  });
}

// ════════════════════════════════════════════════════════
// KONFIG
// ════════════════════════════════════════════════════════
export async function oppdaterTurneringKonfig(turneringId, oppdatering) {
  const t = await hentTurnering(turneringId);
  if (t.status !== T_STATUS.SETUP) throw new Error('Kan kun endre konfig i oppsettfasen.');
  const { navn, ...konfig } = oppdatering;
  const felt = { konfig: { ...t.konfig, ...konfig } };
  if (navn) felt.navn = navn;
  await updateDoc(doc(db, TS.TURNERINGER, turneringId), felt);
}

// ════════════════════════════════════════════════════════
// AVSLUTT / SLETT
// ════════════════════════════════════════════════════════
export async function avsluttTurnering(turneringId) {
  const t = await hentTurnering(turneringId);

  const rangering    = beregnEndeligRangering(t);

  const rangeringRen = rangering
    .map(r => ({ plass: r.plass, lagId: r.lag?.id ?? r.lag?.lagId ?? null, navn: r.lag?.navn ?? '?' }))
    .filter(r => r.lagId);

  await updateDoc(doc(db, TS.TURNERINGER, turneringId), {
    status:    T_STATUS.FINISHED,
    avsluttet: serverTimestamp(),
    rangering: rangeringRen,
  });
  visMelding('Turnering avsluttet!');
  return rangeringRen;
}

export async function slettTurnering(turneringId) {
  await updateDoc(doc(db, TS.TURNERINGER, turneringId), {
    status:  'slettet',
    slettet: serverTimestamp(),
  });
}
