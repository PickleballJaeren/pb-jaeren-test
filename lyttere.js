// ════════════════════════════════════════════════════════
// lyttere.js — alle onSnapshot-abonnementer
// ════════════════════════════════════════════════════════
import {
  db, SAM,
  collection, doc, getDoc,
  query, where, orderBy, onSnapshot,
} from './firebase.js';
import { app } from './state.js';
import { visFBFeil } from './ui.js';

// ── Interne referanser til avmeldingsfunksjoner ──────────
let spillerLytterAvmeld = null;
let kampLytterAvmeld    = null;

// ════════════════════════════════════════════════════════
// SPILLER-LYTTER
// Kalles fra app.js etter klubbvalg.
// callbacks: { onSpillere(spillere) }
// ════════════════════════════════════════════════════════
export function lyttPaaSpillere(aktivKlubbId, callbacks = {}) {
  if (!db) return;
  if (!aktivKlubbId) {
    app.spillere = [];
    callbacks.onSpillere?.([]);
    return;
  }
  if (spillerLytterAvmeld) { try { spillerLytterAvmeld(); } catch (_) {} }
  document.getElementById('spiller-laster').style.display = 'flex';

  spillerLytterAvmeld = onSnapshot(
    query(collection(db, SAM.SPILLERE), where('klubbId', '==', aktivKlubbId), orderBy('rating', 'desc')),
    (snap) => {
      document.getElementById('spiller-laster').style.display = 'none';
      app.spillere = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callbacks.onSpillere?.(app.spillere);
    },
    (feil) => {
      document.getElementById('spiller-laster').style.display = 'none';
      visFBFeil('Feil ved lasting av spillere: ' + (feil?.message ?? feil));
    }
  );

  return spillerLytterAvmeld;
}

// ════════════════════════════════════════════════════════
// KAMP-LYTTER
// Separat slik at den kan restartes ved ny runde.
// callbacks: { onKamper(kamper), onKampStatusReset() }
// ════════════════════════════════════════════════════════
export function startKampLytter(callbacks = {}) {
  if (!db || !app.treningId) return;
  if (kampLytterAvmeld) { try { kampLytterAvmeld(); } catch (_) {} kampLytterAvmeld = null; }

  callbacks.onKampStatusReset?.();

  kampLytterAvmeld = onSnapshot(
    query(
      collection(db, SAM.KAMPER),
      where('treningId', '==', app.treningId),
      where('rundeNr',   '==', app.runde),
    ),
    snap => {
      callbacks.onKamper?.(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    },
    feil => visFBFeil('Lyttefeil (kamper): ' + (feil?.message ?? feil))
  );

  return kampLytterAvmeld;
}

// ════════════════════════════════════════════════════════
// ØKT-LYTTER + KAMP-LYTTER
// callbacks: {
//   onOktOppdatert(data),
//   onNyRunde(),
//   onOktAvsluttet(),
//   onKamper(kamper),
//   onKampStatusReset(),
// }
// ════════════════════════════════════════════════════════
export function startLyttere(callbacks = {}) {
  if (!db || !app.treningId) return;

  const l1 = onSnapshot(
    doc(db, SAM.TRENINGER, app.treningId),
    snap => {
      if (!snap.exists()) return;
      const data = snap.data() ?? {};
      const forrigeRunde = app.runde;

      app.runde        = data.gjeldendRunde ?? app.runde;
      app.baneOversikt = data.baneOversikt  ?? [];
      app.venteliste   = data.venteliste    ?? [];

      callbacks.onOktOppdatert?.(data);

      // Økt avsluttet av admin — naviger alle til sluttresultat
      if (data.status === 'avsluttet') {
        if (app.treningId) sessionStorage.setItem('aktivTreningId', app.treningId);
        stoppLyttere();
        callbacks.onOktAvsluttet?.();
        return;
      }

      // Admin har satt skjermStatus — håndteres nå av skjermSync-lytteren

      // Ny runde startet av admin — restart kamp-lytter og naviger til baneoversikten
      if (app.runde > forrigeRunde && forrigeRunde !== 0) {
        startKampLytter(callbacks);
        callbacks.onNyRunde?.();
      }
    },
    feil => visFBFeil('Lyttefeil (økt): ' + (feil?.message ?? feil))
  );

  app.lyttere.push(l1);
  startKampLytter(callbacks);  // start kamp-lytter for gjeldende runde
}

// ════════════════════════════════════════════════════════
// SKJERMSYNC-LYTTER — separat dokument for skjermsynkronisering
// Unngår konflikter med låsemekanismen i treningsdokumentet.
// ════════════════════════════════════════════════════════
let skjermSyncLytterAvmeld = null;

export function startSkjermSyncLytter(treningId, callbacks = {}) {
  if (!db || !treningId) return;
  stoppSkjermSyncLytter();

  // ts er et klient-generert tall (Date.now()) — ikke serverTimestamp
  // Dette unngår null-problematikken og er trygt for sammenligning
  let sisteTs = Date.now(); // ignorer hendelser fra før vi startet lytteren

  skjermSyncLytterAvmeld = onSnapshot(
    doc(db, SAM.SKJERMSYNC, treningId),
    snap => {
      if (!snap.exists()) return;
      const data = snap.data() ?? {};
      const ts   = data.ts ?? 0;
      if (ts <= sisteTs) return;
      sisteTs = ts;

      if (data.status === 'resultat') callbacks.onVisRundeResultat?.();
      else if (data.status === 'slutt')   callbacks.onVisResultater?.();
      else if (data.status === 'baner')   callbacks.onNyRunde?.();
    },
    feil => console.warn('[skjermSync] Lyttefeil:', feil?.message)
  );
}

export function stoppSkjermSyncLytter() {
  if (skjermSyncLytterAvmeld) { try { skjermSyncLytterAvmeld(); } catch (_) {} skjermSyncLytterAvmeld = null; }
}

export function stoppLyttere() {
  app.lyttere.forEach(l => { try { l(); } catch (_) {} });
  app.lyttere = [];
  if (kampLytterAvmeld) { try { kampLytterAvmeld(); } catch (_) {} kampLytterAvmeld = null; }
}
