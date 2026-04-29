// ════════════════════════════════════════════════════════
// profil.js — spillerprofil, ledertavle, statistikk, sesongkåring
// ════════════════════════════════════════════════════════
import {
  db, SAM, STARTRATING,
  collection, doc, addDoc, getDoc, getDocs, updateDoc,
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
let _naviger         = () => {};
let _krevAdmin       = () => {};
let _getAktivKlubbId = () => null;
let _getAktivSpillerId = () => null;

export function profilInit(deps) {
  _naviger           = deps.naviger;
  _krevAdmin         = deps.krevAdmin;
  _getAktivKlubbId   = deps.getAktivKlubbId   ?? (() => null);
  _getAktivSpillerId = deps.getAktivSpillerId ?? (() => null);
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
          <div style="flex:1">Økt ${historikk.length - i}</div>
          <div style="font-family:'DM Mono',monospace;font-size:14px;color:var(--muted2);margin-right:8px">Plass #${h.plassering ?? '—'}</div>
          <div style="font-family:'DM Mono',monospace;font-size:16px;font-weight:600;color:${(h.endring ?? 0) >= 0 ? 'var(--green2)' : 'var(--red2)'}">
            ${(h.endring ?? 0) >= 0 ? '+' : ''}${h.endring ?? 0}
          </div>
        </div>`).join('')
    : '<div style="padding:16px;text-align:center;font-size:16px;color:var(--muted2)">Ingen historikk ennå</div>';

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
      if (liste) liste.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted2);font-size:16px">Ingen spillere registrert ennå</div>';
      return;
    }
    if (liste) {
      liste.innerHTML = spillere.map((s, i) => {
        const plass = i + 1;
        const ini   = lagInitialer(s.navn);
        const nivaaKlLB = getNivaaKlasse(s.rating ?? STARTRATING);
        return `<div class="lb-rad ${nivaaKlLB}" style="cursor:pointer">
          <div class="lb-plass${plass <= 3 ? ' topp3' : ''}" onclick="apneGlobalProfil('${s.id}')">${plass}</div>
          <div class="lb-avatar" onclick="apneGlobalProfil('${s.id}')">${ini}</div>
          <div class="lb-navn" onclick="apneGlobalProfil('${s.id}')">${s.navn ?? 'Ukjent'}</div>
          <div style="text-align:right;flex-shrink:0;display:flex;align-items:center;gap:8px">
            ${getNivaaRatingHTML(s.rating ?? STARTRATING)}
            <button class="knapp-rediger-rating" onclick="startRedigerRating('${s.id}', ${s.rating ?? STARTRATING}, this)" title="Rediger rating" style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;color:var(--muted2);font-size:13px;cursor:pointer">✏️</button>
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

    const ingenData = '<div style="padding:10px 0;font-size:15px;color:var(--muted2)">Ikke nok kampdata ennå (min. ' + SESONG_MIN_KAMPER + ' kamper per spiller)</div>';

    // Formspilleren
    const formEl = document.getElementById('sesong-formspiller');
    if (formEl) {
      if (kandidaterForm.length === 0) {
        formEl.innerHTML = ingenData;
      } else {
        formEl.innerHTML = kandidaterForm.slice(0, 3).map((s, i) => {
          const ini    = lagInitialer(s.navn);
          const farge  = s.overperfPst >= 0 ? 'var(--green2)' : 'var(--red2)';
          const tegn   = s.overperfPst >= 0 ? '+' : '';
          const kronet = i === 0;
          return `<div class="lb-rad" onclick="apneGlobalProfil('${s.id}')" style="cursor:pointer;${kronet ? 'background:rgba(234,179,8,0.04)' : ''}">
            <div class="lb-plass${kronet ? ' topp3' : ''}" style="font-size:${kronet ? '24' : '18'}px">${kronet ? '🔥' : i + 1}</div>
            <div class="lb-avatar" style="${kronet ? 'background:var(--yellow);color:#000' : ''}">${ini}</div>
            <div style="flex:1">
              <div style="font-size:${kronet ? '17' : '16'}px;font-weight:${kronet ? '600' : '400'}">${escHtml(s.navn)}</div>
              <div style="font-size:13px;color:var(--muted2);margin-top:2px">${s.kamper} kamper</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-family:'DM Mono',monospace;font-size:18px;font-weight:700;color:${farge}">${tegn}${s.overperfPst}%</div>
              <div style="font-size:12px;color:var(--muted2)">over forventet</div>
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
          const ini    = lagInitialer(s.navn);
          const farge  = s.overperfPst >= 0 ? 'var(--green2)' : 'var(--red2)';
          const tegn   = s.overperfPst >= 0 ? '+' : '';
          const kronet = i === 0;
          return `<div class="lb-rad" onclick="apneGlobalProfil('${s.id}')" style="cursor:pointer;${kronet ? 'background:rgba(59,130,246,0.05)' : ''}">
            <div class="lb-plass${kronet ? ' topp3' : ''}" style="font-size:${kronet ? '24' : '18'}px">${kronet ? '🤝' : i + 1}</div>
            <div class="lb-avatar" style="${kronet ? 'background:var(--accent2);color:#fff' : ''}">${ini}</div>
            <div style="flex:1">
              <div style="font-size:${kronet ? '17' : '16'}px;font-weight:${kronet ? '600' : '400'}">${escHtml(s.navn)}</div>
              <div style="font-size:13px;color:var(--muted2);margin-top:2px">${s.antallPartnere} partner${s.antallPartnere === 1 ? '' : 'e'} • ${s.kamper} kamper</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-family:'DM Mono',monospace;font-size:18px;font-weight:700;color:${farge}">${tegn}${s.overperfPst}%</div>
              <div style="font-size:12px;color:var(--muted2)">snitt løft</div>
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
          <div style="flex:1">Økt ${historikk.length - i}</div>
          <div style="font-family:'DM Mono',monospace;font-size:14px;color:var(--muted2);margin-right:8px">Plass #${h.plassering ?? '—'}</div>
          <div style="font-family:'DM Mono',monospace;font-size:16px;font-weight:600;color:${(h.endring ?? 0) >= 0 ? 'var(--green2)' : 'var(--red2)'}">
            ${(h.endring ?? 0) >= 0 ? '+' : ''}${h.endring ?? 0}
          </div>
        </div>`).join('')
    : '<div style="padding:16px;text-align:center;font-size:16px;color:var(--muted2)">Ingen historikk ennå</div>';

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

// ════════════════════════════════════════════════════════
// UTFORDRERMODUSEN — konstanter
// ════════════════════════════════════════════════════════
const UTF_RATING_VINDU    = 100;   // maks ratingdiff for å utfordre
const UTF_MIN_SINGEL_KAMPER = 3;   // min singelkamper før singelrating brukes som grunnlag
const UTF_UTLOP_DAGER     = 14;    // utfordring utløper etter X dager
const UTF_COOLDOWN_DAGER  = 7;     // cooldown mot samme person
const UTF_K_FAKTOR        = 32;    // høyere K enn vanlig Americano (20)
const UTF_OPPRYKK_BONUS   = 1.3;   // ratingbonus ved seier mot høyere rangert
const UTF_STATUS = {
  VENTER:   'venter',    // sendt, ikke besvart
  AKSEPTERT:'akseptert', // akseptert, ikke ferdigspilt
  FERDIG:   'ferdig',    // alle games spilt
  AVVIST:   'avvist',    // avslått av mottaker
  UTLOPT:   'utlopt',    // utløpt uten svar
};

// ════════════════════════════════════════════════════════
// UTFORDRER-BADGE OG TOAST VED OPPSTART
// ════════════════════════════════════════════════════════

/**
 * Sjekker om innlogget spiller har ventende utfordringer.
 * Oppdaterer badge på nav-knappen og viser toast ved oppstart.
 * Kalles fra app.js etter at spillere er lastet.
 */
export async function sjekkVentendeUtfordringer() {
  const spillerId = sessionStorage.getItem('aktivSpillerId');
  const klubbId   = _getAktivKlubbId();
  const badge     = document.getElementById('utf-badge');
  if (!spillerId || !klubbId || !db || !badge) return;

  try {
    // Hent utfordringer der spilleren er motstander og status er 'venter'
    const snap = await getDocs(query(
      collection(db, SAM.UTFORDRINGER),
      where('motstanderId', '==', spillerId),
      where('klubbId',      '==', klubbId),
      where('status',       '==', UTF_STATUS.VENTER),
    ));

    // Filtrer ut utløpte lokalt
    const ventende = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => _dagerSiden(u.opprettet) <= UTF_UTLOP_DAGER);

    const antall = ventende.length;

    // Oppdater badge
    if (antall > 0) {
      badge.textContent    = antall > 9 ? '9+' : String(antall);
      badge.style.display  = 'flex';
    } else {
      badge.style.display  = 'none';
    }

    // Toast ved oppstart — kun om appen nettopp ble lastet (ikke ved navigering)
    if (antall > 0 && !sessionStorage.getItem('utf-toast-vist')) {
      sessionStorage.setItem('utf-toast-vist', '1');
      const navn = ventende[0]?.utfordrerNavn ?? 'Noen';
      const tekst = antall === 1
        ? `⚔️ ${navn} har utfordret deg!`
        : `⚔️ Du har ${antall} nye utfordringer!`;
      setTimeout(() => visMelding(tekst, 'ok'), 1200);
    }

    // Sjekk om egne utfordringer er avvist — varsle utfordreren
    if (!sessionStorage.getItem('utf-avvist-toast-vist')) {
      const avvistSnap = await getDocs(query(
        collection(db, SAM.UTFORDRINGER),
        where('utfordrerIds', '==', spillerId),
        where('klubbId',      '==', klubbId),
        where('status',       '==', UTF_STATUS.AVVIST),
      ));
      const nyligAvvist = avvistSnap.docs
        .map(d => d.data())
        .filter(u => _dagerSiden(u.avsluttet) < 1); // siste 24 timer
      if (nyligAvvist.length > 0) {
        sessionStorage.setItem('utf-avvist-toast-vist', '1');
        const motNavn = nyligAvvist[0]?.motstanderNavn ?? 'motstanderen';
        setTimeout(() => visMelding(`${motNavn} avslo utfordringen din. <span style="font-size:2em">🐥</span>`, 'advarsel'), 1500);
      }
    }
  } catch (e) {
    console.warn('[Utfordring] Badge-sjekk feilet:', e?.message);
  }
}

/**
 * Skjuler badge — kalles når spilleren åpner spillerskjermen
 * og har sett utfordringene sine.
 */
export function nullstillUtfordringBadge() {
  const badge = document.getElementById('utf-badge');
  if (badge) badge.style.display = 'none';
  sessionStorage.removeItem('utf-toast-vist');
}
window.nullstillUtfordringBadge = nullstillUtfordringBadge;
window.visUtfordrerSkjerm = visUtfordrerSkjerm;
window.toggleSingelRanking = function() {
  const wrapper  = document.getElementById('utf-singel-wrapper');
  const chevron  = document.getElementById('utf-singel-chevron');
  if (!wrapper) return;
  const erApen = wrapper.style.display !== 'none';
  wrapper.style.display  = erApen ? 'none' : 'block';
  if (chevron) chevron.style.transform = erApen ? '' : 'rotate(90deg)';
};

// ════════════════════════════════════════════════════════
// UTFORDRER-SKJERM — populerer hele skjermen med live data
// ════════════════════════════════════════════════════════

export async function visUtfordrerSkjerm() {
  const klubbId  = _getAktivKlubbId();
  const spillere = [...(window._app?.spillere ?? [])].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

  // ── Fyll meg-velger og mot-velger ──────────────────────
  const lagretId  = sessionStorage.getItem('aktivSpillerId');
  const megVelger = document.getElementById('utf-meg-velger');

  if (megVelger) {
    megVelger.innerHTML = '<option value="">— Velg deg selv —</option>' +
      spillere.map(s =>
        `<option value="${s.id}" ${s.id === lagretId ? 'selected' : ''}>${escHtml(s.navn ?? 'Ukjent')}</option>`
      ).join('');
    if (megVelger.value) sessionStorage.setItem('aktivSpillerId', megVelger.value);
  }

  _oppdaterMotstanderVelger(spillere, sessionStorage.getItem('aktivSpillerId'));

  // ── Hent alle data parallelt ───────────────────────────
  _visSingelRanking(spillere);
  await Promise.all([
    _lastAktiveUtfordringer(klubbId, spillere),
    _lastSisteResultater(klubbId, spillere),
  ]);
}

/** Oppdaterer mot-velgeren basert på hvem som er valgt som "meg". */
window.oppdaterUtfordrerVelger = function() {
  const lagretId = sessionStorage.getItem('aktivSpillerId');
  const spillere = [...(window._app?.spillere ?? [])].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  _oppdaterMotstanderVelger(spillere, lagretId);
};

function _oppdaterMotstanderVelger(spillere, lagretId) {
  const motVelger = document.getElementById('utf-mot-velger');
  if (!motVelger) return;
  motVelger.innerHTML = '<option value="">— Velg motstander —</option>' +
    spillere
      .filter(s => s.id !== lagretId)
      .map(s =>
        `<option value="${s.id}">${escHtml(s.navn ?? 'Ukjent')} — ${s.rating ?? STARTRATING} ⭐</option>`
      ).join('');
}

/** Sender utfordring fra utfordrer-skjermen. */
window.sendUtfordringFraSkjerm = async function() {
  const megId  = document.getElementById('utf-meg-velger')?.value;
  const motId  = document.getElementById('utf-mot-velger')?.value;
  if (!megId)  { visMelding('Velg deg selv først.', 'advarsel'); return; }
  if (!motId)  { visMelding('Velg en motstander.', 'advarsel'); return; }

  sessionStorage.setItem('aktivSpillerId', megId);
  const klubbId = _getAktivKlubbId();
  if (!klubbId || !db) return;

  try {
    const [utfSnap, motSnap] = await Promise.all([
      getDoc(doc(db, SAM.SPILLERE, megId)),
      getDoc(doc(db, SAM.SPILLERE, motId)),
    ]);
    if (!utfSnap.exists() || !motSnap.exists()) {
      visMelding('Fant ikke spillerdata.', 'feil'); return;
    }
    const utfSpiller = { id: utfSnap.id, ...utfSnap.data() };
    const motSpiller = { id: motSnap.id, ...motSnap.data() };

    const { ok, grunn } = await _kanUtfordre(utfSpiller, motSpiller, klubbId);
    if (!ok) { visMelding(grunn, 'advarsel'); return; }

    await _sendUtfordring(utfSpiller, motSpiller, klubbId);
    visMelding(`Utfordring sendt til ${escHtml(motSpiller.navn ?? 'motstanderen')}!`);
    await visUtfordrerSkjerm();
  } catch (e) {
    visFBFeil('Kunne ikke sende utfordring: ' + (e?.message ?? e));
  }
};

async function _lastAktiveUtfordringer(klubbId, spillere) {
  const el        = document.getElementById('utf-aktive-liste');
  const megId     = sessionStorage.getItem('aktivSpillerId');
  if (!el || !db || !klubbId) return;

  try {
    const [ventSnap, aksSnap] = await Promise.all([
      getDocs(query(collection(db, SAM.UTFORDRINGER), where('klubbId', '==', klubbId), where('status', '==', UTF_STATUS.VENTER))),
      getDocs(query(collection(db, SAM.UTFORDRINGER), where('klubbId', '==', klubbId), where('status', '==', UTF_STATUS.AKSEPTERT))),
    ]);

    const alle = [
      ...ventSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      ...aksSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    ].filter(u => _dagerSiden(u.opprettet) <= UTF_UTLOP_DAGER)
     .sort((a, b) => (b.opprettet?.toMillis?.() ?? 0) - (a.opprettet?.toMillis?.() ?? 0));

    if (!alle.length) {
      el.innerHTML = '<div class="tom-tilstand-liten" style="text-align:center">Ingen aktive utfordringer</div>';
      return;
    }

    el.innerHTML = alle.map(u => {
      const erPagar      = u.status === UTF_STATUS.AKSEPTERT;
      const erUtfordrer  = u.utfordrerIds === megId;
      const erMotstander = u.motstanderId === megId;
      const utfSeire     = (u.games ?? []).filter(g => g.utfPoeng > g.motPoeng).length;
      const motSeire     = (u.games ?? []).filter(g => g.motPoeng > g.utfPoeng).length;
      const dagerIgjen   = UTF_UTLOP_DAGER - Math.floor(_dagerSiden(u.opprettet));

      // Statuslinje
      let stillingHTML;
      if (erPagar && u.games?.length) {
        stillingHTML = `Stilling: <span style="color:var(--green2);font-weight:600">${utfSeire}</span> – <span style="color:var(--red2);font-weight:600">${motSeire}</span> · Game ${u.games.length + 1} gjenstår`;
      } else if (erPagar) {
        stillingHTML = 'Akseptert — avtal tidspunkt med motstanderen';
      } else if (erMotstander) {
        stillingHTML = `⚡ ${escHtml(u.utfordrerNavn)} har utfordret deg!`;
      } else if (erUtfordrer) {
        stillingHTML = `Venter på svar · utløper om ${dagerIgjen} dag${dagerIgjen === 1 ? '' : 'er'}`;
      } else {
        stillingHTML = `${escHtml(u.utfordrerNavn)} utfordret ${escHtml(u.motstanderNavn)} · ${dagerIgjen}d igjen`;
      }

      // Handlingsknapper — vises kun for den som er involvert
      let knapperHTML = '';
      if (!erPagar && erMotstander) {
        // Du er utfordret — vis Aksepter/Avvis
        knapperHTML = `<div style="display:flex;gap:8px;margin-top:10px">
          <button class="knapp knapp-gronn knapp-liten" style="flex:1;font-family:'DM Sans',sans-serif;font-size:15px"
            onclick="aksepterUtfordringOgOppdater('${u.id}')">✓ Aksepter</button>
          <button class="knapp knapp-fare knapp-liten" style="font-family:'DM Sans',sans-serif;font-size:15px"
            onclick="avvisUtfordringOgOppdater('${u.id}')"><span style="font-size:1.5em">🐥</span> Avslå</button>
        </div>`;
      } else if (erPagar && (erUtfordrer || erMotstander) && (u.games ?? []).length < 3) {
        // Pågår og du er involvert — vis Registrer game
        knapperHTML = `<div style="margin-top:10px">
          <button class="knapp knapp-primaer knapp-liten" style="width:100%;font-family:'DM Sans',sans-serif;font-size:15px"
            onclick="registrerUtfordringGame('${u.id}','${erUtfordrer}')">+ Registrer game</button>
        </div>`;
      } else if (!erPagar && erUtfordrer) {
        // Du venter på svar — vis Trekk tilbake
        knapperHTML = `<div style="margin-top:10px">
          <button class="knapp knapp-omriss knapp-liten" style="font-family:'DM Sans',sans-serif;font-size:14px"
            onclick="trekkTilbakeOgOppdater('${u.id}')">Trekk tilbake</button>
        </div>`;
      }

      // Fremhev kort der du er involvert
      const erInvolvert  = erUtfordrer || erMotstander;
      const kortStil     = erMotstander && !erPagar
        ? 'border-color:rgba(234,179,8,.4);'   // gul kant — venter på din respons
        : erInvolvert ? '' : 'opacity:0.75;';  // andres utfordringer dimmes litt

      return `<div class="${erPagar ? 'utf-aktiv-kort' : 'utf-venter-kort'}" style="${kortStil}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
          <div class="utf-kort-tittel">${escHtml(u.utfordrerNavn)} vs ${escHtml(u.motstanderNavn)}</div>
          <div class="${erPagar ? 'utf-status-pagar' : 'utf-status-venter'}">${erPagar ? 'Pågår' : 'Venter'}</div>
        </div>
        <div class="utf-kort-sub">${stillingHTML}</div>
        ${knapperHTML}
      </div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = '<div class="tom-tilstand-liten">Kunne ikke laste utfordringer.</div>';
  }
}

function _visSingelRanking(spillere) {
  const el = document.getElementById('utf-singel-ranking');
  if (!el) return;

  // Vis alle spillere sortert etter utfordrerrating (singel hvis nok kamper, ellers Americano)
  const medSingel = spillere
    .slice()
    .sort((a, b) => _hentUtfordrerRating(b) - _hentUtfordrerRating(a));

  if (!medSingel.length) {
    el.innerHTML = '<div class="tom-tilstand-liten" style="text-align:center">Ingen spillere registrert</div>';
    return;
  }

  el.innerHTML = medSingel.map((s, i) => {
    const ini    = lagInitialer(s.navn);
    const rating = _hentUtfordrerRating(s);
    const diff   = rating - STARTRATING;
    const ratingKl = diff > 0 ? 'pos' : diff < 0 ? 'neg' : 'nøy';
    const plassKl  = i < 3 ? 'topp' : 'mid';
    const kamper   = s.singelKamper ?? 0;
    const kilde    = kamper >= UTF_MIN_SINGEL_KAMPER ? '🎾' : '🏸';
    const tooltip  = kamper >= UTF_MIN_SINGEL_KAMPER
      ? `${kamper} singelkamper`
      : `Americano-rating (${kamper}/${UTF_MIN_SINGEL_KAMPER} singelkamper)`;
    return `<div class="utf-singel-rad">
      <div class="utf-singel-plass ${plassKl}">${i + 1}</div>
      <div class="lb-avatar" onclick="apneGlobalProfil('${s.id}')" style="cursor:pointer">${escHtml(ini)}</div>
      <div style="flex:1;cursor:pointer" onclick="apneGlobalProfil('${s.id}')">
        <div class="lb-navn">${escHtml(s.navn ?? 'Ukjent')}</div>
        <div style="font-size:12px;color:var(--muted2)">${kilde} ${tooltip}</div>
      </div>
      <div class="utf-singel-rating ${ratingKl}">${rating}</div>
    </div>`;
  }).join('');
}

async function _lastSisteResultater(klubbId, spillere) {
  const el = document.getElementById('utf-siste-resultater');
  if (!el || !db || !klubbId) return;

  try {
    // Ingen orderBy — unngår krav om sammensatt Firestore-indeks.
    // Sorterer lokalt etter henting i stedet.
    const [ferdigSnap, avvistSnap] = await Promise.all([
      getDocs(query(
        collection(db, SAM.UTFORDRINGER),
        where('klubbId', '==', klubbId),
        where('status',  '==', UTF_STATUS.FERDIG),
      )),
      getDocs(query(
        collection(db, SAM.UTFORDRINGER),
        where('klubbId', '==', klubbId),
        where('status',  '==', UTF_STATUS.AVVIST),
      )),
    ]);

    const ferdig = ferdigSnap.docs.map(d => ({ id: d.id, ...d.data(), _type: 'ferdig' }));
    const avvist = avvistSnap.docs.map(d => ({ id: d.id, ...d.data(), _type: 'avvist' }));

    const alle = [...ferdig, ...avvist]
      .sort((a, b) => (b.avsluttet?.toMillis?.() ?? 0) - (a.avsluttet?.toMillis?.() ?? 0))
      .slice(0, 5);

    if (!alle.length) {
      el.innerHTML = '<div class="tom-tilstand-liten" style="text-align:center">Ingen resultater ennå</div>';
      return;
    }

    el.innerHTML = alle.map(u => {
      const dato = u.avsluttet?.toDate?.()?.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' }) ?? '';
      if (u._type === 'avvist') {
        return `<div class="utf-res-rad">
          <div style="flex:1">
            <div style="font-size:14px;color:var(--white)">${escHtml(u.motstanderNavn)} avslo ${escHtml(u.utfordrerNavn)} <span style="font-size:2em">🐥</span></div>
            <div style="font-size:12px;color:var(--muted2)">${dato}</div>
          </div>
          <div class="utf-res-delta-nil">—</div>
        </div>`;
      }
      const utfSeire = (u.games ?? []).filter(g => g.utfPoeng > g.motPoeng).length;
      const motSeire = (u.games ?? []).filter(g => g.motPoeng > g.utfPoeng).length;
      const utfVant  = utfSeire > motSeire;
      const vinner   = utfVant ? u.utfordrerNavn : u.motstanderNavn;
      const taper    = utfVant ? u.motstanderNavn : u.utfordrerNavn;
      const vSeire   = utfVant ? utfSeire : motSeire;
      const tSeire   = utfVant ? motSeire : utfSeire;

      // Vis hvert enkelt game-resultat fra vinnerens perspektiv
      const gamesHTML = (u.games ?? []).map((g, i) => {
        const vinnerPoeng = utfVant ? g.utfPoeng : g.motPoeng;
        const taperPoeng  = utfVant ? g.motPoeng : g.utfPoeng;
        const vantDette   = vinnerPoeng > taperPoeng;
        return `<span style="font-family:'DM Mono',monospace;font-size:12px;
          color:${vantDette ? 'var(--green2)' : 'var(--muted2)'};
          margin-right:8px">
          ${vinnerPoeng}–${taperPoeng}
        </span>`;
      }).join('');

      return `<div class="utf-res-rad">
        <div style="flex:1">
          <div style="font-size:14px;color:var(--white)">
            ${escHtml(vinner)} <span style="color:var(--green2);font-weight:600">${vSeire}</span> – <span style="color:var(--red2);font-weight:600">${tSeire}</span> ${escHtml(taper)}
          </div>
          <div style="margin-top:3px">${gamesHTML}</div>
          <div style="font-size:12px;color:var(--muted2);margin-top:2px">${dato}</div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = '<div class="tom-tilstand-liten">Kunne ikke laste resultater.</div>';
  }
}


// ════════════════════════════════════════════════════════
// HJELPERE
// ════════════════════════════════════════════════════════

/**
 * Returnerer ratingen som brukes i utfordrermodusen for en spiller.
 * Bruker singelRating når spilleren har spilt minst UTF_MIN_SINGEL_KAMPER
 * singelkamper — faller tilbake på Americano-rating for resten.
 * @param {object} spiller — spillerdokument med .rating og .singelRating
 * @returns {number}
 */
function _hentUtfordrerRating(spiller) {
  const singelRating  = spiller.singelRating;
  const singelKamper  = spiller.singelKamper ?? 0;
  if (singelRating != null && singelKamper >= UTF_MIN_SINGEL_KAMPER) {
    return singelRating;
  }
  return spiller.rating ?? STARTRATING;
}

/** Ms siden en Firestore Timestamp. */
function _msSiden(ts) {
  return Date.now() - (ts?.toMillis?.() ?? 0);
}

/** Dager siden en Firestore Timestamp. */
function _dagerSiden(ts) {
  return _msSiden(ts) / (1000 * 60 * 60 * 24);
}

/**
 * Beregner ny rating etter én kamp i utfordrermodusen.
 * Bruker høyere K-faktor og opprykksbonus.
 */
function _beregnUtfordringRating(ratingA, ratingB, vantA) {
  const forventet = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const faktisk   = vantA ? 1 : 0;
  let K = UTF_K_FAKTOR;
  // Opprykksbonus: utfordreren vinner mot høyere rangert
  if (vantA && ratingB > ratingA) K = Math.round(K * UTF_OPPRYKK_BONUS);
  return Math.round(K * (faktisk - forventet));
}

// ════════════════════════════════════════════════════════
// HENT UTFORDRINGER FOR SPILLER
// ════════════════════════════════════════════════════════

async function _hentUtfordringerForSpiller(spillerId, klubbId) {
  if (!db || !spillerId || !klubbId) return [];
  try {
    // Hent alle der spilleren er involvert
    const [somUtf, somMot] = await Promise.all([
      getDocs(query(
        collection(db, SAM.UTFORDRINGER),
        where('utfordrerIds', '==', spillerId),
        where('klubbId', '==', klubbId)
      )),
      getDocs(query(
        collection(db, SAM.UTFORDRINGER),
        where('motstanderId', '==', spillerId),
        where('klubbId', '==', klubbId)
      )),
    ]);
    const alle = [
      ...somUtf.docs.map(d => ({ id: d.id, ...d.data() })),
      ...somMot.docs.map(d => ({ id: d.id, ...d.data() })),
    ];
    // Auto-utløp: marker lokalt (skrives til Firestore ved neste refresh)
    return alle.map(u => {
      if (u.status === UTF_STATUS.VENTER && _dagerSiden(u.opprettet) > UTF_UTLOP_DAGER) {
        return { ...u, status: UTF_STATUS.UTLOPT };
      }
      return u;
    });
  } catch (e) {
    console.warn('[Utfordring] Hent feilet:', e?.message);
    return [];
  }
}

// ════════════════════════════════════════════════════════
// VALIDERINGSREGLER
// ════════════════════════════════════════════════════════

/**
 * Sjekker om utfordreren kan utfordre motstanderen.
 * Returnerer { ok, grunn } der grunn er en brukervenlig feilmelding.
 */
async function _kanUtfordre(utfordrerSpiller, motstanderSpiller, klubbId) {
  // Kan ikke utfordre seg selv
  if (utfordrerSpiller.id === motstanderSpiller.id)
    return { ok: false, grunn: 'Du kan ikke utfordre deg selv.' };

  const utfRating = _hentUtfordrerRating(utfordrerSpiller);
  const motRating = _hentUtfordrerRating(motstanderSpiller);
  const diff      = Math.abs(utfRating - motRating);

  // Sjekk ratingsone — unntak: spilleren rett over deg
  // Sorter etter utfordrerrating slik at sonen er konsistent
  const alleSpillere = [...(window._app?.spillere ?? [])].sort((a, b) => _hentUtfordrerRating(b) - _hentUtfordrerRating(a));
  const utfIdx = alleSpillere.findIndex(s => s.id === utfordrerSpiller.id);
  const spillerenOverIdx = utfIdx > 0 ? utfIdx - 1 : -1;
  const erSpillerenOverMeg = spillerenOverIdx >= 0 && alleSpillere[spillerenOverIdx]?.id === motstanderSpiller.id;

  if (diff > UTF_RATING_VINDU && !erSpillerenOverMeg) {
    return { ok: false, grunn: `Ratingforskjellen er ${diff} poeng — maks er ${UTF_RATING_VINDU}. Du kan alltid utfordre spilleren rett over deg.` };
  }

  // Hent eksisterende utfordringer
  const utfordringer = await _hentUtfordringerForSpiller(utfordrerSpiller.id, klubbId);

  // Maks 1 aktiv utfordring om gangen
  const harAktiv = utfordringer.some(u =>
    (u.utfordrerIds === utfordrerSpiller.id || u.motstanderId === utfordrerSpiller.id) &&
    (u.status === UTF_STATUS.VENTER || u.status === UTF_STATUS.AKSEPTERT)
  );
  if (harAktiv)
    return { ok: false, grunn: 'Du har allerede én aktiv utfordring. Fullfør eller trekk den tilbake først.' };

  // Cooldown mot samme person
  const sisteMotSammePerson = utfordringer
    .filter(u =>
      (u.status === UTF_STATUS.FERDIG || u.status === UTF_STATUS.AVVIST) &&
      ((u.utfordrerIds === utfordrerSpiller.id && u.motstanderId === motstanderSpiller.id) ||
       (u.motstanderId === utfordrerSpiller.id && u.utfordrerIds === motstanderSpiller.id))
    )
    .sort((a, b) => (b.avsluttet?.toMillis?.() ?? 0) - (a.avsluttet?.toMillis?.() ?? 0))[0];

  if (sisteMotSammePerson && _dagerSiden(sisteMotSammePerson.avsluttet) < UTF_COOLDOWN_DAGER) {
    const gjenstår = Math.ceil(UTF_COOLDOWN_DAGER - _dagerSiden(sisteMotSammePerson.avsluttet));
    return { ok: false, grunn: `Cooldown — du kan utfordre ${motstanderSpiller.navn} igjen om ${gjenstår} dag${gjenstår === 1 ? '' : 'er'}.` };
  }

  return { ok: true, grunn: null };
}

// ════════════════════════════════════════════════════════
// SEND UTFORDRING
// ════════════════════════════════════════════════════════

async function _sendUtfordring(utfordrerSpiller, motstanderSpiller, klubbId) {
  await addDoc(collection(db, SAM.UTFORDRINGER), {
    klubbId,
    utfordrerIds:      utfordrerSpiller.id,
    utfordrerNavn:     utfordrerSpiller.navn   ?? 'Ukjent',
    utfordrerRating:   _hentUtfordrerRating(utfordrerSpiller),
    motstanderId:      motstanderSpiller.id,
    motstanderNavn:    motstanderSpiller.navn   ?? 'Ukjent',
    motstanderRating:  _hentUtfordrerRating(motstanderSpiller),
    status:            UTF_STATUS.VENTER,
    opprettet:         serverTimestamp(),
    avsluttet:         null,
    games:             [],           // [{ utfPoeng, motPoeng }]
    erRevansje:        false,
    originalUtfordringId: null,
  });
}

// ════════════════════════════════════════════════════════
// UI — UTFORDRER-SEKSJON I GLOBAL-PROFIL
// ════════════════════════════════════════════════════════

/**
 * Viser utfordrer-seksjonen på global-profil-skjermen.
 * Kalles fra apneGlobalProfil() etter at siden er navigert til.
 * @param {object} motstanderSpiller — spilleren profilen tilhører
 */
async function _visUtfordrerSeksjon(motstanderSpiller) {
  const el = document.getElementById('utf-seksjon');
  if (!el) return;

  const klubbId        = _getAktivKlubbId();
  const aktivSpillerId = _getAktivSpillerId();

  // Skjul seksjonen om vi ikke har klubb eller ser vår egen profil
  if (!klubbId || !aktivSpillerId || aktivSpillerId === motstanderSpiller.id) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.innerHTML = '<div class="kampstat-laster">Sjekker utfordringer…</div>';

  // Hent utfordrerspiller
  let utfordrerSpiller;
  try {
    const snap = await getDoc(doc(db, SAM.SPILLERE, aktivSpillerId));
    if (!snap.exists()) { el.innerHTML = ''; return; }
    utfordrerSpiller = { id: snap.id, ...snap.data() };
  } catch (e) {
    el.innerHTML = '';
    return;
  }

  // Hent aktive utfordringer mellom de to
  const utfordringer = await _hentUtfordringerForSpiller(aktivSpillerId, klubbId);
  const mellomDisse  = utfordringer.filter(u =>
    (u.utfordrerIds === aktivSpillerId && u.motstanderId === motstanderSpiller.id) ||
    (u.motstanderId === aktivSpillerId && u.utfordrerIds === motstanderSpiller.id)
  );
  const aktiv = mellomDisse.find(u =>
    u.status === UTF_STATUS.VENTER || u.status === UTF_STATUS.AKSEPTERT
  );

  // Sjekk om utfordring kan sendes
  const { ok: kanSende, grunn } = await _kanUtfordre(utfordrerSpiller, motstanderSpiller, klubbId);

  let html = `<div class="seksjon-etikett" style="margin-top:16px">⚔️ Utfordrermodusen</div>`;

  if (aktiv) {
    // Vis aktiv utfordring
    const erUtfordrer = aktiv.utfordrerIds === aktivSpillerId;
    const statusTekst = aktiv.status === UTF_STATUS.VENTER
      ? (erUtfordrer ? '⏳ Venter på svar…' : '⚡ Du er utfordret!')
      : '🎾 Pågår — Best av 3';

    const gamesHTML = (aktiv.games ?? []).map((g, i) =>
      `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="font-size:13px;color:var(--muted2);width:52px">Game ${i + 1}</div>
        <div style="font-family:'DM Mono',monospace;font-size:18px;font-weight:700;flex:1;text-align:center">
          ${erUtfordrer ? g.utfPoeng : g.motPoeng} — ${erUtfordrer ? g.motPoeng : g.utfPoeng}
        </div>
      </div>`
    ).join('');

    const gamesVunnet = (aktiv.games ?? []).filter(g =>
      erUtfordrer ? g.utfPoeng > g.motPoeng : g.motPoeng > g.utfPoeng
    ).length;
    const gamesTapt = (aktiv.games ?? []).length - gamesVunnet;

    html += `<div class="kort"><div class="kort-innhold">
      <div style="font-size:16px;font-weight:600;margin-bottom:8px">${statusTekst}</div>
      ${aktiv.games?.length ? `
        <div style="font-size:13px;color:var(--muted2);margin-bottom:8px">
          Stilling: ${gamesVunnet}–${gamesTapt}
        </div>
        ${gamesHTML}
      ` : ''}
      <div style="display:flex;gap:8px;margin-top:12px">
        ${aktiv.status === UTF_STATUS.VENTER && !erUtfordrer ? `
          <button class="knapp knapp-gronn knapp-liten" style="flex:1;font-family:'DM Sans',sans-serif;font-size:16px"
            onclick="aksepterUtfordring('${aktiv.id}')">✓ Aksepter</button>
          <button class="knapp knapp-fare knapp-liten" style="font-family:'DM Sans',sans-serif;font-size:16px"
            onclick="avvisUtfordring('${aktiv.id}')">✗ Avvis</button>
        ` : ''}
        ${aktiv.status === UTF_STATUS.AKSEPTERT && (aktiv.games ?? []).length < 3 ? `
          <button class="knapp knapp-primaer knapp-liten" style="flex:1;font-family:'DM Sans',sans-serif;font-size:16px"
            onclick="registrerUtfordringGame('${aktiv.id}','${erUtfordrer}')">+ Registrer game</button>
        ` : ''}
        ${erUtfordrer && aktiv.status === UTF_STATUS.VENTER ? `
          <button class="knapp knapp-omriss knapp-liten" style="font-family:'DM Sans',sans-serif;font-size:15px"
            onclick="trekkTilbakeUtfordring('${aktiv.id}')">Trekk tilbake</button>
        ` : ''}
      </div>
    </div></div>`;
  } else if (kanSende) {
    html += `<div class="kort"><div class="kort-innhold">
      <div style="font-size:15px;color:var(--muted2);margin-bottom:12px">
        Best av 3 games til 11 poeng · K-faktor ${UTF_K_FAKTOR}
      </div>
      <button class="knapp knapp-primaer" style="font-family:'DM Sans',sans-serif;font-size:17px;letter-spacing:0"
        onclick="sendUtfordring('${motstanderSpiller.id}')">
        ⚔️ Utfordre ${escHtml(motstanderSpiller.navn ?? 'spiller')}
      </button>
    </div></div>`;
  } else {
    html += `<div class="kort"><div class="kort-innhold">
      <div style="font-size:15px;color:var(--muted2)">${escHtml(grunn ?? 'Kan ikke utfordre nå.')}</div>
    </div></div>`;
  }

  // Vis historikk mellom de to
  const ferdig = mellomDisse.filter(u => u.status === UTF_STATUS.FERDIG);
  if (ferdig.length > 0) {
    html += `<div class="seksjon-etikett" style="margin-top:12px">Historikk mot ${escHtml(motstanderSpiller.navn ?? 'spiller')}</div>
    <div class="kort"><div class="kort-innhold" style="padding:0 16px">`;
    ferdig.sort((a, b) => (b.avsluttet?.toMillis?.() ?? 0) - (a.avsluttet?.toMillis?.() ?? 0))
      .forEach(u => {
        const erUtfordrer = u.utfordrerIds === aktivSpillerId;
        const gamesVunnet = (u.games ?? []).filter(g =>
          erUtfordrer ? g.utfPoeng > g.motPoeng : g.motPoeng > g.utfPoeng
        ).length;
        const gamesTotal  = (u.games ?? []).length;
        const vant        = gamesVunnet > gamesTotal / 2;
        const dato        = u.avsluttet?.toDate?.()?.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' }) ?? '';
        html += `<div class="historikk-rad">
          <div style="flex:1">${vant ? '🏆 Seier' : '❌ Tap'} ${gamesVunnet}–${gamesTotal - gamesVunnet}</div>
          <div style="font-size:13px;color:var(--muted2)">${dato}</div>
        </div>`;
      });
    html += `</div></div>`;
  }

  el.innerHTML = html;
}

// ════════════════════════════════════════════════════════
// WINDOW-FUNKSJONER — kalt fra onclick i HTML
// ════════════════════════════════════════════════════════

window.sendUtfordring = async function(motstanderId) {
  const klubbId        = _getAktivKlubbId();
  const aktivSpillerId = _getAktivSpillerId();
  if (!klubbId || !aktivSpillerId || !db) return;

  try {
    const [utfSnap, motSnap] = await Promise.all([
      getDoc(doc(db, SAM.SPILLERE, aktivSpillerId)),
      getDoc(doc(db, SAM.SPILLERE, motstanderId)),
    ]);
    if (!utfSnap.exists() || !motSnap.exists()) return;
    const utfSpiller = { id: utfSnap.id, ...utfSnap.data() };
    const motSpiller = { id: motSnap.id, ...motSnap.data() };

    const { ok, grunn } = await _kanUtfordre(utfSpiller, motSpiller, klubbId);
    if (!ok) { visMelding(grunn, 'advarsel'); return; }

    await _sendUtfordring(utfSpiller, motSpiller, klubbId);
    visMelding(`Utfordring sendt til ${motSpiller.navn}!`);
    await _visUtfordrerSeksjon(motSpiller);
  } catch (e) {
    visFBFeil('Kunne ikke sende utfordring: ' + (e?.message ?? e));
  }
};

window.aksepterUtfordring = async function(utfordringId) {
  if (!db) return;
  try {
    await updateDoc(doc(db, SAM.UTFORDRINGER, utfordringId), {
      status: UTF_STATUS.AKSEPTERT,
    });
    visMelding('Utfordring akseptert! Avtal tid med motstanderen.');
    // Refresh seksjonen
    const motstanderId = document.getElementById('utf-seksjon')?.dataset?.motstanderId;
    if (motstanderId) {
      const snap = await getDoc(doc(db, SAM.SPILLERE, motstanderId));
      if (snap.exists()) await _visUtfordrerSeksjon({ id: snap.id, ...snap.data() });
    }
  } catch (e) {
    visFBFeil('Feil ved aksept: ' + (e?.message ?? e));
  }
};

window.avvisUtfordring = async function(utfordringId) {
  if (!db) return;
  try {
    await updateDoc(doc(db, SAM.UTFORDRINGER, utfordringId), {
      status: UTF_STATUS.AVVIST,
      avsluttet: serverTimestamp(),
    });
    visMelding('Utfordring avvist. <span style="font-size:2em">🐥</span>');
    const motstanderId = document.getElementById('utf-seksjon')?.dataset?.motstanderId;
    if (motstanderId) {
      const snap = await getDoc(doc(db, SAM.SPILLERE, motstanderId));
      if (snap.exists()) await _visUtfordrerSeksjon({ id: snap.id, ...snap.data() });
    }
  } catch (e) {
    visFBFeil('Feil ved avvisning: ' + (e?.message ?? e));
  }
};

// ── Wrapper-funksjoner for utfordrer-skjermen — kaller eksisterende logikk
// og refresher hele skjermen etterpå slik at knapper forsvinner.

window.aksepterUtfordringOgOppdater = async function(utfordringId) {
  if (!db) return;
  try {
    await updateDoc(doc(db, SAM.UTFORDRINGER, utfordringId), {
      status: UTF_STATUS.AKSEPTERT,
    });
    visMelding('Utfordring akseptert! Avtal tid med motstanderen.');
    await visUtfordrerSkjerm();
  } catch (e) {
    visFBFeil('Feil ved aksept: ' + (e?.message ?? e));
  }
};

window.avvisUtfordringOgOppdater = async function(utfordringId) {
  if (!db) return;
  try {
    await updateDoc(doc(db, SAM.UTFORDRINGER, utfordringId), {
      status:    UTF_STATUS.AVVIST,
      avsluttet: serverTimestamp(),
    });
    visMelding('Utfordring avslått. <span style="font-size:2em">🐥</span>');
    await visUtfordrerSkjerm();
  } catch (e) {
    visFBFeil('Feil ved avvisning: ' + (e?.message ?? e));
  }
};

window.trekkTilbakeOgOppdater = async function(utfordringId) {
  if (!db) return;
  try {
    await updateDoc(doc(db, SAM.UTFORDRINGER, utfordringId), {
      status:    UTF_STATUS.UTLOPT,
      avsluttet: serverTimestamp(),
    });
    visMelding('Utfordring trukket tilbake.');
    await visUtfordrerSkjerm();
  } catch (e) {
    visFBFeil('Feil: ' + (e?.message ?? e));
  }
};

window.trekkTilbakeUtfordring = async function(utfordringId) {
  if (!db) return;
  try {
    await updateDoc(doc(db, SAM.UTFORDRINGER, utfordringId), {
      status: UTF_STATUS.UTLOPT,
      avsluttet: serverTimestamp(),
    });
    visMelding('Utfordring trukket tilbake.');
    const motstanderId = document.getElementById('utf-seksjon')?.dataset?.motstanderId;
    if (motstanderId) {
      const snap = await getDoc(doc(db, SAM.SPILLERE, motstanderId));
      if (snap.exists()) await _visUtfordrerSeksjon({ id: snap.id, ...snap.data() });
    }
  } catch (e) {
    visFBFeil('Feil: ' + (e?.message ?? e));
  }
};

// ── Tallgrid-hjelpere for utfordrer-game-modal ──────────────────────────────

function _utfBuildPickerGrid(felt) {
  const picker = document.getElementById(`utf-pp-${felt}`);
  if (!picker) return;
  const gjeldende = parseInt(picker.dataset.valgt ?? '-1');
  picker.innerHTML = '';
  for (let n = 0; n <= 15; n++) {
    const el = document.createElement('div');
    el.className = 'poeng-picker-tall' + (n === gjeldende ? ' valgt' : '');
    el.textContent = n;
    el.onclick = (e) => { e.stopPropagation(); _utfVelgPoeng(felt, n); };
    picker.appendChild(el);
  }
}

window.utfApnePicker = function(felt) {
  // Sørg for at poeng-picker CSS er lastet (samme som baner.js sin _byggPickerCSS)
  if (!document.getElementById('poeng-picker-css')) {
    const s = document.createElement('style');
    s.id = 'poeng-picker-css';
    s.textContent = `
      .poeng-velger-boks{cursor:pointer;background:var(--card2);border:1.5px solid var(--border);border-radius:10px;padding:10px 8px;font-size:26px;font-weight:600;text-align:center;color:var(--white);min-height:52px;display:flex;align-items:center;justify-content:center;transition:border-color .15s;user-select:none}
      .poeng-velger-boks.aktiv{border-color:var(--blue,#378ADD)}
      .poeng-picker{margin-top:8px;display:grid;grid-template-columns:repeat(8,1fr);gap:5px}
      .poeng-picker-tall{cursor:pointer;border-radius:6px;padding:8px 2px;text-align:center;font-size:15px;font-weight:500;border:.5px solid var(--border);background:var(--card2);color:var(--white);transition:background .1s;user-select:none}
      .poeng-picker-tall.valgt{background:var(--blue,#378ADD);border-color:var(--blue,#378ADD);color:#fff}
    `;
    document.head.appendChild(s);
  }
  const annet  = felt === 'p1' ? 'p2' : 'p1';
  // Lukk den andre
  const annenP = document.getElementById(`utf-pp-${annet}`);
  if (annenP) annenP.style.display = 'none';
  document.getElementById(`utf-pvb-${annet}`)?.classList.remove('aktiv');

  const picker = document.getElementById(`utf-pp-${felt}`);
  const boks   = document.getElementById(`utf-pvb-${felt}`);
  if (!picker || !boks) return;
  const erApen = picker.style.display !== 'none';
  if (erApen) {
    picker.style.display = 'none';
    boks.classList.remove('aktiv');
  } else {
    _utfBuildPickerGrid(felt);
    picker.style.display = 'grid';
    boks.classList.add('aktiv');
  }
};

function _utfVelgPoeng(felt, verdi) {
  const boks   = document.getElementById(`utf-pvb-${felt}`);
  const picker = document.getElementById(`utf-pp-${felt}`);
  if (boks)   boks.textContent = verdi;
  if (picker) { picker.dataset.valgt = verdi; picker.style.display = 'none'; }
  if (boks)   boks.classList.remove('aktiv');
  document.getElementById('utf-game-feil').textContent = '';
}

function _utfResetModal(gameNr, stilling) {
  // Reset boksene til tomme
  ['p1','p2'].forEach(felt => {
    const boks   = document.getElementById(`utf-pvb-${felt}`);
    const picker = document.getElementById(`utf-pp-${felt}`);
    if (boks)   { boks.textContent = '–'; boks.classList.remove('aktiv'); }
    if (picker) { picker.style.display = 'none'; delete picker.dataset.valgt; }
  });
  document.getElementById('utf-game-feil').textContent = '';
  const tittel = document.getElementById('utf-game-tittel');
  if (tittel) tittel.textContent = `Registrer game ${gameNr}`;
  const stillingEl = document.getElementById('utf-game-stilling');
  if (stillingEl) stillingEl.textContent = stilling ?? '';
}

function _utfHentVerdi(felt) {
  const picker = document.getElementById(`utf-pp-${felt}`);
  const boks   = document.getElementById(`utf-pvb-${felt}`);
  // Prøv picker.dataset.valgt, deretter boks-tekst
  const fraPicker = picker?.dataset?.valgt;
  if (fraPicker != null) return parseInt(fraPicker);
  const fraBoks = parseInt(boks?.textContent);
  return isNaN(fraBoks) ? NaN : fraBoks;
}

window.registrerUtfordringGame = async function(utfordringId, erUtfordrer) {
  const modal = document.getElementById('modal-utf-game');
  if (!modal || !db) return;
  modal.dataset.utfordringId = utfordringId;
  modal.dataset.erUtfordrer  = String(erUtfordrer);

  // Hent nåværende stilling fra Firestore
  try {
    const snap = await getDoc(doc(db, SAM.UTFORDRINGER, utfordringId));
    if (snap.exists()) {
      const u       = snap.data();
      const gNr     = (u.games ?? []).length + 1;
      const utfSeire = (u.games ?? []).filter(g => g.utfPoeng > g.motPoeng).length;
      const motSeire = (u.games ?? []).filter(g => g.motPoeng > g.utfPoeng).length;
      const erUtf    = erUtfordrer === true || erUtfordrer === 'true';
      const megSeire = erUtf ? utfSeire : motSeire;
      const demSeire = erUtf ? motSeire : utfSeire;
      const nav1     = document.getElementById('utf-game-navn1');
      const nav2     = document.getElementById('utf-game-navn2');
      if (nav1) nav1.textContent = erUtf ? (u.utfordrerNavn ?? 'Deg') : (u.motstanderNavn ?? 'Deg');
      if (nav2) nav2.textContent = erUtf ? (u.motstanderNavn ?? 'Motstander') : (u.utfordrerNavn ?? 'Motstander');
      _utfResetModal(gNr, gNr > 1 ? `Stilling: ${megSeire}–${demSeire}` : 'Best av 3 · til 11 poeng');
    }
  } catch (_) {
    _utfResetModal(1, 'Best av 3 · til 11 poeng');
  }

  modal.style.display = 'flex';
  // Åpne tallgridet for venstre spiller automatisk
  setTimeout(() => window.utfApnePicker('p1'), 80);
};

window.lukkUtfordringGameModal = function() {
  const modal = document.getElementById('modal-utf-game');
  if (modal) modal.style.display = 'none';
  ['p1','p2'].forEach(felt => {
    const picker = document.getElementById(`utf-pp-${felt}`);
    if (picker) { picker.style.display = 'none'; delete picker.dataset.valgt; }
    document.getElementById(`utf-pvb-${felt}`)?.classList.remove('aktiv');
  });
};

window.bekreftUtfordringGame = async function() {
  const modal        = document.getElementById('modal-utf-game');
  const utfordringId = modal?.dataset?.utfordringId;
  const erUtfordrer  = modal?.dataset?.erUtfordrer === 'true';
  const feilEl       = document.getElementById('utf-game-feil');

  const p1 = _utfHentVerdi('p1');
  const p2 = _utfHentVerdi('p2');

  if (isNaN(p1) || isNaN(p2) || p1 < 0 || p2 < 0) {
    feilEl.textContent = 'Fyll inn poeng for begge spillere.'; return;
  }
  if (p1 === p2) {
    feilEl.textContent = 'Uavgjort er ikke mulig — én spiller må vinne.'; return;
  }
  const vinnende = Math.max(p1, p2);
  const tapende  = Math.min(p1, p2);

  if (vinnende < 11) {
    feilEl.textContent = 'Vinnerpoeng må være minst 11.'; return;
  }
  // Ved 14–14: førstemann til 15 vinner (golden point — ingen marginkrav)
  if (tapende === 14 && vinnende === 15) {
    // Gyldig golden point-seier
  } else if (vinnende - tapende < 2) {
    feilEl.textContent = 'Vinneren må lede med minst 2 poeng.'; return;
  }

  feilEl.textContent = '';

  try {
    const snap = await getDoc(doc(db, SAM.UTFORDRINGER, utfordringId));
    if (!snap.exists()) { feilEl.textContent = 'Utfordring ikke funnet.'; return; }
    const u = snap.data();

    // Lagre game: alltid i perspektiv utfordrer vs motstander
    const utfPoeng = erUtfordrer ? p1 : p2;
    const motPoeng = erUtfordrer ? p2 : p1;
    const nyeGames = [...(u.games ?? []), { utfPoeng, motPoeng }];

    // Tell seire
    const utfSeire = nyeGames.filter(g => g.utfPoeng > g.motPoeng).length;
    const motSeire = nyeGames.filter(g => g.motPoeng > g.utfPoeng).length;
    const erFerdig = utfSeire === 2 || motSeire === 2; // best av 3

    const oppdatering = { games: nyeGames };

    if (erFerdig) {
      oppdatering.status    = UTF_STATUS.FERDIG;
      oppdatering.avsluttet = serverTimestamp();

      // Oppdater singel-rating for begge spillere
      const utfRating = u.utfordrerRating ?? STARTRATING;
      const motRating = u.motstanderRating ?? STARTRATING;
      const utfVant   = utfSeire > motSeire;

      const utfDelta = _beregnUtfordringRating(utfRating, motRating, utfVant);
      const motDelta = _beregnUtfordringRating(motRating, utfRating, !utfVant);

      const [utfSpillerSnap, motSpillerSnap] = await Promise.all([
        getDoc(doc(db, SAM.SPILLERE, u.utfordrerIds)),
        getDoc(doc(db, SAM.SPILLERE, u.motstanderId)),
      ]);

      const batch = writeBatch(db);
      batch.update(doc(db, SAM.UTFORDRINGER, utfordringId), oppdatering);

      if (utfSpillerSnap.exists()) {
        const d = utfSpillerSnap.data();
        batch.update(doc(db, SAM.SPILLERE, u.utfordrerIds), {
          singelRating:  Math.max(1, (d.singelRating ?? STARTRATING) + utfDelta),
          singelKamper:  (d.singelKamper ?? 0) + 1,
        });
      }
      if (motSpillerSnap.exists()) {
        const d = motSpillerSnap.data();
        batch.update(doc(db, SAM.SPILLERE, u.motstanderId), {
          singelRating:  Math.max(1, (d.singelRating ?? STARTRATING) + motDelta),
          singelKamper:  (d.singelKamper ?? 0) + 1,
        });
      }
      await batch.commit();

      const vinnerNavn = utfVant ? u.utfordrerNavn : u.motstanderNavn;
      visMelding(`${vinnerNavn} vinner serien! 🏆`);
    } else {
      await updateDoc(doc(db, SAM.UTFORDRINGER, utfordringId), oppdatering);
      visMelding(`Game registrert. Stilling: ${utfSeire}–${motSeire}`);
    }

    if (erFerdig) {
      // Serien ferdig — lukk modal og refresh
      lukkUtfordringGameModal();
      if (document.getElementById('skjerm-utfordrer')?.classList.contains('active')) {
        await visUtfordrerSkjerm();
      } else {
        const motstanderId = document.getElementById('utf-seksjon')?.dataset?.motstanderId;
        if (motstanderId) {
          const motSnap = await getDoc(doc(db, SAM.SPILLERE, motstanderId));
          if (motSnap.exists()) await _visUtfordrerSeksjon({ id: motSnap.id, ...motSnap.data() });
        }
      }
    } else {
      // Serien pågår — bli i modal, reset for neste game
      const utfSeireNy  = nyeGames.filter(g => g.utfPoeng > g.motPoeng).length;
      const motSeireNy  = nyeGames.filter(g => g.motPoeng > g.utfPoeng).length;
      const erUtf       = modal.dataset.erUtfordrer === 'true';
      const megSeireNy  = erUtf ? utfSeireNy : motSeireNy;
      const demSeireNy  = erUtf ? motSeireNy : utfSeireNy;
      _utfResetModal(nyeGames.length + 1, `Stilling: ${megSeireNy}–${demSeireNy}`);
      // Åpne tallgridet automatisk for neste game
      setTimeout(() => window.utfApnePicker('p1'), 80);
      // Refresh aktivlisten i bakgrunnen
      const klubbId = _getAktivKlubbId();
      if (klubbId) _lastAktiveUtfordringer(klubbId, window._app?.spillere ?? []);
    }
  } catch (e) {
    feilEl.textContent = 'Feil ved lagring: ' + (e?.message ?? e);
  }
};

// Patch apneGlobalProfil til å vise utfordrer-seksjonen
const _originalApneGlobalProfil = window.apneGlobalProfil;
window.apneGlobalProfil = async function(spillerId) {
  await _originalApneGlobalProfil(spillerId);
  // Sett motstanderId på seksjonen for refresh-kall
  const utf = document.getElementById('utf-seksjon');
  if (utf) utf.dataset.motstanderId = spillerId;
  // Hent spillerdata og vis seksjon
  if (db && spillerId) {
    try {
      const snap = await getDoc(doc(db, SAM.SPILLERE, spillerId));
      if (snap.exists()) await _visUtfordrerSeksjon({ id: snap.id, ...snap.data() });
    } catch (_) {}
  }
};
