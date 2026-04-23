import {
  db, SAM, STARTRATING, PARTER, PARTER_5, PARTER_6_DOBBEL, PARTER_6_SINGEL,
  collection, doc, addDoc, updateDoc, getDoc, getDocs,
  query, where, orderBy, limit, serverTimestamp, writeBatch, runTransaction,
} from './firebase.js';
import { app, erMix } from './state.js';
import {
  getParter, blandArray, beregnPoengForKamp,
  fordelBaner, fordelBanerMix,
  lagMixKampoppsett, oppdaterMixStatistikk, hentMixStatistikk,
  neste6SpillerRunde,
} from './rotasjon.js';
import {
  getNivaaKlasse, getNivaaLabel, getNivaaRatingHTML,
  eloForventet, oppdaterRatingForKamp, beregnEloForOkt, beregnTrend,
} from './rating.js';
import {
  visMelding, visFBFeil, escHtml,
  lasUI, frigiUI, startFailSafe, stoppFailSafe,
  registrerNavigertHandler, registrerBeforeunload,
} from './ui.js';
import {
  krevAdmin as _krevAdminBase, pinInput, bekreftPin, lukkPinModal,
  getErAdmin, setErAdmin, nullstillAdmin, registrerPinGetter,
} from './admin.js';
import {
  lyttPaaSpillere as _lyttPaaSpillere,
  startLyttere as _startLyttere,
  stoppLyttere,
  startKampLytter as _startKampLytter,
} from './lyttere.js';
import {
  setAktivKlubbId as _setSpillereKlubbId,
  setKrevAdmin as _setSpillereKrevAdmin,
  nullstillSisteDeltakereCache,
  visSpillere,
  lastSisteDeltakere,
} from './spillere.js';
import {
  treningInit,
  startTrening, delLenke,
  visNesteRundeModal, bekreftNesteRunde,
  visAvsluttModal, avsluttTreningUI,
  nyTrening,
  gjenopprettTrening, autoAvsluttGamleTreninger,
  oppdaterAvbrytKnapp, visAvbrytOktModal, utforAvbrytOkt,
  seedDemoDataOmNødvendig,
} from './trening.js';
import {
  banerInit,
  kampStatusCache, setKampStatusCache, getKampStatusCache,
  oppdaterRundeUI, visBanerDebounced, oppdaterKampStatus, visBaner,
  apnePoenginput, navigerBane, oppdaterPoengNav,
} from './baner.js';
import {
  poengInit,
  validerInndata, autolagreKamp, lukkTastaturOgScrollTilLagre, lesOgValiderPoeng,
} from './poeng.js';
import {
  resultatInit,
  beregnSpillerstatistikk, sorterRangering,
  visRundeResultat, beregnForflytninger,
  visSluttresultat,
} from './resultat.js';
import {
  profilInit,
  apneProfil, oppdaterGlobalLedertavle,
  apneGlobalProfil,
  visNullstillModal, utforNullstill,
} from './profil.js';
import {
  arkivInit,
  lastArkiv, apneTreningsdetaljFraDom, apneTreningsdetalj,
  visSlettOktModal, utforSlettOkt,
  visSlettAlleOkterModal, utforSlettAlleOkter,
} from './arkiv.js';
// ════════════════════════════════════════════════════════
// KLUBB-KONFIGURASJON
// ════════════════════════════════════════════════════════
const KLUBBER = {
  'pickleball-jaeren': { navn: 'Pickleball Jæren', pin: '9436', demo: false },
  'fokus-pickleball':  { navn: 'Fokus Pickleball',  pin: '4350', demo: false },
  'demo':              { navn: 'Demo',               pin: null,   demo: true  },
};

// Aktiv klubb — settes av byttKlubb()
let aktivKlubbId = null;

function getAktivKlubb() {
  return aktivKlubbId ? (KLUBBER[aktivKlubbId] ?? null) : null;
}

// Admin-PIN for aktiv klubb (null = ingen PIN = demo)
function getAdminPin() {
  return getAktivKlubb()?.pin ?? null;
}

// Lokal wrapper — tilføyer demo-modus-flagget til hvert krevAdmin-kall
// slik at alle eksisterende kallsteder ikke trenger å endres.
function krevAdminMedDemo(tittel, tekst, callback) {
  _krevAdminBase(tittel, tekst, callback, !!getAktivKlubb()?.demo);
}
// Overstyr window.krevAdmin slik at inline onclick-attributter også bruker wrapperen
window.krevAdmin = krevAdminMedDemo;

function byttKlubb(klubbId) {
  if (!klubbId || !KLUBBER[klubbId]) {
    aktivKlubbId = null;
    oppdaterKlubbUI();
    return;
  }
  aktivKlubbId = klubbId;
  setErAdmin(KLUBBER[klubbId].demo); // demo-modus: alltid admin
  nullstillSisteDeltakereCache();
  _setSpillereKlubbId(klubbId);
  oppdaterKlubbUI();
  // Start opp for valgt klubb
  initEtterKlubbValg();
  visMelding('Klubb valgt: ' + KLUBBER[klubbId].navn);
}
window.byttKlubb = byttKlubb;

function oppdaterKlubbUI() {
  const klubb    = getAktivKlubb();
  const navn     = klubb?.navn ?? '';
  const erDemo   = klubb?.demo ?? false;

  // Oppdater klubbnavn i alle headere
  document.querySelectorAll('[id$="klubbnavn"], .app-name[id="oppsett-klubbnavn"]').forEach(el => {
    el.textContent = navn || 'Pickleball';
  });

  // Vis/skjul demo-info
  const demoInfo = document.getElementById('demo-info');
  if (demoInfo) demoInfo.style.display = erDemo ? 'block' : 'none';

  // Sett riktig verdi i select
  const velger = document.getElementById('klubb-velger');
  if (velger && aktivKlubbId) velger.value = aktivKlubbId;

  // Oppdater app-sub (under klubbnavnet) på oppsett-skjermen
  const appSub = document.querySelector('#skjerm-oppsett .app-sub');
  if (appSub) appSub.textContent = 'Americano' + (erDemo ? ' · Demo' : '');
}

// ── trening.js: hentTrening ──

// ── trening.js: lassTrening ──

// ── trening.js: lossTrening ──

/**
 * Bytter spillmodus basert på brukervalg i oppsett-skjermen.
 * Oppdaterer app.spillModus og justerer UI-elementer deretter.
 * @param {'konkurranse'|'mix'} modus
 */
function settSpillModus(modus) {
  app.spillModus = modus;

  // Oppdater knappestiler
  const btnKonk = document.getElementById('modus-knapp-konkurranse');
  const btnMix  = document.getElementById('modus-knapp-mix');
  if (btnKonk) btnKonk.classList.toggle('modus-aktiv', modus === 'konkurranse');
  if (btnMix)  btnMix.classList.toggle('modus-aktiv',  modus === 'mix');

  // Vis/skjul info-boks for valgt modus
  const infoKonk = document.getElementById('modus-info-konkurranse');
  const infoMix  = document.getElementById('modus-info-mix');
  if (infoKonk) infoKonk.style.display = modus === 'konkurranse' ? 'block' : 'none';
  if (infoMix)  infoMix.style.display  = modus === 'mix'         ? 'block' : 'none';

  // Oppdater spillerliste — viser/skjuler rating basert på modus
  visSpillere();
}
window.settSpillModus = settSpillModus;


// ════════════════════════════════════════════════════════
// HJEMSKJERM
// ════════════════════════════════════════════════════════

/**
 * Oppdaterer status-seksjonen på hjemskjermen basert på app-tilstand.
 * Kalles automatisk via naviger('hjem').
 */
function visHjemStatus() {
  const dot        = document.getElementById('hjem-status-dot');
  const tekst      = document.getElementById('hjem-status-tekst');
  const sub        = document.getElementById('hjem-status-sub');
  const fortsett   = document.getElementById('hjem-fortsett-knapp');
  const startKnapp = document.getElementById('hjem-start-knapp');

  const harOkt = !!app.treningId;

  if (dot) dot.classList.toggle('aktiv', harOkt);

  if (harOkt) {
    // Mix: sosial tone i status-teksten
    if (tekst) tekst.textContent = erMix() ? '🎲 Mix & Match pågår' : '🟢 Økt pågår';
    if (sub)   sub.textContent   = erMix()
      ? `Kamp ${app.runde} av ${app.maksRunder}`
      : `Runde ${app.runde} av ${app.maksRunder}`;
    if (fortsett) fortsett.style.display = 'block';
    if (startKnapp) startKnapp.textContent = 'START NY ØKT';
  } else {
    if (tekst) tekst.textContent = 'Ingen aktiv økt';
    if (sub)   sub.textContent   = '';
    if (fortsett) fortsett.style.display = 'none';
    if (startKnapp) startKnapp.textContent = 'START NY ØKT';
  }
}
window.visHjemStatus = visHjemStatus;

/**
 * Sett logo-bilde på hjemskjermen.
 * Kall denne med filsti etter at logoen er tilgjengelig.
 * Eksempel: settHjemLogo('/logo.png')
 */
function settHjemLogo(src) {
  const img = document.getElementById('hjem-logo-img');
  if (img) img.src = src;
}
window.settHjemLogo = settHjemLogo;

// ════════════════════════════════════════════════════════
// OPPSETT — TRINNVELGERE
// ════════════════════════════════════════════════════════
function juster(key, dir) {
  if (key === 'baner')  app.antallBaner  = Math.max(1, Math.min(7,  app.antallBaner  + dir));
  if (key === 'poeng')  app.poengPerKamp = Math.max(5, Math.min(50, app.poengPerKamp + dir));
  if (key === 'runder') app.maksRunder   = Math.max(1, Math.min(10, app.maksRunder   + dir));
  document.getElementById('verdi-baner').textContent  = app.antallBaner;
  document.getElementById('verdi-poeng').textContent  = app.poengPerKamp;
  document.getElementById('verdi-runder').textContent = app.maksRunder;
  document.getElementById('maks-hint').textContent    = app.poengPerKamp;
  visSpillere(); // visSpillere oppdaterer spiller-info og min-antall dynamisk
}
window.juster = juster;

// ════════════════════════════════════════════════════════
// SPILLERLISTE — delegerer til lyttere.js
// ════════════════════════════════════════════════════════
function lyttPaaSpillere() {
  _lyttPaaSpillere(aktivKlubbId, {
    onSpillere: () => {
      visSpillere();
      if (!_sisteDeltakereApen) {
        _sisteDeltakereApen = true;
        const panel = document.getElementById('siste-deltakere-panel');
        const pil   = document.getElementById('siste-deltakere-pil');
        if (panel) panel.style.display = 'block';
        if (pil)   pil.style.transform = 'rotate(180deg)';
        lastSisteDeltakere();
      }
    },
  });
}


// ── spillere.js: lagSpillerHTML, _beregnSpillerStatus, _oppdaterSpillerTellere,
//                siste-deltakere, visSpillere, veksleSpiller, leggTilSpiller ──

// ── trening.js: startTrening, delLenke, skrivKamper, skrivMixKamper ──
// ════════════════════════════════════════════════════════
function _lyttereCallbacks() {
  return {
    onOktOppdatert:    ()  => { oppdaterRundeUI(); visBanerDebounced(); },
    onNyRunde:         ()  => naviger('baner'),
    onOktAvsluttet:    ()  => naviger('slutt'),
    onKamper:          (k) => oppdaterKampStatus(k),
    onKampStatusReset: ()  => setKampStatusCache({}),
  };
}

function startKampLytter() {
  _startKampLytter(_lyttereCallbacks());
}

function startLyttere() {
  _startLyttere(_lyttereCallbacks());
}

// ════════════════════════════════════════════════════════
// RUNDE-UI
// ════════════════════════════════════════════════════════
// ── baner.js: oppdaterRundeUI ──

// ── baner.js: kampStatusCache, visBanerDebounced, oppdaterKampStatus, visBaner, apnePoenginput ──

// ── baner.js: navigerBane, oppdaterPoengNav ──


// ── poeng.js: validerInndata, settKampStatus, hentKampDokId, autolagreKamp, lukkTastaturOgScrollTilLagre ──

// ── poeng.js: lesOgValiderPoeng ──

// ════════════════════════════════════════════════════════
// NESTE RUNDE + FORFLYTNING
// ════════════════════════════════════════════════════════
// ── trening.js: visNesteRundeModal ──

// ── resultat.js: beregnSpillerstatistikk, sorterRangering, visRundeResultat,
//                beregnForflytninger, visSluttresultat, visKonkurranseSluttresultat, visMixSluttresultat ──
// ════════════════════════════════════════════════════════
// ── profil.js: apneProfil, oppdaterGlobalLedertavle, beregnSesongsKaaring,
//                sammenlign, apneGlobalProfil, kampstatistikk ──
// ════════════════════════════════════════════════════════
// ── profil.js: visNullstillModal ──

// ── profil.js: utforNullstill ──

// ════════════════════════════════════════════════════════
// SLETT ALLE SPILLERE (admin)
// ════════════════════════════════════════════════════════
// ── spillere.js: visSlettAlleSpillereModal, utforSlettAlleSpillere ──


// ── spillere.js: aktivSlettSpillerId, visSlettSpillerModal, utforSlettSpiller ──

// ════════════════════════════════════════════════════════
// ØKTARKIV
// ════════════════════════════════════════════════════════// ── arkiv.js: lastArkiv, apneTreningsdetalj, slettOkt, slettAlleOkter ──

// ── trening.js: nyTrening ──


// ── trening.js: autoAvsluttGamleTreninger ──

// ── trening.js: gjenopprettTrening ──


// ── trening.js: seedDemoDataOmNødvendig ──


// ── trening.js: oppdaterAvbrytKnapp, visAvbrytOktModal, utforAvbrytOkt ──

async function init() {
  // Koble admin.js til app-spesifikk PIN-logikk
  registrerPinGetter(() => getAdminPin() ?? '');
  _setSpillereKrevAdmin(krevAdminMedDemo);

  // Koble profil.js
  profilInit({
    naviger:   naviger,
    krevAdmin: krevAdminMedDemo,
  });

  // Koble arkiv.js
  arkivInit({
    naviger:         naviger,
    krevAdmin:       krevAdminMedDemo,
    getAktivKlubbId: () => aktivKlubbId,
  });

  // Koble resultat.js
  resultatInit({
    naviger:           naviger,
    krevAdmin:         krevAdminMedDemo,
    visAvsluttModal:   visAvsluttModal,
    bekreftNesteRunde: bekreftNesteRunde,
  });

  // Koble poeng.js
  poengInit({
    oppdaterPoengNav: oppdaterPoengNav,
  });

  // Koble baner.js
  banerInit({
    naviger:              naviger,
    oppdaterAvbrytKnapp:  oppdaterAvbrytKnapp,
  });

  // Koble trening.js
  treningInit({
    getAktivKlubbId:        () => aktivKlubbId,
    krevAdmin:              krevAdminMedDemo,
    getKampStatusCache:     getKampStatusCache,
    setKampStatusCache:     setKampStatusCache,
    startLyttere:           startLyttere,
    stoppLyttere:           stoppLyttere,
    startKampLytter:        startKampLytter,
    oppdaterRundeUI:        oppdaterRundeUI,
    naviger:                naviger,
    visSpillere:            visSpillere,
    toggleSisteDeltakere:   toggleSisteDeltakere,
    getSisteDeltakereApen:  () => _sisteDeltakereApen,
    setSisteDeltakereCache: (v) => { _sisteDeltakereCache = v; },
  });

  // Koble ui.js til app-spesifikk logikk
  registrerNavigertHandler(skjerm => {
    if (skjerm === 'baner')    visBaner();
    if (skjerm === 'slutt')    visSluttresultat();
    if (skjerm === 'spillere') oppdaterGlobalLedertavle();
    if (skjerm === 'arkiv')    lastArkiv();
    if (skjerm === 'hjem')     visHjemStatus();
  });
  registrerBeforeunload(() => !!app.treningId);

  if (!db) {
    visFBFeil('Firebase er ikke konfigurert. Oppdater FB_CONFIG øverst i skriptet.');
    return;
  }

  // Vis hjemskjerm alltid ved oppstart — bruker velger klubb der
  naviger('hjem');
  return;
}

async function initEtterKlubbValg() {
  if (!db || !aktivKlubbId) return;

  // Seed demo-data om nødvendig (kjører kun for demo-klubben og kun én gang)
  await seedDemoDataOmNødvendig();

  lyttPaaSpillere();

  // Kjør auto-avslutning stille i bakgrunnen — blokkerer ikke oppstarten
  autoAvsluttGamleTreninger();

  try {
    // Steg 0: sjekk URL-parameter ?okt= (delt lenke)
    const urlParams = new URLSearchParams(location.search);
    const urlOktId = urlParams.get('okt');
    if (urlOktId) {
      const ok = await gjenopprettTrening(urlOktId);
      if (ok) { visMelding('Koblet til økt!'); return; }
      // Ugyldig/gammel økt-ID i URL — fortsett normalt
      try { history.replaceState(null, '', location.pathname); } catch (_) {}
    }

    // Steg 1: prøv sessionStorage (raskest — unngår unødvendig Firestore-kall)
    const lagretId = sessionStorage.getItem('aktivTreningId');
    if (lagretId) {
      const ok = await gjenopprettTrening(lagretId);
      if (ok) { visMelding('Økt gjenopprettet'); return; }
      sessionStorage.removeItem('aktivTreningId');
    }

    // Steg 2: søk i Firestore etter nyeste aktive økt
    // (fanger opp tilfeller der sessionStorage er tom — ny fane, annen enhet, osv.)
    // Merk: ingen orderBy her — unngår krav om sammensatt Firestore-indeks.
    // Det skal aldri være mer enn én aktiv økt av gangen.
    const aktivSnap = await getDocs(
      query(
        collection(db, SAM.TRENINGER),
        where('status', '==', 'aktiv'),
        where('klubbId', '==', aktivKlubbId),
        limit(1)
      )
    );

    if (!aktivSnap.empty) {
      const treningId = aktivSnap.docs[0].id;
      const ok = await gjenopprettTrening(treningId);
      if (ok) { visMelding('Økt gjenopprettet'); return; }
      // Økt finnes men ble avvist (for gammel) — meldingen er allerede vist
    }
  } catch (e) {
    console.warn('Gjenoppretting feilet:', e?.message ?? e);
    sessionStorage.removeItem('aktivTreningId');
    visMelding('Kunne ikke gjenopprette økt: ' + (e?.message ?? 'ukjent feil'), 'feil');
  }

  // Ingen aktiv økt funnet — vis baneoversikt (vi er allerede på hjem)
  try { history.replaceState(null, '', location.pathname); } catch (_) {}
}

init();

// Når bruker kommer tilbake til appen etter å ha hatt den i bakgrunnen,
// sjekk om runden har endret seg eller økten er avsluttet.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (!db || !app.treningId) return;
  try {
    const snap = await getDoc(doc(db, SAM.TRENINGER, app.treningId));
    if (!snap.exists()) return;
    const data = snap.data() ?? {};

    // Økt avsluttet av admin mens bruker var borte
    if (data.status === 'avsluttet') {
      if (app.treningId) sessionStorage.setItem('aktivTreningId', app.treningId);
      stoppLyttere();
      naviger('slutt');
      return;
    }

    // Ny runde startet av admin mens bruker var borte
    const nyRunde = data.gjeldendRunde ?? app.runde;
    if (nyRunde > app.runde) {
      app.runde = nyRunde;
      oppdaterRundeUI();
      startKampLytter();
      visBanerDebounced();
      naviger('baner');
    }
  } catch (_) {}
});
