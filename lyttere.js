// ════════════════════════════════════════════════════════
// lyttere.js — alle onSnapshot-abonnementer
// ════════════════════════════════════════════════════════
import {
  db, SAM,
  collection, doc,
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

  // Nullstill lokal skjerm-tilstand ved oppstart
  app._adminSkjerm = 'baner';

  const l1 = onSnapshot(
    doc(db, SAM.TRENINGER, app.treningId),
    snap => {
      if (!snap.exists()) return;
      const data = snap.data() ?? {};

      // Les forrige runde FRA FIRESTORE — ikke fra app.runde som kan være utdatert
      const forrigeRunde   = app._forrigeFirestoreRunde ?? data.gjeldendRunde ?? 1;
      const nyRunde        = data.gjeldendRunde ?? forrigeRunde;

      console.log('[Lytter-runde] _forrigeFirestoreRunde:', app._forrigeFirestoreRunde, '| data.gjeldendRunde:', data.gjeldendRunde, '| forrigeRunde:', forrigeRunde, '| nyRunde:', nyRunde);

      app._forrigeFirestoreRunde = nyRunde;

      app.runde        = nyRunde;
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

      // Ny runde startet av admin — restart kamp-lytter og naviger til baneoversikten
      if (app.runde > forrigeRunde && forrigeRunde !== 0) {
        startKampLytter(callbacks);
        callbacks.onNyRunde?.();
        return;
      }

      // Synkroniser deltakere til admin sin skjerm
      const adminSkjerm     = data.adminSkjerm ?? 'baner';
      const forrigeSkjerm   = app._adminSkjerm ?? 'baner';
      app._adminSkjerm      = adminSkjerm;

      console.log('[Lytter] adminSkjerm:', adminSkjerm, '| forrige:', forrigeSkjerm, '| runde:', app.runde, '| forrigeRunde:', forrigeRunde);

      if (adminSkjerm === 'resultat' && forrigeSkjerm !== 'resultat' && forrigeRunde !== 0) {
        console.log('[Lytter] → onVisRundeResultat trigges');
        callbacks.onVisRundeResultat?.();
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

export function stoppLyttere() {
  app.lyttere.forEach(l => { try { l(); } catch (_) {} });
  app.lyttere = [];
  if (kampLytterAvmeld) { try { kampLytterAvmeld(); } catch (_) {} kampLytterAvmeld = null; }
}
