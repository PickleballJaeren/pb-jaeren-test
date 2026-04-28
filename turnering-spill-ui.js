// ════════════════════════════════════════════════════════
// turnering-spill-ui.js — Live-turneringsvisning
// Puljeskjerm, bracket, resultat-modal og sluttresultat.
// Ingen oppsett-logikk — det bor i turnering-ui.js.
//
// Avhengigheter fra turnering-ui.js løses via eksporterte
// hjelpefunksjoner: getAktivTurneringId(), navigerTurnering()
// og krevAdminTurnering().
// ════════════════════════════════════════════════════════

import { escHtml, visMelding } from './ui.js';
import { app } from './state.js';
import {
  T_STATUS,
  STANDARD_KAMPFORMAT,
  hentFormatForRunde,
  hentTurnering,
  registrerPuljeresultat,
  registrerWalkover,
  beregnPuljetabell,
  kvalifiserTilSluttspill,
  startSluttspill,
  registrerSluttspillResultat,
  oppdaterKampformat,
  nullstillNedstrømsKamper,
  beregnEndeligRangering,
  beregnFremgang,
  avsluttTurnering,
  validerResultat,
  beregnBestOf3,
} from './turnering.js';
import {
  getAktivTurneringId,
  navigerTurnering,
  krevAdminTurnering,
} from './turnering-ui.js';

// ════════════════════════════════════════════════════════
// PULJESKJERM — tabeller og kampregistrering
// ════════════════════════════════════════════════════════
export async function visPulje(turnering) {
  const t = turnering ?? await hentTurnering(getAktivTurneringId());
  app.aktivTurnering = t;

  document.getElementById('pulje-turnering-navn').textContent = t.navn;

  const fremgang = beregnFremgang(t.puljer);
  const fp = document.getElementById('pulje-fremgang');
  if (fp) {
    fp.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
        <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${fremgang.prosent}%;background:var(--green);border-radius:3px;transition:width .4s"></div>
        </div>
        <div style="font-size:14px;color:var(--muted2);flex-shrink:0">${fremgang.ferdig}/${fremgang.totalt} kamper</div>
      </div>`;
  }

  const lagMap = Object.fromEntries(t.lag.map(l => [l.id, l]));
  const innhold = document.getElementById('pulje-innhold');
  if (!innhold) return;

  innhold.innerHTML = (t.puljer ?? []).map(p => {
    const tabell = beregnPuljetabell(p, t.lag);
    const format = t.konfig?.kampformatPulje ?? STANDARD_KAMPFORMAT;
    return `
      <div class="seksjon-etikett">${escHtml(p.navn)}</div>
      <div class="kort"><div class="kort-innhold" style="padding:0">
        ${lagTabellHTML(tabell, lagMap)}
      </div></div>
      <div class="seksjon-etikett" style="margin-top:10px">Kamper — ${escHtml(p.navn)}</div>
      <div class="kort"><div class="kort-innhold" style="padding:0">
        ${_grupperKamperPerRunde(p.kamper ?? []).map(runde =>
          runde.kamper.map(k => kampRadHTML(k, p.id, lagMap, format)).join('')
        ).join('')}
      </div></div>`;
  }).join('');

  // Kvalifisering-boks
  const kvalBoks = document.getElementById('kvalifisering-boks');
  const tilKnapp = document.getElementById('til-sluttspill-knapp');

  const alleFerdig = (t.puljer ?? []).length > 0 &&
    (t.puljer ?? []).every(p => (p.kamper ?? []).every(k => k.ferdig));

  if (alleFerdig && t.status !== T_STATUS.PLAYOFFS && t.status !== T_STATUS.FINISHED) {
    if (kvalBoks) { kvalBoks.style.display = 'block'; visKvalifisering(t, lagMap); }
    if (tilKnapp) tilKnapp.style.display = 'block';
  } else {
    if (kvalBoks) kvalBoks.style.display = 'none';
    if (tilKnapp) tilKnapp.style.display = 'none';
  }
}

function _grupperKamperPerRunde(kamper) {
  const rundeMap = {};
  for (const k of kamper) {
    if (!rundeMap[k.runde]) rundeMap[k.runde] = { runde: k.runde, kamper: [] };
    rundeMap[k.runde].kamper.push(k);
  }
  return Object.values(rundeMap).sort((a, b) => a.runde - b.runde);
}

function lagTabellHTML(tabell, lagMap) {
  if (!tabell?.length) return '<div class="tom-tilstand-liten">Ingen lag i puljen.</div>';
  return `
    <table style="width:100%;border-collapse:collapse;font-size:15px">
      <thead><tr>
        <th class="th-venstre">#</th>
        <th class="th-venstre">Lag</th>
        <th class="th-center">K</th>
        <th class="th-center">S</th>
        <th class="th-center">T</th>
        <th class="th-center">+/-</th>
      </tr></thead>
      <tbody>
        ${tabell.map((r, i) => `
          <tr class="td-rad-skille">
            <td class="td-center" style="color:var(--muted2);font-size:13px">${i + 1}</td>
            <td class="td-venstre" style="font-weight:${i < 2 ? 600 : 400}">${escHtml(lagMap[r.lagId]?.navn ?? r.lagId)}</td>
            <td class="td-center" style="color:var(--muted2)">${r.kamper}</td>
            <td class="td-center" style="color:var(--green2);font-weight:600">${r.seire}</td>
            <td class="td-center" style="color:var(--red2)">${r.tap}</td>
            <td class="td-center" style="color:${r.pd >= 0 ? 'var(--green2)' : 'var(--red2)'}">${r.pd > 0 ? '+' : ''}${r.pd}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function kampRadHTML(kamp, puljeId, lagMap, format) {
  const l1 = lagMap[kamp.lag1Id]?.navn ?? '?';
  const l2 = lagMap[kamp.lag2Id]?.navn ?? '?';
  const l1Vant = kamp.ferdig && kamp.lag1Poeng > kamp.lag2Poeng;
  const l2Vant = kamp.ferdig && kamp.lag2Poeng > kamp.lag1Poeng;
  const typeLabel = format.type === 'best_of_3' ? 'B3' : '1G';
  const poeng = format.points_to_win;
  const erOverstyrt = kamp.format != null;

  return `
    <div class="kamp-rad" style="opacity:${kamp.walkover ? 0.6 : 1}">
      <div style="flex:1;min-width:0">
        <div class="kamp-lag-${l1Vant ? 'vinner' : 'taper'}" style="font-size:16px">${escHtml(l1)}</div>
        <div class="kamp-lag-${l2Vant ? 'vinner' : 'taper'}" style="font-size:16px">${escHtml(l2)}</div>
        <div style="font-size:12px;color:var(--muted2);margin-top:4px">
          ${typeLabel} · ${poeng} pts${erOverstyrt ? ' ✎' : ''}
          ${kamp.walkover ? ' · walkover' : ''}
        </div>
      </div>
      ${kamp.ferdig
        ? `<div class="poeng-kolonne"><span>${kamp.lag1Poeng}</span><span>${kamp.lag2Poeng}</span></div>`
        : `<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
             <button class="t-rediger-knapp" onclick="apneResultatModal('${escHtml(puljeId)}','${escHtml(kamp.id)}','${escHtml(kamp.lag1Id)}','${escHtml(kamp.lag2Id)}')">✏️</button>
             <button class="knapp knapp-omriss knapp-liten" onclick="apneResultatModal('${escHtml(puljeId)}','${escHtml(kamp.id)}','${escHtml(kamp.lag1Id)}','${escHtml(kamp.lag2Id)}')">Registrer</button>
           </div>`
      }
    </div>`;
}

function visKvalifisering(t, lagMap) {
  const boks = document.getElementById('kvalifisering-boks');
  if (!boks) return;
  try {
    const kval = kvalifiserTilSluttspill(t);
    const render = (ids, tittel, farge) => {
      if (!ids?.length) return '';
      return `<div style="margin-bottom:12px">
        <div style="font-size:13px;font-weight:600;color:${farge};margin-bottom:6px">${tittel}</div>
        ${ids.map((id, i) => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="font-family:'DM Mono',monospace;font-size:13px;color:var(--muted2);width:20px">${i + 1}.</span>
            <span style="font-size:15px">${escHtml(lagMap[id]?.navn ?? id)}</span>
          </div>`).join('')}
      </div>`;
    };
    boks.innerHTML = `
      <div class="seksjon-etikett">Kvalifisering til sluttspill</div>
      <div class="kort"><div class="kort-innhold">
        ${render(kval.A, '🥇 A-sluttspill (plass 1–8)', 'var(--yellow)')}
        ${render(kval.B, '🥈 B-sluttspill (plass 9–16)', 'var(--accent2)')}
        ${render(kval.C, '🥉 C-sluttspill (plass 17+)', 'var(--muted2)')}
      </div></div>`;
  } catch (e) {
    boks.innerHTML = `<div style="color:var(--red2);font-size:15px">${escHtml(e.message)}</div>`;
  }
}

// ════════════════════════════════════════════════════════
// RESULTAT-MODAL — registrer kampresultat
// Støtter både single game og best av 3.
// ════════════════════════════════════════════════════════

// ── Modal-state ──────────────────────────────────────────
let _modalPuljeId  = null;
let _modalKampId   = null;
let _modalLag1Id   = null;
let _modalLag2Id   = null;
let _modalNivaa    = null;   // null = pulje | 'A' | 'B' | 'C'
let _modalFormat   = null;

// ── Best av 3 state ──────────────────────────────────────
let _games         = [null, null, null]; // [{l1, l2}, ...]
let _aktivGame     = 0;                  // 0-indeksert
let _tAktivLag     = 1;
let _tMaxPoeng     = 15;

// ════════════════════════════════════════════════════════
// ÅPNE / LUKK
// ════════════════════════════════════════════════════════
window.apneResultatModal = function(puljeEllerNivaa, kampId, lag1Id, lag2Id, erSluttspill = false) {
  _modalPuljeId = erSluttspill ? null : puljeEllerNivaa;
  _modalNivaa   = erSluttspill ? puljeEllerNivaa : null;
  _modalKampId  = kampId;
  _modalLag1Id  = lag1Id;
  _modalLag2Id  = lag2Id;

  const t      = app.aktivTurnering;
  const lagMap = Object.fromEntries((t?.lag ?? []).map(l => [l.id, l]));

  if (erSluttspill) {
    const kamp  = t?.sluttspill?.[puljeEllerNivaa]?.kamper?.find(k => k.id === kampId);
    _modalFormat = hentFormatForRunde(kamp?.runde ?? '', t?.konfig ?? {}, kamp?.format ?? null);
  } else {
    _modalFormat = t?.konfig?.kampformatPulje ?? STANDARD_KAMPFORMAT;
  }

  _tMaxPoeng = _modalFormat.max_points ?? 15;

  // Nullstill game-state
  _games     = [null, null, null];
  _aktivGame = 0;
  _tAktivLag = 1;

  // Sett lagnavn og format-tekst
  document.getElementById('modal-resultat-lag1').textContent = lagMap[lag1Id]?.navn ?? 'Lag 1';
  document.getElementById('modal-resultat-lag2').textContent = lagMap[lag2Id]?.navn ?? 'Lag 2';
  document.getElementById('modal-resultat-format').textContent =
    `${_modalFormat.type === 'best_of_3' ? 'Best av 3 · ' : ''}Til ${_modalFormat.points_to_win} · maks ${_modalFormat.max_points}`;
  document.getElementById('modal-resultat-feil').textContent = '';

  _tBygTallgrid(_tMaxPoeng);
  _tOppdaterModalUI();

  document.getElementById('modal-resultat').style.display = 'flex';
};

window.lukkResultatModal = function() {
  document.getElementById('modal-resultat').style.display = 'none';
};

// ════════════════════════════════════════════════════════
// UI-OPPDATERING
// ════════════════════════════════════════════════════════

/** Oppdaterer hele modalen basert på gjeldende game-state. */
function _tOppdaterModalUI() {
  const erB3 = _modalFormat?.type === 'best_of_3';

  // Game-indikatorer
  const indEl = document.getElementById('t-game-indikatorer');
  if (indEl) {
    if (erB3) {
      const stilling = beregnBestOf3(_games.filter(Boolean));
      indEl.style.display = 'flex';
      indEl.innerHTML = [0, 1, 2].map(i => {
        const g = _games[i];
        let klasse = 'game-sirkel';
        if (g) klasse += g.l1 > g.l2 ? ' game-vunnet-lag1' : ' game-vunnet-lag2';
        else if (i === _aktivGame) klasse += ' game-aktiv';
        return `<span class="${klasse}"></span>`;
      }).join('');

      // Stillingsdisplay
      const stEl = document.getElementById('t-game-stilling');
      if (stEl) {
        stEl.style.display = 'block';
        stEl.textContent = `${stilling.lag1Seire} – ${stilling.lag2Seire}`;
      }
    } else {
      indEl.style.display = 'none';
      const stEl = document.getElementById('t-game-stilling');
      if (stEl) stEl.style.display = 'none';
    }
  }

  // Poengvisning for aktivt game
  const game = _games[_aktivGame] ?? {};
  const p1El = document.getElementById('t-poeng-vis-1');
  const p2El = document.getElementById('t-poeng-vis-2');
  if (p1El) p1El.textContent = game.l1 != null ? String(game.l1) : '—';
  if (p2El) p2El.textContent = game.l2 != null ? String(game.l2) : '—';

  // Lag-indikator
  _tSettAktivLagUI(_tAktivLag);

  // LAGRE-knapp — synlig kun når kampen er ferdig
  const lagreKnapp = document.querySelector('#modal-resultat .knapp-gronn');
  if (lagreKnapp) {
    if (erB3) {
      const stilling = beregnBestOf3(_games.filter(Boolean));
      lagreKnapp.disabled = !stilling.ferdig;
      lagreKnapp.style.opacity = stilling.ferdig ? '1' : '0.4';
    } else {
      const g = _games[0] ?? {};
      lagreKnapp.disabled = g.l1 == null || g.l2 == null;
      lagreKnapp.style.opacity = (g.l1 != null && g.l2 != null) ? '1' : '0.4';
    }
  }

  _tFremhevValgte();
}

function _tSettAktivLagUI(lag) {
  _tAktivLag = lag;
  const el1  = document.getElementById('t-aktiv-lag1');
  const el2  = document.getElementById('t-aktiv-lag2');
  if (el1) {
    el1.style.border     = lag === 1 ? '2px solid var(--accent)' : '1px solid var(--border2)';
    el1.style.color      = lag === 1 ? 'var(--accent)' : 'var(--muted2)';
    el1.style.fontWeight = lag === 1 ? '600' : '400';
  }
  if (el2) {
    el2.style.border     = lag === 2 ? '2px solid var(--accent)' : '1px solid var(--border2)';
    el2.style.color      = lag === 2 ? 'var(--accent)' : 'var(--muted2)';
    el2.style.fontWeight = lag === 2 ? '600' : '400';
  }
}

function _tBygTallgrid(maks) {
  const grid = document.getElementById('t-tall-grid');
  if (!grid) return;
  grid.innerHTML = Array.from({ length: maks + 1 }, (_, i) => i)
    .map(n => `<button class="t-tall-knapp" data-verdi="${n}" onclick="tVelgPoeng(${n})">${n}</button>`)
    .join('');
}

function _tFremhevValgte() {
  const game = _games[_aktivGame] ?? {};
  const valgt = _tAktivLag === 1 ? game.l1 : game.l2;
  document.querySelectorAll('.t-tall-knapp').forEach(b => {
    b.classList.toggle('aktiv', Number(b.dataset.verdi) === valgt);
  });
}

// ════════════════════════════════════════════════════════
// POENGVALG
// ════════════════════════════════════════════════════════
window.tSettAktivLag = function(lag) {
  _tAktivLag = lag;
  _tOppdaterModalUI();
};

window.tVelgPoeng = function(verdi) {
  // Sett poeng for aktivt lag i aktivt game
  if (!_games[_aktivGame]) _games[_aktivGame] = { l1: null, l2: null };
  if (_tAktivLag === 1) _games[_aktivGame].l1 = verdi;
  else                  _games[_aktivGame].l2 = verdi;

  const game = _games[_aktivGame];
  const beggeValgt = game.l1 != null && game.l2 != null;

  if (beggeValgt) {
    if (_modalFormat?.type === 'best_of_3') {
      // Valider dette gamet
      const val = validerResultat(game.l1, game.l2, _modalFormat);
      if (!val.ok) {
        document.getElementById('modal-resultat-feil').textContent = val.feil;
        // Nullstill det ugyldige gamet
        _games[_aktivGame] = null;
        _tAktivLag = 1;
        _tOppdaterModalUI();
        return;
      }
      document.getElementById('modal-resultat-feil').textContent = '';

      // Sjekk stilling — er kampen avgjort?
      const fullteGames = _games.filter(Boolean);
      const stilling    = beregnBestOf3(fullteGames);

      if (stilling.ferdig) {
        // Kampen er ferdig — aktiver LAGRE
        _tOppdaterModalUI();
      } else {
        // Gå til neste game automatisk
        const nesteGame = _aktivGame + 1;
        if (nesteGame < 3) {
          _aktivGame = nesteGame;
          _tAktivLag = 1;
          _tOppdaterModalUI();
        }
      }
    } else {
      // Single game — bytt til lag 2 hvis lag 1 nettopp valgte
      if (_tAktivLag === 1) {
        _tAktivLag = 2;
      }
      _tOppdaterModalUI();
    }
  } else {
    // Bare ett lag har valgt — bytt til det andre
    _tAktivLag = _tAktivLag === 1 ? 2 : 1;
    _tOppdaterModalUI();
  }
};

// ════════════════════════════════════════════════════════
// LAGRE
// ════════════════════════════════════════════════════════
window.bekreftResultat = async function() {
  const erB3     = _modalFormat?.type === 'best_of_3';
  const feilEl   = document.getElementById('modal-resultat-feil');
  const lagreBtn = document.querySelector('#modal-resultat .knapp-gronn');

  let lag1Poeng, lag2Poeng, games = null;

  if (erB3) {
    const fullteGames = _games.filter(Boolean);
    const stilling    = beregnBestOf3(fullteGames);
    if (!stilling.ferdig) {
      feilEl.textContent = 'Kampen er ikke ferdig ennå.';
      return;
    }
    games     = fullteGames;
    lag1Poeng = stilling.lag1Seire;
    lag2Poeng = stilling.lag2Seire;
  } else {
    const game = _games[0];
    if (!game || game.l1 == null || game.l2 == null) {
      feilEl.textContent = 'Velg poeng for begge lag.';
      return;
    }
    const val = validerResultat(game.l1, game.l2, _modalFormat);
    if (!val.ok) { feilEl.textContent = val.feil; return; }
    lag1Poeng = game.l1;
    lag2Poeng = game.l2;
  }

  if (lagreBtn) lagreBtn.disabled = true;
  feilEl.textContent = '';

  try {
    const id = getAktivTurneringId();
    const t  = app.aktivTurnering;
    if (_modalNivaa) {
      const oppdatert = await registrerSluttspillResultat(id, _modalNivaa, _modalKampId, lag1Poeng, lag2Poeng, games);
      app.aktivTurnering = { ...t, sluttspill: oppdatert };
      lukkResultatModal();
      visBracket(app.aktivTurnering);
    } else {
      await registrerPuljeresultat(id, _modalPuljeId, _modalKampId, lag1Poeng, lag2Poeng, games);
      const oppdatert = await hentTurnering(id);
      app.aktivTurnering = oppdatert;
      lukkResultatModal();
      visPulje(oppdatert);
    }
  } catch (e) {
    feilEl.textContent = e?.message ?? 'Feil ved lagring.';
  } finally {
    if (lagreBtn) lagreBtn.disabled = false;
  }
};

window.registrerWalkoverUI = async function() {
  if (!_modalKampId || (!_modalPuljeId && !_modalNivaa)) return;
  krevAdminTurnering('Walkover', 'Bekreft walkover — motstanderen tildeles seier.', async () => {
    try {
      const id = getAktivTurneringId();
      await registrerWalkover(id, _modalPuljeId, _modalKampId, _modalLag2Id);
      const oppdatert = await hentTurnering(id);
      app.aktivTurnering = oppdatert;
      lukkResultatModal();
      visPulje(oppdatert);
    } catch (e) {
      visMelding(e?.message ?? 'Feil.', 'feil');
    }
  });
};
// ════════════════════════════════════════════════════════
// BRACKET-SKJERM
// ════════════════════════════════════════════════════════
export async function visBracket(turnering) {
  const t = turnering ?? await hentTurnering(getAktivTurneringId());
  app.aktivTurnering = t;

  document.getElementById('bracket-turnering-navn').textContent = t.navn;

  const lagMap    = Object.fromEntries(t.lag.map(l => [l.id, l]));
  const container = document.getElementById('bracket-innhold');
  if (!container) return;

  const aKamper = t.sluttspill?.A?.kamper ?? [];
  const bKamper = t.sluttspill?.B?.kamper ?? [];
  const cKamper = t.sluttspill?.C?.kamper ?? [];

  container.innerHTML = [
    aKamper.length ? bracketNivaaHTML('🥇 A-sluttspill', 'var(--yellow)',   aKamper, lagMap, 'A') : '',
    bKamper.length ? bracketNivaaHTML('🥈 B-sluttspill', 'var(--accent2)',  bKamper, lagMap, 'B') : '',
    cKamper.length ? bracketNivaaHTML('🥉 C-sluttspill', 'var(--muted2)',   cKamper, lagMap, 'C') : '',
  ].filter(Boolean).join('');

  const avsluttKnapp = document.getElementById('avslutt-turnering-knapp');
  if (avsluttKnapp) avsluttKnapp.style.display = erAltFerdig(t) ? 'block' : 'none';
}

function bracketNivaaHTML(tittel, farge, kamper, lagMap, nivaa) {
  const runder = grupperKamperIRunder(kamper);
  return `
    <div class="seksjon-etikett" style="color:${farge}">${tittel}</div>
    <div class="kort"><div class="kort-innhold" style="padding:8px 0">
      <div style="display:flex;gap:16px;overflow-x:auto;padding:4px 8px">
        ${runder.map(r => bracketRundeHTML(r, lagMap, nivaa, farge)).join('')}
      </div>
    </div></div>`;
}

function grupperKamperIRunder(kamper) {
  const rundeRekkefølge = ['Åttedelsfinale', 'Kvartfinale', 'Plass 5–8', 'Semifinale', '3. plass', '5. plass', '7. plass', '1. plass', 'Finale', '9. plass', '17. plass'];
  const rundeMap = {};
  for (const k of kamper) {
    if (!rundeMap[k.runde]) rundeMap[k.runde] = [];
    rundeMap[k.runde].push(k);
  }
  return Object.entries(rundeMap)
    .sort(([a], [b]) => {
      const ia = rundeRekkefølge.indexOf(a);
      const ib = rundeRekkefølge.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map(([runde, kamper]) => ({ runde, kamper }));
}

function bracketRundeHTML(runde, lagMap, nivaa, farge) {
  return `
    <div class="bracket-kolonne">
      <div class="bracket-runde-tittel" style="color:${farge}">${escHtml(runde.runde)}</div>
      ${runde.kamper.map(k => bracketKampHTML(k, lagMap, nivaa)).join('')}
    </div>`;
}

function bracketKampHTML(kamp, lagMap, nivaa) {
  const l1     = lagMap[kamp.lag1Id]?.navn ?? (kamp.lag1Id ? '?' : 'TBD');
  const l2     = lagMap[kamp.lag2Id]?.navn ?? (kamp.lag2Id ? '?' : 'TBD');
  const v1     = kamp.ferdig && kamp.lag1Poeng > kamp.lag2Poeng;
  const v2     = kamp.ferdig && kamp.lag2Poeng > kamp.lag1Poeng;
  const kanReg = kamp.lag1Id && kamp.lag2Id && !kamp.ferdig;

  return `
    <div class="kamp-rad" style="margin-bottom:8px;cursor:${kanReg ? 'pointer' : 'default'}"
      ${kanReg ? `onclick="apneResultatModal('${nivaa}','${escHtml(kamp.id)}','${escHtml(kamp.lag1Id)}','${escHtml(kamp.lag2Id)}',true)"` : ''}>
      <div style="flex:1;min-width:0">
        <div class="kamp-lag-${v1 ? 'vinner' : 'taper'}" style="font-size:15px">${escHtml(l1)}</div>
        <div class="kamp-lag-${v2 ? 'vinner' : 'taper'}" style="font-size:15px;margin-top:4px">${escHtml(l2)}</div>
      </div>
      ${kamp.ferdig
        ? `<div class="poeng-kolonne" style="font-size:18px"><span>${kamp.lag1Poeng}</span><span>${kamp.lag2Poeng}</span></div>`
        : kanReg ? `<div style="font-size:20px;color:var(--muted2)">✏️</div>` : ''
      }
    </div>
    ${kamp.ferdig
      ? `<div style="text-align:right;margin-bottom:4px">
           <button class="knapp-tekst" style="font-size:12px;color:var(--muted2)" onclick="redigerSluttspillKamp('${nivaa}','${escHtml(kamp.id)}')">Rediger</button>
         </div>` : ''}`;
}

function erAltFerdig(t) {
  const sjekkBracket = (kamper) => kamper.length > 0 && kamper.every(k => k.ferdig);
  return sjekkBracket(t.sluttspill?.A?.kamper ?? []) &&
    (!t.sluttspill?.B?.kamper?.length || sjekkBracket(t.sluttspill.B.kamper)) &&
    (!t.sluttspill?.C?.kamper?.length || sjekkBracket(t.sluttspill.C.kamper));
}

window.redigerSluttspillKamp = function(nivaa, kampId) {
  krevAdminTurnering('Rediger kamp', 'PIN kreves for å redigere et ferdig resultat.', () => {
    const t    = app.aktivTurnering;
    const kamp = t?.sluttspill?.[nivaa]?.kamper?.find(k => k.id === kampId);
    if (!kamp) return;
    document.getElementById('rediger-advarsel-boks').style.display = 'block';
    document.getElementById('rediger-advarsel-boks').dataset.nivaa  = nivaa;
    document.getElementById('rediger-advarsel-boks').dataset.kampId = kampId;
  });
};

window.lukkRedigerAdvarsel = function() {
  const boks = document.getElementById('rediger-advarsel-boks');
  if (boks) boks.style.display = 'none';
};

window.bekreftRediger = async function() {
  const boks   = document.getElementById('rediger-advarsel-boks');
  const nivaa  = boks?.dataset?.nivaa;
  const kampId = boks?.dataset?.kampId;
  if (!nivaa || !kampId) return;
  lukkRedigerAdvarsel();
  try {
    const id = getAktivTurneringId();
    await nullstillNedstrømsKamper(id, nivaa, kampId);
    const oppdatert = await hentTurnering(id);
    app.aktivTurnering = oppdatert;
    const kamp = oppdatert.sluttspill?.[nivaa]?.kamper?.find(k => k.id === kampId);
    if (kamp) apneResultatModal(nivaa, kampId, kamp.lag1Id, kamp.lag2Id, true);
    visBracket(oppdatert);
  } catch (e) {
    visMelding(e?.message ?? 'Feil.', 'feil');
  }
};

function _finnNedstrøms(kampId, alleKamper) {
  const resultat = [];
  const kamp = alleKamper.find(k => k.id === kampId);
  if (!kamp) return resultat;
  if (kamp.winner_to) resultat.push(..._finnNedstrøms(kamp.winner_to, alleKamper));
  if (kamp.loser_to)  resultat.push(..._finnNedstrøms(kamp.loser_to,  alleKamper));
  resultat.push(kampId);
  return resultat;
}

window.tilSluttspillUI = function() {
  krevAdminTurnering('Start sluttspill', 'PIN kreves for å starte sluttspill.', async () => {
    try {
      const id        = getAktivTurneringId();
      const sluttspill = await startSluttspill(id);
      const oppdatert  = await hentTurnering(id);
      app.aktivTurnering = oppdatert;
      navigerTurnering('turnering-pulje', 'turnering-bracket');
      visBracket(oppdatert);
    } catch (e) {
      visMelding(e?.message ?? 'Feil ved start av sluttspill.', 'feil');
    }
  });
};

window.avsluttTurneringUI = function() {
  krevAdminTurnering('Avslutt turnering', 'PIN kreves for å avslutte turneringen.', async () => {
    try {
      const id         = getAktivTurneringId();
      const rangering  = await avsluttTurnering(id);
      const oppdatert  = await hentTurnering(id);
      app.aktivTurnering = oppdatert;
      navigerTurnering('turnering-bracket', 'turnering-resultat');
      visResultat(oppdatert, rangering);
    } catch (e) {
      visMelding(e?.message ?? 'Feil ved avslutning.', 'feil');
    }
  });
};

// ════════════════════════════════════════════════════════
// SLUTTRESULTAT
// ════════════════════════════════════════════════════════
export async function visResultat(turnering, rangeringOverstyr = null) {
  const t         = turnering ?? await hentTurnering(getAktivTurneringId());
  const rangering = rangeringOverstyr ?? beregnEndeligRangering(t);

  document.getElementById('resultat-turnering-navn').textContent = t.navn;

  const lagMap  = Object.fromEntries((t.lag ?? []).map(l => [l.id, l]));
  const innhold = document.getElementById('t-resultat-innhold');
  if (!innhold) return;

  const plassFarge = (p) => p === 1 ? 'var(--yellow)' : p === 2 ? 'var(--muted2)' : p === 3 ? '#cd7f32' : 'var(--muted2)';
  const hentNavn   = (r) => r.lag?.navn ?? lagMap[r.lagId]?.navn ?? r.lagId ?? '?';

  innhold.innerHTML = `
    <div class="kort"><div class="kort-innhold" style="padding:0">
      ${rangering.map(r => `
        <div class="lb-rad" style="padding:14px 16px">
          <div style="font-family:'Bebas Neue',cursive;font-size:28px;color:${plassFarge(r.plass)};width:36px;flex-shrink:0">${r.plass}</div>
          <div style="flex:1;font-size:17px;font-weight:${r.plass <= 3 ? 600 : 400}">${escHtml(hentNavn(r))}</div>
          <div style="font-size:20px">${r.plass === 1 ? '🏆' : r.plass === 2 ? '🥈' : r.plass === 3 ? '🥉' : ''}</div>
        </div>`).join('')}
    </div></div>`;
}
