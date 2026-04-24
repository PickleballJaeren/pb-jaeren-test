// ════════════════════════════════════════════════════════
// baner.js — visning av baner og poengregistrering
// ════════════════════════════════════════════════════════
import {
  db, SAM, STARTRATING, PARTER_6_DOBBEL, PARTER_6_SINGEL,
  collection, doc, updateDoc,
  query, where, getDocs, writeBatch, serverTimestamp,
} from './firebase.js';
import { app, erMix } from './state.js';
import { getParter } from './rotasjon.js';
import { visMelding, visFBFeil, escHtml } from './ui.js';

// ── Avhengigheter injisert fra app.js via banerInit() ────────────────────────
let _naviger            = () => {};
let _oppdaterAvbrytKnapp = () => {};

export function banerInit(deps) {
  _naviger             = deps.naviger;
  _oppdaterAvbrytKnapp = deps.oppdaterAvbrytKnapp;
}

// kampStatusCache eksporteres slik at trening.js kan nullstille den
export let kampStatusCache = {};
export function setKampStatusCache(v) { kampStatusCache = v; }
export function getKampStatusCache()  { return kampStatusCache; }

export function oppdaterRundeUI() {
  const rundeHdr = document.getElementById('runde-hdr');
  const maksHdr  = document.getElementById('maks-runder-hdr');
  if (rundeHdr) rundeHdr.textContent = app.runde;
  if (maksHdr)  maksHdr.textContent  = app.maksRunder;

  // Mix: annen sub-header i bane-headeren
  const banerSub = document.getElementById('baner-hdr-sub');
  if (banerSub) banerSub.textContent = erMix() ? 'Mix & Match' : 'Baneoversikt';

  // Mix-merke — kun synlig i Mix & Match-modus
  const mixMerkeEl = document.getElementById('mix-modus-merke');
  if (mixMerkeEl) mixMerkeEl.style.display = erMix() ? 'inline-flex' : 'none';

  // Mix: bruk "Kamp" i stedet for "Runde"
  if (erMix()) {
    const appName = document.querySelector('#skjerm-baner .app-name');
    if (appName) appName.innerHTML = `Kamp <span id="runde-hdr">${app.runde}</span>/<span id="maks-runder-hdr">${app.maksRunder}</span>`;
    document.getElementById('runde-indikator-tekst').textContent =
      `Kamp ${app.runde} av ${app.maksRunder} — trykk på en bane for å registrere poeng 🎲`;
  } else {
    const appName = document.querySelector('#skjerm-baner .app-name');
    if (appName) appName.innerHTML = `Runde <span id="runde-hdr">${app.runde}</span>/<span id="maks-runder-hdr">${app.maksRunder}</span>`;
    document.getElementById('runde-indikator-tekst').textContent =
      `Runde ${app.runde} av ${app.maksRunder} pågår — trykk på en bane for å registrere poeng`;
  }

  // Sett tekst på neste-kamp/neste-runde-knappen
  const nesteKnapp = document.getElementById('neste-runde-knapp');
  if (nesteKnapp) nesteKnapp.textContent = erMix() ? 'NESTE KAMP →' : 'NESTE RUNDE →';

  const wrap = document.getElementById('fremgang-beholder');
  let h = '';
  for (let i = 1; i <= app.maksRunder; i++) {
    const kl = i < app.runde ? 'ferdig' : i === app.runde ? 'aktiv' : '';
    h += `<div class="fremgang-prikk ${kl}"></div>`;
  }
  h += `<span class="fremgang-tekst">${erMix() ? 'Kamp' : 'Runde'} ${app.runde} av ${app.maksRunder}</span>`;
  wrap.innerHTML = h;
}
// ════════════════════════════════════════════════════════
// BANEOVERSIKT
// ════════════════════════════════════════════════════════

let _visBanerTimer = null;
export function visBanerDebounced() {
  clearTimeout(_visBanerTimer);
  _visBanerTimer = setTimeout(visBaner, 50);
}

export function oppdaterKampStatus(kamper) {
  kampStatusCache = {};
  (kamper ?? []).forEach(k => {
    if (k?.baneNr && k?.kampNr != null) {
      kampStatusCache[`${k.baneNr}_${k.kampNr}`] = k;
    }
  });
  const baneLaster = document.getElementById('bane-laster');
  if (baneLaster) baneLaster.style.display = 'none';
  visBanerDebounced();
}

export function visBaner() {
  // Ingen aktiv økt — vis tom tilstand og skjul alt
  if (!app.treningId) {
    const rh = document.getElementById('runde-hdr');
    const mh = document.getElementById('maks-runder-hdr');
    if (rh) rh.textContent = '—';
    if (mh) mh.textContent = '—';
    document.getElementById('runde-indikator-tekst').textContent = 'Ingen aktiv økt';
    document.getElementById('fremgang-beholder').innerHTML    = '';
    document.getElementById('venteliste-visning').innerHTML   = '';
    document.getElementById('bane-liste').innerHTML =
      '<div style="padding:30px 0;text-align:center;color:var(--muted2);font-size:17px">' +
      'Ingen økt pågår. Gå til <strong style="color:var(--white)">Hjem</strong>-fanen for å starte ny økt.</div>';
    document.getElementById('neste-runde-knapp').disabled = true;
    return;
  }

  const vl     = app.venteliste ?? [];
  const vlWrap = document.getElementById('venteliste-visning');
  if (vl.length > 0) {
    vlWrap.innerHTML = `<div class="venteliste-boks">
      <div class="venteliste-tittel">Venteliste (${vl.length})</div>
      ${vl.map((s,i) => `<div class="vl-rad">
        <div class="vl-pos">#${i+1}</div>
        <div style="flex:1">${s.navn ?? 'Ukjent'}</div>
        <div style="font-family:'DM Mono',monospace;font-size:14px;color:var(--muted2)">⭐ ${s.rating ?? STARTRATING}</div>
      </div>`).join('')}
    </div>`;
  } else {
    vlWrap.innerHTML = '';
  }

  document.getElementById('bane-liste').innerHTML = (app.baneOversikt ?? []).map(bane => {
    const antallSpillere = bane?.spillere?.length ?? 0;
    const erSingelBane = bane?.erSingel === true || antallSpillere === 2;
    if (antallSpillere < 2) return '';

    // ── Mix & Match: én enkel kamp per bane, ingen K1/K2/K3 ──
    if (erMix()) {
      const k      = kampStatusCache[`bane${bane.baneNr}_1`];
      const ferdig = k?.ferdig === true;
      // Hent lagnavnene fra Firestore-kampen om tilgjengelig, ellers fra baneOversikt
      const lag1 = k
        ? `${k.lag1_s1_navn ?? '?'} + ${k.lag1_s2_navn ?? '?'}`
        : `${bane.spillere[0]?.navn ?? '?'} + ${bane.spillere[1]?.navn ?? '?'}`;
      const lag2 = k
        ? `${k.lag2_s1_navn ?? '?'} + ${k.lag2_s2_navn ?? '?'}`
        : `${bane.spillere[2]?.navn ?? '?'} + ${bane.spillere[3]?.navn ?? '?'}`;
      const baneMaksPoeng  = bane.maksPoeng ?? app.poengPerKamp ?? 15;
      const spillTilMerke  = `<span style="font-size:12px;background:rgba(37,99,235,.12);color:var(--accent2);border-radius:4px;padding:2px 7px;font-weight:700">Til ${baneMaksPoeng}</span>`;
      return `<div class="kort" style="cursor:pointer" onclick="apnePoenginput(${bane.baneNr})">
        <div class="kort-hode">
          <div style="display:flex;align-items:baseline;gap:10px">
            <div class="bane-nummer-stor" style="color:var(--green2)">${bane.baneNr}</div>
            <div>
              <div style="font-size:13px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted2)">Bane ${spillTilMerke}</div>
              <div style="font-size:15px;color:${ferdig ? 'var(--green2)' : 'var(--muted2)'};font-weight:600">${ferdig ? '✓ Ferdig' : 'Mangler poeng'}</div>
            </div>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </div>
        <div class="kort-innhold">
          <div class="kamp-rad">
            <div style="flex:1">
              <div class="kamp-lag">${lag1}</div>
              <div class="kamp-mot">mot</div>
              <div class="kamp-lag">${lag2}</div>
            </div>
            <div class="kamp-poeng-merke ${ferdig ? 'poeng-ferdig' : 'poeng-mangler'}">
              ${ferdig ? `${k.lag1Poeng}–${k.lag2Poeng}` : '—'}
            </div>
          </div>
        </div>
      </div>`;
    }

    // ── Singel-bane (6-spiller-format) ──
    if (erSingelBane) {
      const k      = kampStatusCache[`bane${bane.baneNr}_1`];
      const ferdig = k?.ferdig === true;
      const s      = bane.spillere;
      const rad = `<div class="kamp-rad">
        <div class="kamp-nummer">K1</div>
        <div style="flex:1">
          <div class="kamp-lag" style="color:var(--white)">${s[0]?.navn ?? '?'}</div>
          <div class="kamp-mot">mot</div>
          <div class="kamp-lag" style="color:var(--white)">${s[1]?.navn ?? '?'}</div>
        </div>
        <div class="kamp-poeng-merke ${ferdig?'poeng-ferdig':'poeng-mangler'}">
          ${ferdig ? `${k.lag1Poeng}–${k.lag2Poeng}` : '—'}
        </div>
      </div>`;
      const baneMaksPoeng = bane.maksPoeng ?? app.poengPerKamp ?? 15;
      const spillTilMerke = `<span style="font-size:12px;background:rgba(37,99,235,.12);color:var(--accent2);border-radius:4px;padding:2px 7px;font-weight:700;letter-spacing:.3px">Til ${baneMaksPoeng}</span>`;
      const singelMerke = `<span style="font-size:12px;background:rgba(234,179,8,.15);color:var(--yellow);border-radius:4px;padding:2px 7px;font-weight:700;letter-spacing:.5px">🏃 SINGEL</span>`;
      return `<div class="kort" style="cursor:pointer" onclick="apnePoenginput(${bane.baneNr})">
        <div class="kort-hode">
          <div style="display:flex;align-items:baseline;gap:10px">
            <div class="bane-nummer-stor" style="color:var(--yellow)">${bane.baneNr}</div>
            <div>
              <div style="font-size:13px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted2);display:flex;align-items:center;gap:6px">Singel ${singelMerke} ${spillTilMerke}</div>
              <div style="font-size:15px;color:${ferdig?'var(--green2)':'var(--muted2)'};font-weight:600">${ferdig?'✓ Ferdig':'Mangler poeng'}</div>
            </div>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </div>
        <div class="kort-innhold">${rad}</div>
      </div>`;
    }

    // ── Dobbel-bane (normal eller 6-spiller-format) ──
    if (antallSpillere < 4) return '';
    // 6-spiller dobbel-bane har kun 1 kamp (PARTER_6_DOBBEL), ikke 3 (PARTER)
    const parter = (app.er6SpillerFormat && bane.erDobbel) ? PARTER_6_DOBBEL : getParter(antallSpillere);
    const rader = parter.map(par => {
      const k      = kampStatusCache[`bane${bane.baneNr}_${par.nr}`];
      const ferdig = k?.ferdig === true;
      const s      = bane.spillere;
      const hvilerNavn = par.hviler != null ? (s[par.hviler]?.navn ?? null) : null;
      return `<div class="kamp-rad">
        <div class="kamp-nummer">K${par.nr}</div>
        <div style="flex:1">
          <div class="kamp-lag">${s[par.lag1[0]]?.navn ?? '?'} + ${s[par.lag1[1]]?.navn ?? '?'}</div>
          <div class="kamp-mot">mot</div>
          <div class="kamp-lag">${s[par.lag2[0]]?.navn ?? '?'} + ${s[par.lag2[1]]?.navn ?? '?'}</div>
          ${hvilerNavn ? `<div style="font-size:13px;color:var(--orange);margin-top:4px">💤 ${hvilerNavn} hviler</div>` : ''}
        </div>
        <div class="kamp-poeng-merke ${ferdig?'poeng-ferdig':'poeng-mangler'}">
          ${ferdig ? `${k.lag1Poeng}–${k.lag2Poeng}` : '—'}
        </div>
      </div>`;
    }).join('');
    const alleFerdig = parter.every(par => kampStatusCache[`bane${bane.baneNr}_${par.nr}`]?.ferdig === true);
    const bane5merke = antallSpillere === 5
      ? `<span style="font-size:12px;background:rgba(234,88,12,.15);color:var(--orange);border-radius:4px;padding:2px 7px;font-weight:700;letter-spacing:.5px">5 SPL</span>`
      : '';
    const dobbelMerke = app.er6SpillerFormat
      ? `<span style="font-size:12px;background:rgba(37,99,235,.15);color:var(--accent2);border-radius:4px;padding:2px 7px;font-weight:700;letter-spacing:.5px">🎾 DOBBEL</span>`
      : '';
    const baneMaksPoeng = bane.maksPoeng ?? (app.poengPerKamp ?? 17);
    const spillTilMerke = `<span style="font-size:12px;background:rgba(37,99,235,.12);color:var(--accent2);border-radius:4px;padding:2px 7px;font-weight:700;letter-spacing:.3px">Til ${baneMaksPoeng}</span>`;
    return `<div class="kort" style="cursor:pointer" onclick="apnePoenginput(${bane.baneNr})">
      <div class="kort-hode">
        <div style="display:flex;align-items:baseline;gap:10px">
          <div class="bane-nummer-stor">${bane.baneNr}</div>
          <div>
            <div style="font-size:13px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted2);display:flex;align-items:center;gap:6px">Bane ${bane5merke} ${dobbelMerke} ${spillTilMerke}</div>
            <div style="font-size:15px;color:${alleFerdig?'var(--green2)':'var(--muted2)'};font-weight:600">${alleFerdig?'✓ Ferdig':'Mangler poeng'}</div>
          </div>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
      </div>
      <div class="kort-innhold">${rader}</div>
    </div>`;
  }).join('');

  const alleBanerFerdig = (app.baneOversikt ?? []).length > 0 &&
    (app.baneOversikt ?? []).every(bane => {
      const n = bane?.spillere?.length ?? 0;
      if (n < 2) return false;
      // Mix: alltid kun K1 per bane
      if (erMix()) return kampStatusCache[`bane${bane.baneNr}_1`]?.ferdig === true;
      const erSingelBane = bane?.erSingel === true || n === 2;
      if (erSingelBane) return kampStatusCache[`bane${bane.baneNr}_1`]?.ferdig === true;
      const parterFerdig = (app.er6SpillerFormat && bane.erDobbel) ? PARTER_6_DOBBEL : getParter(n);
      return parterFerdig.every(par => kampStatusCache[`bane${bane.baneNr}_${par.nr}`]?.ferdig === true);
    });
  document.getElementById('neste-runde-knapp').disabled = !alleBanerFerdig;
  _oppdaterAvbrytKnapp();

  // Rediger-knapp — alltid synlig for admin
  let redigerKnapp = document.getElementById('rediger-baner-knapp');
  if (!redigerKnapp) {
    redigerKnapp = document.createElement('button');
    redigerKnapp.id        = 'rediger-baner-knapp';
    redigerKnapp.className = 'knapp knapp-omriss knapp-liten';
    redigerKnapp.style.cssText = 'margin-top:10px;width:100%';
    redigerKnapp.textContent   = '✏️ Rediger banefordeling';
    redigerKnapp.onclick       = () => apneRedigerBaner();
    const baneListe = document.getElementById('bane-liste');
    if (baneListe) baneListe.after(redigerKnapp);
  }
}

// ════════════════════════════════════════════════════════
// POENGREGISTRERING + VALIDERING
// ════════════════════════════════════════════════════════
export function apnePoenginput(baneNr) {
  const bane = (app.baneOversikt ?? []).find(b => b.baneNr === baneNr);
  const erSingelGuard = bane?.erSingel === true || (bane?.spillere?.length === 2);
  if (!bane || !bane.spillere || (!erSingelGuard && bane.spillere.length < 4)) {
    visMelding('Banedataen er ikke tilgjengelig.', 'feil');
    return;
  }
  app.aktivBane = baneNr;
  document.getElementById('poeng-bane-nummer').textContent = baneNr;
  document.getElementById('poeng-bane-stor').textContent   = baneNr;
  const maksPoeng = bane.maksPoeng ?? (app.poengPerKamp ?? 17);
  document.getElementById('maks-hint').textContent         = maksPoeng;
  document.getElementById('valider-feil').style.display    = 'none';
  const doneBtn = document.getElementById('done-knapp');
  if (doneBtn) doneBtn.style.display = 'none';

  const erSingelBane = bane?.erSingel === true || bane.spillere.length === 2;
  // Mix: alltid én kamp per bane (K1) — hent lagnavnene fra kampdata
  const erDobbelBane6 = app.er6SpillerFormat && (bane?.erDobbel === true);
  const parter = erMix()
    ? [{ nr: 1, lag1: [0, 1], lag2: [2, 3] }]   // én fast kamp
    : (erSingelBane ? PARTER_6_SINGEL : (erDobbelBane6 ? PARTER_6_DOBBEL : getParter(bane.spillere.length)));

  const eksisterende = {};
  parter.forEach(par => {
    const k = kampStatusCache[`bane${baneNr}_${par.nr}`];
    if (k?.ferdig) eksisterende[par.nr] = { l1: k.lag1Poeng, l2: k.lag2Poeng };
  });

  // Mix: hent spillernavn fra kampdata (K1) i stedet for bane.spillere
  const mixKamp = erMix() ? (kampStatusCache[`bane${baneNr}_1`] ?? null) : null;

  document.getElementById('poeng-kamper').innerHTML = parter.map((par, i) => {
    const e   = eksisterende[par.nr];
    const s   = bane.spillere;

    // ── Singel-kamp: 1 vs 1 ──
    if (erSingelBane) {
      const l1n = s[0]?.navn ?? '?';
      const l2n = s[1]?.navn ?? '?';
      const statusHTML = e != null
        ? `<div class="kamp-status lagret" id="kamp-status-${i}">✓ Lagret</div>`
        : `<div class="kamp-status" id="kamp-status-${i}"></div>`;
      return `<div class="kamp-kort" id="kk-${i}">
        <div class="kamp-hode">
          🏃 Singel <span class="kamp-merke" style="background:rgba(234,179,8,.15);color:var(--yellow)">1 vs 1</span>
          ${statusHTML}
        </div>
        <div style="text-align:center;font-size:14px;color:var(--yellow);padding:6px 0 2px;font-weight:600">Singel — spill til ${bane.maksPoeng ?? app.poengPerKamp ?? 15} poeng</div>
        <div class="lag-rad">
          <div class="lag-boks">
            <div class="lag-navn" style="color:var(--white);font-weight:600">${escHtml(l1n)}</div>
            <input class="poeng-inndata" type="text" inputmode="numeric" pattern="[0-9]*" id="s${i}_l1"
              placeholder="0" value="${e != null ? e.l1 : ''}"
              oninput="validerInndata(${i}, 'l1')" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"/>
          </div>
          <div class="vs-deler">–</div>
          <div class="lag-boks">
            <div class="lag-navn" style="color:var(--white);font-weight:600">${escHtml(l2n)}</div>
            <input class="poeng-inndata" type="text" inputmode="numeric" pattern="[0-9]*" id="s${i}_l2"
              placeholder="0" value="${e != null ? e.l2 : ''}"
              oninput="validerInndata(${i}, 'l2')" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"/>
          </div>
        </div>
      </div>`;
    }

    // ── Dobbel-kamp: 2 vs 2 ──
    // Mix: hent lagnavnene fra Firestore-kampdata (riktig rekkefølge)
    const l1n = mixKamp
      ? `${mixKamp.lag1_s1_navn ?? '?'} + ${mixKamp.lag1_s2_navn ?? '?'}`
      : `${s[par.lag1[0]]?.navn ?? '?'} + ${s[par.lag1[1]]?.navn ?? '?'}`;
    const l2n = mixKamp
      ? `${mixKamp.lag2_s1_navn ?? '?'} + ${mixKamp.lag2_s2_navn ?? '?'}`
      : `${s[par.lag2[0]]?.navn ?? '?'} + ${s[par.lag2[1]]?.navn ?? '?'}`;
    const hvilerHTML = par.hviler != null && s[par.hviler]
      ? `<div style="text-align:center;font-size:14px;color:var(--orange);padding:6px 0 2px">💤 ${escHtml(s[par.hviler].navn)} hviler — får snittpoeng</div>`
      : '';
    const statusHTML = e != null
      ? `<div class="kamp-status lagret" id="kamp-status-${i}">✓ Lagret</div>`
      : `<div class="kamp-status" id="kamp-status-${i}"></div>`;
    return `<div class="kamp-kort" id="kk-${i}">
      <div class="kamp-hode">
        Kamp ${par.nr} <span class="kamp-merke">Americano</span>
        ${statusHTML}
      </div>
      ${hvilerHTML}
      <div class="lag-rad">
        <div class="lag-boks">
          <div class="lag-navn">${escHtml(l1n)}</div>
          <input class="poeng-inndata" type="text" inputmode="numeric" pattern="[0-9]*" id="s${i}_l1"
            placeholder="0" value="${e != null ? e.l1 : ''}"
            oninput="validerInndata(${i}, 'l1')" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"/>
        </div>
        <div class="vs-deler">–</div>
        <div class="lag-boks">
          <div class="lag-navn">${escHtml(l2n)}</div>
          <input class="poeng-inndata" type="text" inputmode="numeric" pattern="[0-9]*" id="s${i}_l2"
            placeholder="0" value="${e != null ? e.l2 : ''}"
            oninput="validerInndata(${i}, 'l2')" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"/>
        </div>
      </div>
    </div>`;
  }).join('');
  _naviger('poeng');
  oppdaterPoengNav();

  setTimeout(() => {
    for (let i = 0; i < parter.length; i++) {
      const el = document.getElementById(`s${i}_l1`);
      if (el && el.value === '') { el.focus(); break; }
    }
  }, 180);
}
window.apnePoenginput = apnePoenginput;
// Naviger til forrige/neste bane fra poengregistreringsskjermen.
// retning: -1 = forrige, +1 = neste
// Hvis neste og alle baner er ferdige: gå til resultater.
export function navigerBane(retning) {
  const baner     = app.baneOversikt ?? [];
  const gjeldende = app.aktivBane ?? 1;
  const idx       = baner.findIndex(b => b.baneNr === gjeldende);

  if (retning === -1) {
    // Forrige bane, eller tilbake til oversikt
    if (idx <= 0) { _naviger('baner'); return; }
    apnePoenginput(baner[idx - 1].baneNr);
  } else {
    // Sjekk om alle baner er ferdig — da: vis resultater
    const alleFerdig = baner.length > 0 && baner.every(bane => {
      if (erMix()) return kampStatusCache[`bane${bane.baneNr}_1`]?.ferdig === true;
      const n = bane?.spillere?.length ?? 0;
      if (bane?.erSingel || n === 2) return kampStatusCache[`bane${bane.baneNr}_1`]?.ferdig === true;
      const parter = (app.er6SpillerFormat && bane.erDobbel) ? PARTER_6_DOBBEL : getParter(n);
      return parter.every(p => kampStatusCache[`bane${bane.baneNr}_${p.nr}`]?.ferdig === true);
    });

    if (alleFerdig) {
      // Alle baner ferdig — gå til "se resultater"
      visNesteRundeModal();
      return;
    }

    if (idx >= baner.length - 1) {
      // Siste bane men ikke alle ferdig — gå tilbake til oversikt
      _naviger('baner');
      return;
    }
    apnePoenginput(baner[idx + 1].baneNr);
  }
}
window.navigerBane = navigerBane;
// Oppdater Forrige/Neste-knappene basert på gjeldende bane og status
export function oppdaterPoengNav() {
  const baner     = app.baneOversikt ?? [];
  const gjeldende = app.aktivBane ?? 1;
  const idx       = baner.findIndex(b => b.baneNr === gjeldende);

  const forrigeKnapp = document.getElementById('poeng-forrige-knapp');
  const nesteKnapp   = document.getElementById('poeng-neste-knapp');
  if (!forrigeKnapp || !nesteKnapp) return;

  // Forrige: alltid tilgjengelig (bane 1 → tilbake til oversikt)
  forrigeKnapp.textContent = idx <= 0 ? '← Oversikt' : `← Bane ${baner[idx - 1]?.baneNr}`;

  // Neste: sjekk om alle baner er ferdig
  const alleFerdig = baner.length > 0 && baner.every(bane => {
    if (erMix()) return kampStatusCache[`bane${bane.baneNr}_1`]?.ferdig === true;
    const n = bane?.spillere?.length ?? 0;
    if (bane?.erSingel || n === 2) return kampStatusCache[`bane${bane.baneNr}_1`]?.ferdig === true;
    const parter = (app.er6SpillerFormat && bane.erDobbel) ? PARTER_6_DOBBEL : getParter(n);
    return parter.every(p => kampStatusCache[`bane${bane.baneNr}_${p.nr}`]?.ferdig === true);
  });

  if (alleFerdig) {
    nesteKnapp.textContent = '🏁 Se resultater';
    nesteKnapp.className   = 'knapp knapp-gronn';
  } else if (idx >= baner.length - 1) {
    nesteKnapp.textContent = '← Tilbake til oversikt';
    nesteKnapp.className   = 'knapp knapp-omriss';
  } else {
    nesteKnapp.textContent = `Bane ${baner[idx + 1]?.baneNr} →`;
    nesteKnapp.className   = 'knapp knapp-primaer';
  }
}
window.oppdaterPoengNav = oppdaterPoengNav;
// ════════════════════════════════════════════════════════
// REDIGER BANEFORDELING (admin)
// ════════════════════════════════════════════════════════

// Lokal arbeidskopi mens editoren er åpen
let _redigerBaner = [];

export function apneRedigerBaner() {
  if (!app.treningId) return;
  _naviger && window.krevAdmin
    ? window.krevAdmin('Rediger baner', 'Kun administrator kan endre banefordeling.', _visRedigerModal)
    : _visRedigerModal();
}
window.apneRedigerBaner = apneRedigerBaner;

function _visRedigerModal() {
  // Dyp kopi av baneOversikt så vi ikke muterer app-state før lagring
  _redigerBaner = (app.baneOversikt ?? []).map(b => ({
    ...b,
    spillere: [...(b.spillere ?? [])],
  }));

  const modal = _byggRedigerModal();
  document.body.appendChild(modal);
  _oppdaterRedigerVisning();
}

function _lukkRedigerModal() {
  document.getElementById('modal-rediger-baner')?.remove();
  _redigerBaner = [];
}
window._lukkRedigerModal = _lukkRedigerModal;

function _byggRedigerModal() {
  const existing = document.getElementById('modal-rediger-baner');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'modal-rediger-baner';
  modal.style.cssText = `
    position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);
    display:flex;flex-direction:column;overflow-y:auto;padding:16px;box-sizing:border-box;
  `;
  modal.innerHTML = `
    <div style="max-width:560px;width:100%;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-size:20px;font-weight:700;color:var(--white)">✏️ Rediger banefordeling</div>
        <button onclick="_lukkRedigerModal()" style="background:none;border:1px solid var(--border);border-radius:8px;padding:6px 12px;color:var(--muted2);font-size:15px;cursor:pointer">✕ Avbryt</button>
      </div>
      <div id="rediger-baner-innhold"></div>
      <div id="rediger-feil" style="color:var(--red);font-size:14px;margin:8px 0;min-height:20px"></div>
      <button onclick="_lagreRedigerBaner()" class="knapp knapp-gronn" style="width:100%;margin-top:8px;font-size:17px">
        💾 Lagre ny banefordeling
      </button>
    </div>
  `;
  return modal;
}

function _oppdaterRedigerVisning() {
  const innhold = document.getElementById('rediger-baner-innhold');
  if (!innhold) return;

  innhold.innerHTML = _redigerBaner.map((bane, bi) => {
    const spillerHTML = (bane.spillere ?? []).map((s, si) => `
      <div class="rediger-spiller-rad" data-bane="${bi}" data-spiller="${si}"
           draggable="true"
           ondragstart="_dragStart(event,${bi},${si})"
           ondragover="event.preventDefault()"
           ondrop="_dragDrop(event,${bi},${si})"
           style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg2);border-radius:8px;margin-bottom:6px;cursor:grab;border:1px solid var(--border)">
        <span style="color:var(--muted);font-size:18px">⠿</span>
        <span style="flex:1;font-size:16px;color:var(--white)">${escHtml(s.navn ?? 'Ukjent')}</span>
        <span style="font-family:'DM Mono',monospace;font-size:13px;color:var(--muted2)">⭐ ${s.rating ?? STARTRATING}</span>
        <select onchange="_flyttSpiller(${bi},${si},this.value)"
                style="background:var(--bg3,#1a2740);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--white);font-size:13px;cursor:pointer">
          ${_redigerBaner.map((_, ti) => `<option value="${ti}" ${ti === bi ? 'selected' : ''}>Bane ${ti + 1}</option>`).join('')}
        </select>
      </div>
    `).join('');

    const antall = (bane.spillere ?? []).length;
    const gyldig = antall === 4 || antall === 5 || antall === 2;
    const fargeBord = gyldig ? 'var(--border)' : 'var(--red)';

    return `
      <div style="border:1px solid ${fargeBord};border-radius:12px;padding:14px;margin-bottom:14px;background:var(--bg1,#0a1628)"
           ondragover="event.preventDefault()"
           ondrop="_dragDropBane(event,${bi})">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="font-size:22px;font-weight:800;color:var(--accent2)">Bane ${bane.baneNr}</div>
          <div style="font-size:13px;color:${gyldig ? 'var(--muted2)' : 'var(--red)'}">${antall} spillere${!gyldig ? ' — ugyldig (trenger 4 eller 5)' : ''}</div>
        </div>
        ${spillerHTML}
      </div>
    `;
  }).join('');
}

// ── Dra og slipp ──────────────────────────────────────────────────────────────
let _dragFraBane = null;
let _dragFraSpiller = null;

window._dragStart = function(e, baneIdx, spillerIdx) {
  _dragFraBane    = baneIdx;
  _dragFraSpiller = spillerIdx;
  e.dataTransfer.effectAllowed = 'move';
};

window._dragDrop = function(e, tilBane, tilSpiller) {
  e.preventDefault();
  if (_dragFraBane === null) return;
  _byttSpillere(_dragFraBane, _dragFraSpiller, tilBane, tilSpiller);
  _dragFraBane = null;
};

window._dragDropBane = function(e, tilBane) {
  e.preventDefault();
  if (_dragFraBane === null || _dragFraBane === tilBane) return;
  const spiller = _redigerBaner[_dragFraBane].spillere.splice(_dragFraSpiller, 1)[0];
  _redigerBaner[tilBane].spillere.push(spiller);
  _dragFraBane = null;
  _oppdaterRedigerVisning();
};

function _byttSpillere(fraBane, fraSpiller, tilBane, tilSpiller) {
  if (fraBane === tilBane && fraSpiller === tilSpiller) return;
  const fra = _redigerBaner[fraBane].spillere;
  const til = _redigerBaner[tilBane].spillere;

  if (fraBane === tilBane) {
    // Bytt rekkefølge innen samme bane
    [fra[fraSpiller], fra[tilSpiller]] = [fra[tilSpiller], fra[fraSpiller]];
  } else {
    // Bytt spillere mellom to baner
    const temp = fra[fraSpiller];
    fra[fraSpiller] = til[tilSpiller];
    til[tilSpiller] = temp;
  }
  _oppdaterRedigerVisning();
}

// ── Velg bane fra dropdown ────────────────────────────────────────────────────
window._flyttSpiller = function(fraBane, fraSpiller, tilBane) {
  tilBane = parseInt(tilBane, 10);
  if (fraBane === tilBane) return;
  const spiller = _redigerBaner[fraBane].spillere.splice(fraSpiller, 1)[0];
  _redigerBaner[tilBane].spillere.push(spiller);
  _oppdaterRedigerVisning();
};

// ── Lagre til Firestore ───────────────────────────────────────────────────────
window._lagreRedigerBaner = async function() {
  const feilEl = document.getElementById('rediger-feil');

  // Valider at alle baner har 4 eller 5 spillere (eller 2 for singel)
  const ugyldig = _redigerBaner.find(b => {
    const n = b.spillere?.length ?? 0;
    if (b.erSingel) return n !== 2;
    return n !== 4 && n !== 5;
  });
  if (ugyldig) {
    if (feilEl) feilEl.textContent = `Bane ${ugyldig.baneNr} har feil antall spillere.`;
    return;
  }
  if (feilEl) feilEl.textContent = '';

  const lagreBtn = document.querySelector('#modal-rediger-baner .knapp-gronn');
  if (lagreBtn) { lagreBtn.disabled = true; lagreBtn.textContent = 'Lagrer…'; }

  try {
    // Slett eksisterende kamper for denne runden
    const eksisterendeSnap = await getDocs(query(
      collection(db, SAM.KAMPER),
      where('treningId', '==', app.treningId),
      where('rundeNr',   '==', app.runde),
    ));

    const batch = writeBatch(db);
    eksisterendeSnap.docs.forEach(d => batch.delete(d.ref));

    // Skriv nye kamper basert på redigert banefordeling
    _redigerBaner.forEach(bane => {
      const n = bane.spillere?.length ?? 0;
      const erSingel  = bane.erSingel === true || n === 2;
      const erDobbel6 = app.er6SpillerFormat && bane.erDobbel === true;

      if (erSingel && n === 2) {
        batch.set(doc(collection(db, SAM.KAMPER)), {
          treningId: app.treningId,
          baneNr:    `bane${bane.baneNr}`,
          rundeNr:   app.runde,
          kampNr:    1,
          erSingel:  true,
          lag1_s1: bane.spillere[0].id,  lag1_s2: null,
          lag2_s1: bane.spillere[1].id,  lag2_s2: null,
          lag1_s1_navn: bane.spillere[0].navn, lag1_s2_navn: null,
          lag2_s1_navn: bane.spillere[1].navn, lag2_s2_navn: null,
          lag1Poeng: null, lag2Poeng: null, ferdig: false,
        });
      } else {
        const parter = erDobbel6 ? PARTER_6_DOBBEL : getParter(n);
        parter.forEach(par => {
          const dokData = {
            treningId: app.treningId,
            baneNr:    `bane${bane.baneNr}`,
            rundeNr:   app.runde,
            kampNr:    par.nr,
            erSingel:  false,
            lag1_s1: bane.spillere[par.lag1[0]].id,  lag1_s2: bane.spillere[par.lag1[1]].id,
            lag2_s1: bane.spillere[par.lag2[0]].id,  lag2_s2: bane.spillere[par.lag2[1]].id,
            lag1_s1_navn: bane.spillere[par.lag1[0]].navn, lag1_s2_navn: bane.spillere[par.lag1[1]].navn,
            lag2_s1_navn: bane.spillere[par.lag2[0]].navn, lag2_s2_navn: bane.spillere[par.lag2[1]].navn,
            lag1Poeng: null, lag2Poeng: null, ferdig: false,
          };
          if (par.hviler != null && bane.spillere[par.hviler]) {
            dokData.hviler_id   = bane.spillere[par.hviler].id;
            dokData.hviler_navn = bane.spillere[par.hviler].navn;
          }
          batch.set(doc(collection(db, SAM.KAMPER)), dokData);
        });
      }
    });

    // Oppdater baneOversikt i treningsdokumentet
    batch.update(doc(db, SAM.TRENINGER, app.treningId), {
      baneOversikt:         _redigerBaner,
      sisteAktivitetDato:   serverTimestamp(),
    });

    await batch.commit();

    app.baneOversikt = _redigerBaner;
    kampStatusCache  = {};
    _lukkRedigerModal();
    visBaner();
    visMelding('Banefordeling oppdatert ✓');
  } catch (e) {
    console.error('[redigerBaner]', e);
    if (feilEl) feilEl.textContent = 'Lagring feilet: ' + (e?.message ?? e);
    if (lagreBtn) { lagreBtn.disabled = false; lagreBtn.textContent = '💾 Lagre ny banefordeling'; }
  }
};
