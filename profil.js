// ════════════════════════════════════════════════════════
// profil.js — spillerprofil, ledertavle, statistikk, sesongkåring
// ════════════════════════════════════════════════════════
import {
  db, SAM, STARTRATING,
  collection, doc, getDoc, getDocs, updateDoc,
  query, where, orderBy,
  writeBatch, serverTimestamp,
} from './firebase.js';
import { app, erMix } from './state.js';
import {
  getNivaaKlasse, getNivaaLabel, getNivaaRatingHTML,
  eloForventet, beregnTrend,
} from './rating.js';
import { visMelding, visFBFeil, escHtml } from './ui.js';
import { lagInitialer } from './render-helpers.js';
import { setAktivSlettSpillerId } from './spillere.js';

// ── Avhengigheter injisert fra app.js via profilInit() ───────────────────────
let _naviger   = () => {};
let _krevAdmin = () => {};

export function profilInit(deps) {
  _naviger   = deps.naviger;
  _krevAdmin = deps.krevAdmin;
}

// ════════════════════════════════════════════════════════
// DIAGRAM-HJELPER
// ════════════════════════════════════════════════════════

/**
 * Oppretter eller oppdaterer et Chart.js linjediagram for ratingutvikling.
 * Returnerer det nye Chart-objektet. Ødelegger eksisterende diagram først.
 * @param {HTMLCanvasElement} canvas
 * @param {number[]}          data
 * @param {string[]}          etiketter
 * @param {Chart|null}        gammeltDiagram  — ødelegges om ikke-null
 * @returns {Chart}
 */
function lagRatingDiagram(canvas, data, etiketter, gammeltDiagram = null) {
  if (gammeltDiagram) { try { gammeltDiagram.destroy(); } catch (_) {} }
  return new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: etiketter,
      datasets: [{
        data,
        borderColor:           '#eab308',
        backgroundColor:       'rgba(234,179,8,0.08)',
        borderWidth:           2.5,
        pointRadius:           5,
        pointBackgroundColor:  '#eab308',
        pointBorderColor:      '#050f1f',
        pointBorderWidth:      2,
        tension:               0.35,
        fill:                  true,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 11 } } },
      },
    },
  });
}

let diagram = null;
export async function apneProfil(spillerId) {
  if (!spillerId) return;
  const s = (app.ratingEndringer ?? []).find(x => x.spillerId === spillerId);
  if (!s) return;

  document.getElementById('profil-navn').textContent   = s.navn ?? 'Ukjent';
  document.getElementById('profil-rating').textContent = s.nyRating;
  document.getElementById('profil-statistikk').innerHTML = [
    { val: '#' + s.sluttPlassering,             lbl: 'Sluttplassering', farge: 'var(--white)' },
    { val: (s.endring >= 0 ? '+' : '') + s.endring, lbl: 'Ratingendring', farge: s.endring >= 0 ? 'var(--green2)' : 'var(--red2)' },
    { val: s.ratingVedStart ?? STARTRATING,      lbl: 'Rating før',      farge: 'var(--white)' },
  ].map(b => `<div class="stat-boks">
    <div class="stat-verdi" style="color:${b.farge}">${b.val}</div>
    <div class="stat-etikett">${b.lbl}</div>
  </div>`).join('');

  // Hent ratinghistorikk — spørring filtrert på klient (unngår composite index-krav)
  let historikk = [];
  try {
    if (db) {
      const snap = await getDocs(
        query(collection(db, SAM.HISTORIKK), where('spillerId', '==', spillerId))
      );
      historikk = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.dato?.toMillis?.() ?? 0) - (b.dato?.toMillis?.() ?? 0));
    }
  } catch (e) {
    console.warn('Kunne ikke hente historikk:', e?.message ?? e);
  }

  const ratingData = historikk.length ? historikk.map(h => h.ratingEtter ?? STARTRATING) : [s.ratingVedStart ?? STARTRATING, s.nyRating];
  const etiketter  = historikk.length ? historikk.map((_, i) => 'T' + (i+1)) : ['Start', 'Nå'];

  const canvas = document.getElementById('rating-diagram');
  if (canvas) {
    diagram = lagRatingDiagram(canvas, ratingData, etiketter, diagram);
  }

  document.getElementById('trening-historikk').innerHTML = historikk.length
    ? [...historikk].reverse().map((h, i) => `
        <div class="historikk-rad">
          <div class="historikk-rad-nr">Økt ${historikk.length - i}</div>
          <div class="historikk-rad-plass">Plass #${h.plassering ?? '—'}</div>
          <div class="historikk-rad-endring ${(h.endring ?? 0) >= 0 ? 'pos' : 'neg'}">
            ${(h.endring ?? 0) >= 0 ? '+' : ''}${h.endring ?? 0}
          </div>
        </div>`).join('')
    : '<div class="tom-tilstand">Ingen historikk ennå</div>';

  _naviger('profil');
}
window.apneProfil = apneProfil;


// ════════════════════════════════════════════════════════
// GLOBAL LEDERTAVLE (Spillere-skjermen)
// ════════════════════════════════════════════════════════
export function oppdaterGlobalLedertavle() {
  const laster = document.getElementById('global-laster');
  const liste  = document.getElementById('global-ledertavle');
  if (laster) laster.style.display = 'none';
  if (liste)  liste.innerHTML = '';
  try {
    const spillere = [...(app.spillere ?? [])].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    if (!spillere.length) {
      if (liste) liste.innerHTML = '<div class="tom-tilstand">Ingen spillere registrert ennå</div>';
      return;
    }
    if (liste) {
      liste.innerHTML = spillere.map((s, i) => {
        const plass = i + 1;
        const ini   = lagInitialer(s.navn);
        const nivaaKlLB = getNivaaKlasse(s.rating ?? STARTRATING);
        return `<div class="lb-rad lb-rad-klikk ${nivaaKlLB}">
          <div class="lb-plass${plass <= 3 ? ' topp3' : ''}" onclick="apneGlobalProfil('${s.id}')">${plass}</div>
          <div class="lb-avatar" onclick="apneGlobalProfil('${s.id}')">${ini}</div>
          <div class="lb-navn" onclick="apneGlobalProfil('${s.id}')">${s.navn ?? 'Ukjent'}</div>
          <div class="lb-rad-høyre">
            ${getNivaaRatingHTML(s.rating ?? STARTRATING)}
            <button class="knapp-rediger-rating" onclick="startRedigerRating('${s.id}', ${s.rating ?? STARTRATING}, this)" title="Rediger rating" class="lb-rediger-rating">✏️</button>
          </div>
        </div>`;
      }).join('');
    }

    // Fyll sammenlign-dropdowns med alle spillere
    const optioner = spillere.map(s =>
      `<option value="${s.id}">${escHtml(s.navn ?? 'Ukjent')} (${s.rating ?? STARTRATING})</option>`
    ).join('');
    ['sammenlign-s1','sammenlign-s2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = '<option value="">— Velg spiller —</option>' + optioner;
      }
    });
    nullstillSammenligning();

    // Beregn sesongkåring asynkront — blokkerer ikke ratinglisten
    beregnSesongsKaaring(spillere);

  } catch (e) {
    visFBFeil('Kunne ikke vise ledertavle: ' + (e?.message ?? e));
  }
}
window.oppdaterGlobalLedertavle = oppdaterGlobalLedertavle;

// ════════════════════════════════════════════════════════
// SESONGKÅRING — Formspilleren og Beste partner
// ════════════════════════════════════════════════════════

// Minimum antall kamper for å telle i kåringen
const SESONG_MIN_KAMPER = 10;

let _sesongCache = null;
const SESONG_TTL_MS = 2 * 60 * 1000;

/**
 * Henter alle ferdigspilte kamper og beregner:
 *   1. Formspilleren  — høyest individuell overperformance
 *   2. Beste partner  — løfter flest lagkamerater over forventet nivå
 *
 * Overperformance per spiller per kamp:
 *   forventet = eloForventet(egetLagRating, motstanderLagRating)
 *   faktisk   = 1 (vant) | 0 (tapte) | 0.5 (uavgjort)
 *   bidrag    = faktisk - forventet
 *
 * Snitt av alle bidrag over alle kamper = overperformance-score.
 *
 * @param {Array} spillereListe  — [{ id, navn, rating }]
 */
async function beregnSesongsKaaring(spillereListe) {
  const sesongLaster = document.getElementById('sesong-laster');
  const sesongBoks   = document.getElementById('sesong-kaaring');

  if (_sesongCache && (Date.now() - _sesongCache.hentetMs) < SESONG_TTL_MS) {
    if (sesongBoks) { sesongBoks.innerHTML = _sesongCache.html; sesongBoks.style.display = 'block'; }
    if (sesongLaster) sesongLaster.style.display = 'none';
    return;
  }

  if (sesongLaster) sesongLaster.style.display = 'flex';
  if (sesongBoks)   sesongBoks.style.display   = 'none';

  try {
    // Bygg rating-kart for rask oppslag — kun spillere i denne klubben
    const ratingMap = {};
    spillereListe.forEach(s => { ratingMap[s.id] = s.rating ?? STARTRATING; });
    const klubbSpillerIds = new Set(Object.keys(ratingMap));

    // Hent alle ferdigspilte kamper — filtrer klient-side på kjente spillere.
    // kamper-dokumentene mangler klubbId-felt, så vi begrenser til kamper der
    // minst én spiller tilhører denne klubben. Dette er det korrekte resultatet
    // uten å kreve en skjema-endring i Firestore.
    const snap = await getDocs(query(
      collection(db, SAM.KAMPER),
      where('ferdig', '==', true)
    ));
    const alleKamper = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(k =>
        k.lag1Poeng != null && k.lag2Poeng != null &&
        (klubbSpillerIds.has(k.lag1_s1) || klubbSpillerIds.has(k.lag1_s2) ||
         klubbSpillerIds.has(k.lag2_s1) || klubbSpillerIds.has(k.lag2_s2))
      );

    if (alleKamper.length === 0) {
      if (sesongLaster) sesongLaster.style.display = 'none';
      return;
    }

    // ── Per spiller: akkumuler overperformance-bidrag ──
    // overMap[spillerId] = { navn, bidragSum, kamper, partnerBidrag }
    // partnerBidrag[partnerId] = { bidragSum, kamper }  ← for beste-partner-beregning
    const overMap = {};

    const sikkerId = id => id && ratingMap[id] !== undefined;

    for (const k of alleKamper) {
      const erSingel = !k.lag1_s2 && !k.lag2_s2;
      if (!sikkerId(k.lag1_s1) || !sikkerId(k.lag2_s1)) continue;
      if (!erSingel && (!sikkerId(k.lag1_s2) || !sikkerId(k.lag2_s2))) continue;

      const rA = erSingel
        ? (ratingMap[k.lag1_s1])
        : (ratingMap[k.lag1_s1] + ratingMap[k.lag1_s2]) / 2;
      const rB = erSingel
        ? (ratingMap[k.lag2_s1])
        : (ratingMap[k.lag2_s1] + ratingMap[k.lag2_s2]) / 2;

      const forventetA = eloForventet(rA, rB);
      const forventetB = 1 - forventetA;

      const faktiskA = k.lag1Poeng > k.lag2Poeng ? 1 : k.lag1Poeng < k.lag2Poeng ? 0 : 0.5;
      const faktiskB = 1 - faktiskA;

      const lag1 = [{ id: k.lag1_s1, navn: k.lag1_s1_navn }, erSingel ? null : { id: k.lag1_s2, navn: k.lag1_s2_navn }].filter(Boolean);
      const lag2 = [{ id: k.lag2_s1, navn: k.lag2_s1_navn }, erSingel ? null : { id: k.lag2_s2, navn: k.lag2_s2_navn }].filter(Boolean);

      const registrer = (lagSpillere, faktisk, forventet) => {
        lagSpillere.forEach(sp => {
          if (!sp.id) return;
          if (!overMap[sp.id]) overMap[sp.id] = { navn: sp.navn ?? 'Ukjent', bidragSum: 0, kamper: 0, partnerBidrag: {} };
          overMap[sp.id].bidragSum += (faktisk - forventet);
          overMap[sp.id].kamper++;

          // Legg til partner-bidrag for den andre spilleren på laget
          const partner = lagSpillere.find(p => p.id !== sp.id);
          if (partner?.id) {
            if (!overMap[sp.id].partnerBidrag[partner.id]) {
              overMap[sp.id].partnerBidrag[partner.id] = { navn: partner.navn ?? 'Ukjent', bidragSum: 0, kamper: 0 };
            }
            overMap[sp.id].partnerBidrag[partner.id].bidragSum += (faktisk - forventet);
            overMap[sp.id].partnerBidrag[partner.id].kamper++;
          }
        });
      };

      registrer(lag1, faktiskA, forventetA);
      registrer(lag2, faktiskB, forventetB);
    }

    // ── 1. FORMSPILLEREN — høyest snitt overperformance ──
    // Kun spillere med minst SESONG_MIN_KAMPER kamper
    const kandidaterForm = Object.entries(overMap)
      .filter(([, v]) => v.kamper >= SESONG_MIN_KAMPER)
      .map(([id, v]) => ({
        id,
        navn:          v.navn,
        kamper:        v.kamper,
        overperf:      v.bidragSum / v.kamper,  // snitt per kamp
        overperfPst:   Math.round((v.bidragSum / v.kamper) * 100),
      }))
      .sort((a, b) => b.overperf - a.overperf);

    // ── 2. BESTE PARTNER — høyest snitt overperformance
    //    på tvers av alle partnere (vektet etter antall kamper)
    const kandidaterPartner = Object.entries(overMap)
      .filter(([, v]) => v.kamper >= SESONG_MIN_KAMPER)
      .map(([id, v]) => {
        // Snitt overperformance over alle partnere med minst 2 kamper
        const partnere = Object.values(v.partnerBidrag).filter(p => p.kamper >= 2);
        if (partnere.length === 0) return null;

        // Vektet snitt: partnere med mange kamper teller mer
        const totalKamper  = partnere.reduce((s, p) => s + p.kamper, 0);
        const vektetBidrag = partnere.reduce((s, p) => s + p.bidragSum, 0);
        const snittOverperf = vektetBidrag / totalKamper;

        return {
          id,
          navn:          v.navn,
          kamper:        v.kamper,
          antallPartnere: partnere.length,
          overperf:      snittOverperf,
          overperfPst:   Math.round(snittOverperf * 100),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.overperf - a.overperf);

    // ── Vis resultater ────────────────────────────────────
    if (sesongLaster) sesongLaster.style.display = 'none';

    const ingenData = '<div class="tom-tilstand-liten">Ikke nok kampdata ennå (min. ' + SESONG_MIN_KAMPER + ' kamper per spiller)</div>';

    // Formspilleren
    const formEl = document.getElementById('sesong-formspiller');
    if (formEl) {
      if (kandidaterForm.length === 0) {
        formEl.innerHTML = ingenData;
      } else {
        formEl.innerHTML = kandidaterForm.slice(0, 3).map((s, i) => {
          const ini    = s.lagInitialer(navn);
          const farge  = s.overperfPst >= 0 ? 'var(--green2)' : 'var(--red2)';
          const tegn   = s.overperfPst >= 0 ? '+' : '';
          const kronet = i === 0;
          return `<div class="lb-rad" onclick="apneGlobalProfil('${s.id}')" style="cursor:pointer;${kronet ? 'background:rgba(234,179,8,0.04)' : ''}">
            <div class="lb-plass${kronet ? ' topp3' : ''}" style="font-size:${kronet ? '24' : '18'}px">${kronet ? '🔥' : i + 1}</div>
            <div class="lb-avatar" style="${kronet ? 'background:var(--yellow);color:#000' : ''}">${ini}</div>
            <div style="flex:1">
              <div style="font-size:${kronet ? '17' : '16'}px;font-weight:${kronet ? '600' : '400'}">${escHtml(s.navn)}</div>
              <div class="sesong-lb-kamper">${s.kamper} kamper</div>
            </div>
            <div class="sesong-lb-rad-høyre">
              <div class="sesong-lb-stat" style="color:${farge}">${tegn}${s.overperfPst}%</div>
              <div class="sesong-lb-sub">over forventet</div>
            </div>
          </div>`;
        }).join('');
      }
    }

    // Beste partner
    const partnerEl = document.getElementById('sesong-beste-partner');
    if (partnerEl) {
      if (kandidaterPartner.length === 0) {
        partnerEl.innerHTML = ingenData;
      } else {
        partnerEl.innerHTML = kandidaterPartner.slice(0, 3).map((s, i) => {
          const ini    = s.lagInitialer(navn);
          const farge  = s.overperfPst >= 0 ? 'var(--green2)' : 'var(--red2)';
          const tegn   = s.overperfPst >= 0 ? '+' : '';
          const kronet = i === 0;
          return `<div class="lb-rad" onclick="apneGlobalProfil('${s.id}')" style="cursor:pointer;${kronet ? 'background:rgba(59,130,246,0.05)' : ''}">
            <div class="lb-plass${kronet ? ' topp3' : ''}" style="font-size:${kronet ? '24' : '18'}px">${kronet ? '🤝' : i + 1}</div>
            <div class="lb-avatar" style="${kronet ? 'background:var(--accent2);color:#fff' : ''}">${ini}</div>
            <div style="flex:1">
              <div style="font-size:${kronet ? '17' : '16'}px;font-weight:${kronet ? '600' : '400'}">${escHtml(s.navn)}</div>
              <div class="sesong-lb-kamper">${s.antallPartnere} partner${s.antallPartnere === 1 ? '' : 'e'} • ${s.kamper} kamper</div>
            </div>
            <div class="sesong-lb-rad-høyre">
              <div class="sesong-lb-stat" style="color:${farge}">${tegn}${s.overperfPst}%</div>
              <div class="sesong-lb-sub">snitt løft</div>
            </div>
          </div>`;
        }).join('');
      }
    }

    if (sesongBoks) {
      sesongBoks.style.display = 'block';
      _sesongCache = { html: sesongBoks.innerHTML, hentetMs: Date.now() };
    }

  } catch (e) {
    console.warn('[Sesongkåring]', e?.message ?? e);
    if (sesongLaster) sesongLaster.style.display = 'none';
  }
}

// ════════════════════════════════════════════════════════
// SAMMENLIGN SPILLERE
// ════════════════════════════════════════════════════════

function nullstillSammenligning() {
  const s1 = document.getElementById('sammenlign-s1')?.value;
  const s2 = document.getElementById('sammenlign-s2')?.value;
  const knapp = document.getElementById('sammenlign-knapp');
  const res   = document.getElementById('sammenlign-resultat');
  if (knapp) knapp.disabled = !(s1 && s2 && s1 !== s2);
  if (res)   { res.style.display = 'none'; res.innerHTML = ''; }
}
window.nullstillSammenligning = nullstillSammenligning;

async function kjorSammenligning() {
  if (!db) return;
  const s1Id = document.getElementById('sammenlign-s1')?.value;
  const s2Id = document.getElementById('sammenlign-s2')?.value;
  if (!s1Id || !s2Id || s1Id === s2Id) return;

  const s1Navn = document.getElementById('sammenlign-s1').selectedOptions[0]?.text.split(' (')[0] ?? 'Spiller 1';
  const s2Navn = document.getElementById('sammenlign-s2').selectedOptions[0]?.text.split(' (')[0] ?? 'Spiller 2';

  const laster  = document.getElementById('sammenlign-laster');
  const resultat = document.getElementById('sammenlign-resultat');
  if (laster)   laster.style.display   = 'flex';
  if (resultat) resultat.style.display = 'none';

  try {
    // Hent alle kamper der s1 deltok (4 spørringer — én per lagfelt)
    const [a1, a2, a3, a4] = await Promise.all([
      getDocs(query(collection(db, SAM.KAMPER), where('lag1_s1', '==', s1Id), where('ferdig', '==', true))),
      getDocs(query(collection(db, SAM.KAMPER), where('lag1_s2', '==', s1Id), where('ferdig', '==', true))),
      getDocs(query(collection(db, SAM.KAMPER), where('lag2_s1', '==', s1Id), where('ferdig', '==', true))),
      getDocs(query(collection(db, SAM.KAMPER), where('lag2_s2', '==', s1Id), where('ferdig', '==', true))),
    ]);

    // Slå sammen og dedupliser
    const sett = new Map();
    for (const snap of [a1, a2, a3, a4]) {
      snap.docs.forEach(d => sett.set(d.id, { id: d.id, ...d.data() }));
    }
    const alleKamperS1 = [...sett.values()];

    // Finn kamper der BEGGE spillerne deltok
    const fellesKamper = alleKamperS1.filter(k => {
      const ids = [k.lag1_s1, k.lag1_s2, k.lag2_s1, k.lag2_s2];
      return ids.includes(s2Id);
    });

    // ── Individuelle nøkkeltall fra beregnKampStatistikk ──
    const stat1 = beregnKampStatistikk(s1Id, alleKamperS1);

    // Hent alle kamper for s2 også
    const [b1, b2, b3, b4] = await Promise.all([
      getDocs(query(collection(db, SAM.KAMPER), where('lag1_s1', '==', s2Id), where('ferdig', '==', true))),
      getDocs(query(collection(db, SAM.KAMPER), where('lag1_s2', '==', s2Id), where('ferdig', '==', true))),
      getDocs(query(collection(db, SAM.KAMPER), where('lag2_s1', '==', s2Id), where('ferdig', '==', true))),
      getDocs(query(collection(db, SAM.KAMPER), where('lag2_s2', '==', s2Id), where('ferdig', '==', true))),
    ]);
    const sett2 = new Map();
    for (const snap of [b1, b2, b3, b4]) {
      snap.docs.forEach(d => sett2.set(d.id, { id: d.id, ...d.data() }));
    }
    const alleKamperS2 = [...sett2.values()];
    const stat2 = beregnKampStatistikk(s2Id, alleKamperS2);

    // ── Analyser felles kamper ────────────────────────────
    let sammenLag = 0, sammenSeire = 0;
    let motHverandre = 0, s1VantMot = 0;

    for (const k of fellesKamper) {
      const s1PaaLag1 = k.lag1_s1 === s1Id || k.lag1_s2 === s1Id;
      const s2PaaLag1 = k.lag1_s1 === s2Id || k.lag1_s2 === s2Id;

      if (s1PaaLag1 === s2PaaLag1) {
        // Samme lag
        sammenLag++;
        const vant = s1PaaLag1 ? k.lag1Poeng > k.lag2Poeng : k.lag2Poeng > k.lag1Poeng;
        if (vant) sammenSeire++;
      } else {
        // Mot hverandre
        motHverandre++;
        const s1Vant = s1PaaLag1 ? k.lag1Poeng > k.lag2Poeng : k.lag2Poeng > k.lag1Poeng;
        if (s1Vant) s1VantMot++;
      }
    }

    // ── Bygg resultat-HTML ────────────────────────────────
    if (laster) laster.style.display = 'none';

    const ini1 = lagInitialer(s1Navn);
    const ini2 = lagInitialer(s2Navn);

    const wrFarge = (wr) => wr === null ? 'var(--muted2)' : wr >= 60 ? 'var(--green2)' : wr >= 40 ? 'var(--yellow)' : 'var(--red2)';
    const wrTekst = (wr) => wr === null ? '—' : wr + '%';

    // Sammenligningstabellen
    const rader = [
      { lbl: 'Winrate',      v1: wrTekst(stat1.winRate),  v2: wrTekst(stat2.winRate),  farge1: wrFarge(stat1.winRate),  farge2: wrFarge(stat2.winRate) },
      { lbl: 'Snittpoeng',   v1: stat1.avgPoints ?? '—',  v2: stat2.avgPoints ?? '—',  farge1: 'var(--white)',          farge2: 'var(--white)' },
      { lbl: 'Totalt kamper',v1: stat1.totalKamper,        v2: stat2.totalKamper,        farge1: 'var(--white)',          farge2: 'var(--white)' },
    ];

    let html = `
      <!-- Spillerhoder -->
      <div style="display:flex;align-items:center;gap:8px;padding:14px 16px 10px;border-bottom:1px solid var(--border)">
        <div style="flex:1;display:flex;align-items:center;gap:8px">
          <div class="lb-avatar" style="background:var(--accent)">${ini1}</div>
          <div style="font-size:16px;font-weight:600">${escHtml(s1Navn)}</div>
        </div>
        <div style="font-family:'Bebas Neue',cursive;font-size:18px;color:var(--muted)">VS</div>
        <div style="flex:1;display:flex;align-items:center;justify-content:flex-end;gap:8px">
          <div style="font-size:16px;font-weight:600;text-align:right">${escHtml(s2Navn)}</div>
          <div class="lb-avatar" style="background:var(--orange)">${ini2}</div>
        </div>
      </div>

      <!-- Nøkkeltall -->
      <div style="padding:0 16px">
        ${rader.map(r => `
          <div style="display:flex;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="flex:1;font-family:'DM Mono',monospace;font-size:17px;font-weight:600;color:${r.farge1}">${r.v1}</div>
            <div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:var(--muted2);text-align:center;flex:0 0 90px">${r.lbl}</div>
            <div style="flex:1;font-family:'DM Mono',monospace;font-size:17px;font-weight:600;color:${r.farge2};text-align:right">${r.v2}</div>
          </div>`).join('')}
      </div>`;

    // Direkte oppgjør
    if (fellesKamper.length === 0) {
      html += `<div style="padding:14px 16px;text-align:center;font-size:15px;color:var(--muted2)">
        Ingen felles kamper registrert ennå.
      </div>`;
    } else {
      html += `<div style="padding:12px 16px 4px">
        <div style="font-size:13px;text-transform:uppercase;letter-spacing:1.5px;color:var(--accent2);font-weight:600;margin-bottom:10px">Direkte oppgjør</div>`;

      if (motHverandre > 0) {
        const s2VantMot = motHverandre - s1VantMot;
        const vinnerId  = s1VantMot > s2VantMot ? s1Navn : s2VantMot > s1VantMot ? s2Navn : null;
        const fargeS1   = s1VantMot > s2VantMot ? 'var(--green2)' : s1VantMot < s2VantMot ? 'var(--red2)' : 'var(--muted2)';
        const fargeS2   = s2VantMot > s1VantMot ? 'var(--green2)' : s2VantMot < s1VantMot ? 'var(--red2)' : 'var(--muted2)';
        html += `
          <div style="display:flex;align-items:center;background:#060e1c;border-radius:12px;padding:12px 14px;margin-bottom:8px">
            <div style="flex:1;font-family:'Bebas Neue',cursive;font-size:32px;color:${fargeS1}">${s1VantMot}</div>
            <div style="font-size:13px;text-align:center;color:var(--muted2);flex:0 0 80px">${motHverandre} kamper<br>mot hverandre</div>
            <div style="flex:1;font-family:'Bebas Neue',cursive;font-size:32px;color:${fargeS2};text-align:right">${s2VantMot}</div>
          </div>
          ${vinnerId ? `<div style="text-align:center;font-size:14px;color:var(--muted2);margin-bottom:8px">🏆 ${escHtml(vinnerId)} leder det direkte oppgjøret</div>` : '<div style="text-align:center;font-size:14px;color:var(--muted2);margin-bottom:8px">Likt i det direkte oppgjøret</div>'}`;
      }

      if (sammenLag > 0) {
        const sammenWR  = Math.round((sammenSeire / sammenLag) * 100);
        const wrF = sammenWR >= 60 ? 'var(--green2)' : sammenWR >= 40 ? 'var(--yellow)' : 'var(--red2)';
        html += `
          <div style="display:flex;align-items:center;gap:12px;background:#060e1c;border-radius:12px;padding:12px 14px;margin-bottom:8px">
            <div style="font-size:22px">🤝</div>
            <div style="flex:1">
              <div style="font-size:15px;font-weight:600">Sammen som lag</div>
              <div style="font-size:13px;color:var(--muted2);margin-top:2px">${sammenLag} kamper — ${sammenSeire} seire</div>
            </div>
            <div style="font-family:'DM Mono',monospace;font-size:22px;font-weight:700;color:${wrF}">${sammenWR}%</div>
          </div>`;
      }

      html += '</div>';
    }

    if (resultat) {
      resultat.innerHTML = html;
      resultat.style.display = 'block';
    }

  } catch (e) {
    console.error('[sammenlign]', e);
    if (laster) laster.style.display = 'none';
    visFBFeil('Feil ved sammenligning: ' + (e?.message ?? e));
  }
}
window.kjorSammenligning = kjorSammenligning;

let globalDiagram = null;
async function apneGlobalProfil(spillerId) {
  if (!db || !spillerId) return;

  // Hent spillerdata
  let spiller;
  try {
    const snap = await getDoc(doc(db, SAM.SPILLERE, spillerId));
    if (!snap.exists()) { visMelding('Spiller ikke funnet.', 'feil'); return; }
    spiller = { id: snap.id, ...snap.data() };
  } catch (e) {
    visFBFeil('Kunne ikke hente spiller: ' + (e?.message ?? e));
    return;
  }

  document.getElementById('global-profil-navn').textContent = spiller.navn ?? 'Ukjent';
  // Vis rating med nivå-label under rating-hero
  const ratingEl = document.getElementById('global-profil-rating');
  if (ratingEl) ratingEl.textContent = spiller.rating ?? STARTRATING;
  // Vis nivå-label under rating-tallet
  const nLabel = getNivaaLabel(spiller.rating ?? STARTRATING);
  const nLabelEl = document.getElementById('global-profil-nivaa-label');
  if (nLabelEl) {
    nLabelEl.className = `nivaa-label ${nLabel.kl}`;
    nLabelEl.textContent = `${nLabel.ikon} ${nLabel.tekst}`;
    nLabelEl.style.display = 'inline-flex';
  }

  // Hent historikk
  let historikk = [];
  try {
    const snap = await getDocs(
      query(collection(db, SAM.HISTORIKK), where('spillerId', '==', spillerId))
    );
    historikk = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.dato?.toMillis?.() ?? 0) - (b.dato?.toMillis?.() ?? 0));
  } catch (e) {
    console.warn('Historikk ikke tilgjengelig:', e?.message ?? e);
  }

  // Statistikk-boks
  const antallTreninger = historikk.length;
  const bestePlass = historikk.length
    ? Math.min(...historikk.map(h => h.plassering ?? 999))
    : '—';
  const totalEndring = historikk.reduce((sum, h) => sum + (h.endring ?? 0), 0);

  document.getElementById('global-profil-statistikk').innerHTML = [
    { val: antallTreninger, lbl: 'Økter',     farge: 'var(--white)' },
    { val: bestePlass === 999 ? '—' : '#' + bestePlass, lbl: 'Beste plass', farge: 'var(--yellow)' },
    { val: (totalEndring >= 0 ? '+' : '') + totalEndring, lbl: 'Total Δ rating', farge: totalEndring >= 0 ? 'var(--green2)' : 'var(--red2)' },
  ].map(b => `<div class="stat-boks">
    <div class="stat-verdi" style="color:${b.farge}">${b.val}</div>
    <div class="stat-etikett">${b.lbl}</div>
  </div>`).join('');

  // Diagram
  const ratingData = historikk.length
    ? [STARTRATING, ...historikk.map(h => h.ratingEtter ?? STARTRATING)]
    : [spiller.rating ?? STARTRATING];
  const etiketter = historikk.length
    ? ['Start', ...historikk.map((_, i) => 'T' + (i+1))]
    : ['Nå'];

  const canvas = document.getElementById('global-rating-diagram');
  if (canvas) {
    globalDiagram = lagRatingDiagram(canvas, ratingData, etiketter, globalDiagram);
  }

  // Øktsoversikt
  document.getElementById('global-trening-historikk').innerHTML = historikk.length
    ? [...historikk].reverse().map((h, i) => `
        <div class="historikk-rad">
          <div class="historikk-rad-nr">Økt ${historikk.length - i}</div>
          <div class="historikk-rad-plass">Plass #${h.plassering ?? '—'}</div>
          <div class="historikk-rad-endring ${(h.endring ?? 0) >= 0 ? 'pos' : 'neg'}">
            ${(h.endring ?? 0) >= 0 ? '+' : ''}${h.endring ?? 0}
          </div>
        </div>`).join('')
    : '<div class="tom-tilstand">Ingen historikk ennå</div>';

  setAktivSlettSpillerId(spillerId);  // lagres for slett-modal

  // Nullstill kampstat-seksjonen og start lasting
  const kampStatEl = document.getElementById('global-kampstat-innhold');
  if (kampStatEl) kampStatEl.innerHTML = '<div class="kampstat-laster">Beregner statistikk…</div>';

  _naviger('global-profil');

  // Hent og vis kampstatistikk + trend asynkront — blokkerer ikke navigeringen
  hentKampStatistikk(spillerId).then(stat => {
    // historikk er allerede hentet ovenfor i samme scope — beregn trend her
    const trendData = beregnTrend(historikk);
    visKampStatistikk(stat, trendData);
  });
}
window.apneGlobalProfil = apneGlobalProfil;


// ════════════════════════════════════════════════════════
// KAMPSTATISTIKK — winrate, snittpoeng, beste partner
// ════════════════════════════════════════════════════════

// Cache: spillerId → { stat, hentetMs }
const kampStatCache = new Map();
const KAMPSTAT_TTL_MS = 5 * 60 * 1000; // 5 min TTL — ungår unødvendige Firestore-kall

/**
 * Beregner kampstatistikk for én spiller ut fra et sett med kamper.
 *
 * Kampstruktur (fra Firestore):
 *   lag1_s1, lag1_s2  — IDs på lag 1
 *   lag2_s1, lag2_s2  — IDs på lag 2
 *   lag1Poeng, lag2Poeng — poeng (null hvis ikke ferdig)
 *   ferdig: boolean
 *
 * @param {string} spillerId
 * @param {Array}  kamper   — alle ferdigspilte kamper for spilleren
 * @returns {{ winRate, avgPoints, bestPartner }}
 */
function beregnKampStatistikk(spillerId, kamper) {
  // Edge case: ingen kamper
  if (!kamper?.length) {
    return { winRate: null, avgPoints: null, bestPartner: null, form: [], totalKamper: 0 };
  }

  let seire = 0, totaltPoeng = 0, antallKamper = 0;
  const partnerMap = {};
  // Samle alle resultater kronologisk for form-beregning
  const alleResultater = [];

  for (const k of kamper) {
    if (!k.ferdig || k.lag1Poeng == null || k.lag2Poeng == null) continue;

    const erLag1 = k.lag1_s1 === spillerId || k.lag1_s2 === spillerId;
    const erLag2 = k.lag2_s1 === spillerId || k.lag2_s2 === spillerId;
    if (!erLag1 && !erLag2) continue;

    const egnePoeng       = erLag1 ? k.lag1Poeng : k.lag2Poeng;
    const motstanderPoeng = erLag1 ? k.lag2Poeng : k.lag1Poeng;
    const vant            = egnePoeng > motstanderPoeng;

    totaltPoeng += egnePoeng;
    antallKamper++;
    if (vant) seire++;

    // Lagre for form — behold tidsstempel om tilgjengelig
    alleResultater.push({ vant, dato: k.dato ?? null });

    // Partner-akkumulering
    const partnerId = erLag1
      ? (k.lag1_s1 === spillerId ? k.lag1_s2 : k.lag1_s1)
      : (k.lag2_s1 === spillerId ? k.lag2_s2 : k.lag2_s1);
    const partnerNavn = erLag1
      ? (k.lag1_s1 === spillerId ? k.lag1_s2_navn : k.lag1_s1_navn)
      : (k.lag2_s1 === spillerId ? k.lag2_s2_navn : k.lag2_s1_navn);

    if (partnerId) {
      if (!partnerMap[partnerId]) {
        partnerMap[partnerId] = { navn: partnerNavn ?? 'Ukjent', seire: 0, kamper: 0 };
      }
      partnerMap[partnerId].kamper++;
      if (vant) partnerMap[partnerId].seire++;
    }
  }

  if (antallKamper === 0) {
    return { winRate: null, avgPoints: null, bestPartner: null, form: [], totalKamper: 0 };
  }

  const winRate   = Math.round((seire / antallKamper) * 100);
  const avgPoints = Math.round((totaltPoeng / antallKamper) * 10) / 10;

  // Form: siste 5 kamper som ['W','L',...] — nyeste til venstre
  const form = alleResultater
    .slice(-5)
    .reverse()
    .map(r => r.vant ? 'W' : 'L');

  // Beste partner — høyest winrate blant partnere med minst 2 kamper
  let bestPartner = null;
  let bestWR = -1;
  for (const [id, p] of Object.entries(partnerMap)) {
    if (p.kamper < 2) continue;
    const wr = p.seire / p.kamper;
    if (wr > bestWR) {
      bestWR      = wr;
      bestPartner = { id, navn: p.navn, winRate: Math.round(wr * 100), kamper: p.kamper };
    }
  }
  // Fallback: flest kamper
  if (!bestPartner && Object.keys(partnerMap).length > 0) {
    const [id, p] = Object.entries(partnerMap).sort((a, b) => b[1].kamper - a[1].kamper)[0];
    bestPartner = { id, navn: p.navn, winRate: Math.round((p.seire / p.kamper) * 100), kamper: p.kamper };
  }

  return { winRate, avgPoints, bestPartner, form, totalKamper: antallKamper };
}

// ────────────────────────────────────────────────────────
// TREND — rating-utvikling siste 5 økter
// Leser fra historikk-arrayet (allerede hentet i apneGlobalProfil)
// ────────────────────────────────────────────────────────

/**
 * Henter kampstatistikk for en spiller — med cache.
 * Unngår Firestore-kall hvis dataene er < 5 min gamle.
 *
 * @param {string} spillerId
 * @returns {Promise<{ winRate, avgPoints, bestPartner }>}
 */
async function hentKampStatistikk(spillerId) {
  // Sjekk cache
  const cached = kampStatCache.get(spillerId);
  if (cached && (Date.now() - cached.hentetMs) < KAMPSTAT_TTL_MS) {
    return cached.stat;
  }

  // Hent fra Firestore — kun ferdigspilte kamper for denne spilleren
  // Firestore støtter ikke array-contains på flere felt, så vi søker
  // på lag1_s1 og lag2_s1 og slår sammen — henter begge halvparter.
  // Dette er to enkle where-queries uten sammensatt indeks.
  let kamper = [];
  try {
    const [s1, s2, s3, s4] = await Promise.all([
      getDocs(query(collection(db, SAM.KAMPER), where('lag1_s1', '==', spillerId), where('ferdig', '==', true))),
      getDocs(query(collection(db, SAM.KAMPER), where('lag1_s2', '==', spillerId), where('ferdig', '==', true))),
      getDocs(query(collection(db, SAM.KAMPER), where('lag2_s1', '==', spillerId), where('ferdig', '==', true))),
      getDocs(query(collection(db, SAM.KAMPER), where('lag2_s2', '==', spillerId), where('ferdig', '==', true))),
    ]);

    // Deduplisering med Set på dokument-ID
    const sett = new Map();
    for (const snap of [s1, s2, s3, s4]) {
      snap.docs.forEach(d => sett.set(d.id, { id: d.id, ...d.data() }));
    }
    kamper = [...sett.values()];
  } catch (e) {
    console.warn('[KampStat] Henting feilet:', e?.message ?? e);
    return { winRate: null, avgPoints: null, bestPartner: null };
  }

  const stat = beregnKampStatistikk(spillerId, kamper);

  // Lagre i cache
  kampStatCache.set(spillerId, { stat, hentetMs: Date.now() });

  return stat;
}

/**
 * Renderer kampstatistikk inn i global-profil-skjermen.
 * @param {{ winRate, avgPoints, bestPartner, form, totalKamper }} stat
 * @param {{ trend, change }}                                      trendData
 */
function visKampStatistikk(stat, trendData = null) {
  const el = document.getElementById('global-kampstat-innhold');
  if (!el) return;

  if (stat.winRate === null) {
    el.innerHTML = `<div class="kampstat-laster">Ingen kampdata tilgjengelig ennå</div>`;
    return;
  }

  const wrFarge = stat.winRate >= 60 ? 'var(--green2)' : stat.winRate >= 40 ? 'var(--yellow)' : 'var(--red2)';

  // ── Trend-boks ─────────────────────────────────────────
  let trendHTML = '';
  if (trendData) {
    const { trend, change } = trendData;
    const pil    = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
    const farge  = trend === 'up' ? 'var(--green2)' : trend === 'down' ? 'var(--red2)' : 'var(--muted2)';
    const tekst  = trend === 'up' ? 'Stigende form' : trend === 'down' ? 'Fallende form' : 'Stabil form';
    const antall = Math.min(5, /* historikklengde sendes ikke hit — bruk change */ 5);
    trendHTML = `
      <div class="seksjon-etikett">Trend (siste 5 økter)</div>
      <div class="trend-boks">
        <div class="trend-pil" style="color:${farge}">${pil}</div>
        <div class="trend-info">
          <div class="trend-tittel" style="color:${farge}">${tekst}</div>
          <div class="trend-sub">Basert på siste 5 økt-resultater</div>
        </div>
        <div class="trend-endring" style="color:${farge}">${change > 0 ? '+' : ''}${change}</div>
      </div>`;
  }

  // ── Form-badges ────────────────────────────────────────
  let formHTML = '';
  if (stat.form?.length) {
    // Fyll opp til 5 med tomme plasser om færre kamper
    const badges = [...stat.form];
    while (badges.length < 5) badges.push(null);
    formHTML = `
      <div class="seksjon-etikett">Form (siste kamper)</div>
      <div class="form-rekke">
        ${badges.map(r => r === null
          ? `<div class="form-badge form-badge-tom">·</div>`
          : `<div class="form-badge form-badge-${r}">${r}</div>`
        ).join('')}
        <div style="flex:1;display:flex;align-items:center;padding-left:8px;font-size:14px;color:var(--muted2)">
          ${stat.totalKamper} kamp${stat.totalKamper === 1 ? '' : 'er'} totalt
        </div>
      </div>`;
  }

  // ── Beste partner / kjemi ─────────────────────────────
  let partnerHTML = '';
  if (stat.bestPartner) {
    const ini = lagInitialer(stat.bestPartner.navn);
    const wrF = stat.bestPartner.winRate >= 60 ? 'var(--green2)' : stat.bestPartner.winRate >= 40 ? 'var(--yellow)' : 'var(--red2)';
    // Kjemi-stolpe: visuell winrate-bar
    const barBredd = Math.round(stat.bestPartner.winRate);
    partnerHTML = `
      <div class="seksjon-etikett">Beste kjemi</div>
      <div class="beste-partner-boks" style="flex-direction:column;align-items:stretch;gap:10px">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="beste-partner-avatar">${ini}</div>
          <div class="beste-partner-info">
            <div class="beste-partner-navn">${stat.bestPartner.navn}</div>
            <div class="beste-partner-stat">${stat.bestPartner.kamper} kamper sammen</div>
          </div>
          <div style="text-align:right">
            <div style="font-family:'DM Mono',monospace;font-size:22px;font-weight:700;color:${wrF}">${stat.bestPartner.winRate}%</div>
            <div style="font-size:14px;color:var(--muted2)">winrate</div>
          </div>
        </div>
        <div style="background:var(--border);border-radius:4px;height:6px;overflow:hidden">
          <div style="width:${barBredd}%;height:100%;background:${wrF};border-radius:4px;transition:width .5s"></div>
        </div>
      </div>`;
  }

  // ── Hoved-statistikk-grid ─────────────────────────────
  el.innerHTML = `
    <div class="kampstat-rutenett">
      <div class="kampstat-boks">
        <div class="kampstat-verdi" style="color:${wrFarge}">${stat.winRate}%</div>
        <div class="kampstat-etikett">Winrate</div>
      </div>
      <div class="kampstat-boks">
        <div class="kampstat-verdi" style="color:var(--white)">${stat.avgPoints}</div>
        <div class="kampstat-etikett">Snitt poeng</div>
      </div>
      <div class="kampstat-boks">
        <div class="kampstat-verdi" style="font-size:22px;color:var(--accent2)">${stat.totalKamper}</div>
        <div class="kampstat-etikett">Kamper</div>
      </div>
    </div>
    ${trendHTML}
    ${formHTML}
    ${partnerHTML}`;
}

// ════════════════════════════════════════════════════════
// NULLSTILL RATING OG HISTORIKK (admin)
// ════════════════════════════════════════════════════════
// NULLSTILL RATING OG HISTORIKK (admin)
// ════════════════════════════════════════════════════════
export function visNullstillModal() {
  _krevAdmin(
    'Nullstill rating',
    'Kun administrator kan nullstille all rating og historikk.',
    () => {
      document.getElementById('modal-nullstill').style.display = 'flex';
    }
  );
}
window.visNullstillModal = visNullstillModal;

export async function utforNullstill() {
  if (!db) { visMelding('Firebase ikke tilkoblet.', 'feil'); return; }
  document.getElementById('modal-nullstill').style.display = 'none';

  visMelding('Nullstiller… vennligst vent.', 'advarsel');

  try {
    // 1. Hent alle spillere og sett rating = 1000
    const spillerSnap = await getDocs(collection(db, SAM.SPILLERE));
    const BATCH_MAKS = 400; // Firestore batch-grense er 500 — bruker 400 for sikkerhet
    let batch = writeBatch(db);
    let teller = 0;

    for (const d of spillerSnap.docs) {
      batch.update(d.ref, { rating: STARTRATING });
      teller++;
      if (teller >= BATCH_MAKS) {
        await batch.commit();
        batch = writeBatch(db);
        teller = 0;
      }
    }
    if (teller > 0) await batch.commit();

    // 2. Slett all ratinghistorikk
    const histSnap = await getDocs(collection(db, SAM.HISTORIKK));
    batch = writeBatch(db);
    teller = 0;
    for (const d of histSnap.docs) {
      batch.delete(d.ref);
      teller++;
      if (teller >= BATCH_MAKS) {
        await batch.commit();
        batch = writeBatch(db);
        teller = 0;
      }
    }
    if (teller > 0) await batch.commit();

    // 3. Slett alle resultater
    const resSnap = await getDocs(collection(db, SAM.RESULTATER));
    batch = writeBatch(db);
    teller = 0;
    for (const d of resSnap.docs) {
      batch.delete(d.ref);
      teller++;
      if (teller >= BATCH_MAKS) {
        await batch.commit();
        batch = writeBatch(db);
        teller = 0;
      }
    }
    if (teller > 0) await batch.commit();

    // 4. Oppdater lokal spillerliste
    app.spillere = app.spillere.map(s => ({ ...s, rating: STARTRATING }));

    _sesongCache = null;
    visMelding('Rating og historikk nullstilt!');
    oppdaterGlobalLedertavle();
  } catch (e) {
    visFBFeil('Feil ved nullstilling: ' + (e?.message ?? e));
  }
}
window.utforNullstill = utforNullstill;
// ════════════════════════════════════════════════════════
// REDIGER RATING (admin)
// ════════════════════════════════════════════════════════
export function startRedigerRating(spillerId, gjeldende, knapp) {
  _krevAdmin('Rediger rating', 'Kun administrator kan endre ratingpoeng.', () => {
    // Bytt ut redigeringsknappen med et inline input-felt
    const wrapper = knapp.parentElement;
    knapp.style.display = 'none';

    const input = document.createElement('input');
    input.type        = 'text';
    input.inputMode   = 'numeric';
    input.pattern     = '[0-9]*';
    input.value       = gjeldende;
    input.maxLength   = 5;
    input.style.cssText = 'width:70px;padding:4px 8px;border-radius:6px;border:1px solid var(--accent2);background:var(--bg2);color:var(--white);font-size:15px;font-family:inherit;text-align:center';
    input.onkeydown = (e) => {
      if (e.key === 'Enter') lagreNyRating(spillerId, input, knapp);
      if (e.key === 'Escape') avbrytRedigerRating(input, knapp);
    };

    const lagreBtn = document.createElement('button');
    lagreBtn.textContent = '✓';
    lagreBtn.style.cssText = 'background:var(--green2);border:none;border-radius:6px;padding:3px 9px;color:#000;font-size:15px;cursor:pointer;font-weight:700';
    lagreBtn.onclick = () => lagreNyRating(spillerId, input, knapp);

    const avbrytBtn = document.createElement('button');
    avbrytBtn.textContent = '✕';
    avbrytBtn.style.cssText = 'background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;color:var(--muted2);font-size:13px;cursor:pointer';
    avbrytBtn.onclick = () => avbrytRedigerRating(input, knapp);

    wrapper.appendChild(input);
    wrapper.appendChild(lagreBtn);
    wrapper.appendChild(avbrytBtn);
    input.focus();
    input.select();
  });
}
window.startRedigerRating = startRedigerRating;

function avbrytRedigerRating(input, knapp) {
  input.nextSibling?.remove(); // lagreBtn
  input.nextSibling?.remove(); // avbrytBtn
  input.remove();
  knapp.style.display = '';
}

async function lagreNyRating(spillerId, input, knapp) {
  const nyRating = parseInt(input.value, 10);
  if (isNaN(nyRating) || nyRating < 1 || nyRating > 9999) {
    visMelding('Ugyldig rating — skriv inn et tall mellom 1 og 9999.', 'advarsel');
    input.focus();
    return;
  }

  try {
    await updateDoc(doc(db, SAM.SPILLERE, spillerId), { rating: nyRating });
    // Oppdater lokal tilstand umiddelbart
    const spiller = (app.spillere ?? []).find(s => s.id === spillerId);
    if (spiller) spiller.rating = nyRating;
    visMelding('Rating oppdatert ✓');
    oppdaterGlobalLedertavle();
  } catch (e) {
    visFBFeil('Kunne ikke lagre rating: ' + (e?.message ?? e));
    avbrytRedigerRating(input, knapp);
  }
}
