// ════════════════════════════════════════════════════════
// turnering-ui.js — Turneringsmodul UI
// Alle skjermvisninger og HTML-generering for turneringer.
// Ingen Firestore-logikk — kaller turnering.js for data.
// ════════════════════════════════════════════════════════

import { escHtml, visMelding, visFBFeil } from './ui.js';
import { app } from './state.js';
import {
  T_STATUS, SEEDING_MODUS, STANDARD_KAMPFORMAT,
  hentAktiveTurneringer, hentAlleTurneringer, hentTurnering,
  opprettTurnering, leggTilLag, fjernLag, oppdaterLagNavn, flyttLag,
  genererPuljer, lagrePuljer, startPuljespill,
  registrerPuljeresultat, registrerWalkover,
  beregnPuljetabell, kvalifiserTilSluttspill,
  startSluttspill, registrerSluttspillResultat,
  beregnEndeligRangering, beregnFremgang,
  avsluttTurnering, slettTurnering,
  validerResultat, startnivaa,
} from './turnering.js';

// ── Avhengigheter injisert fra app.js ────────────────────
let _naviger    = () => {};
let _krevAdmin  = () => {};

export function turneringUIInit(deps) {
  _naviger    = deps.naviger;
  _krevAdmin  = deps.krevAdmin;
}

// Aktiv turnering-ID i denne økten
let _aktivTurneringId = null;

export function getAktivTurneringId() { return _aktivTurneringId; }
export function setAktivTurneringId(id) { _aktivTurneringId = id; }

// ════════════════════════════════════════════════════════
// OVERSIKTSKJERM — liste over turneringer
// ════════════════════════════════════════════════════════
export async function visTurneringOversikt() {
  const container = document.getElementById('turnering-liste');
  const laster    = document.getElementById('turnering-laster');
  if (!container) return;

  if (laster) laster.style.display = 'flex';
  container.innerHTML = '';

  try {
    const turneringer = await hentAlleTurneringer();

    if (laster) laster.style.display = 'none';

    if (!turneringer.length) {
      container.innerHTML = `
        <div style="text-align:center;padding:40px 0;color:var(--muted2)">
          <div style="font-size:48px;margin-bottom:12px">🏆</div>
          <div style="font-size:18px">Ingen turneringer ennå</div>
          <div style="font-size:15px;margin-top:6px;color:var(--muted)">Opprett en ny for å komme i gang</div>
        </div>`;
      return;
    }

    container.innerHTML = turneringer.map(t => lagTurneringKort(t)).join('');
  } catch (e) {
    if (laster) laster.style.display = 'none';
    visFBFeil('Kunne ikke laste turneringer: ' + (e?.message ?? e));
  }
}

function lagTurneringKort(t) {
  const statusInfo = _statusInfo(t.status);
  const dato       = t.opprettet?.toDate
    ? t.opprettet.toDate().toLocaleDateString('no-NO', { day:'numeric', month:'short', year:'numeric' })
    : '';
  const antallLag  = (t.lag ?? []).length;

  return `
    <div class="kort" style="cursor:pointer;margin-bottom:12px" onclick="apneTurnering('${escHtml(t.id)}')">
      <div class="kort-innhold">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-family:'Bebas Neue',cursive;font-size:22px;letter-spacing:1px">${escHtml(t.navn)}</div>
          <span class="t-status-merke ${statusInfo.kl}">${statusInfo.tekst}</span>
        </div>
        <div style="display:flex;gap:16px;font-size:15px;color:var(--muted2)">
          <span>🏐 ${antallLag} lag</span>
          <span>📅 ${dato}</span>
          ${t.konfig?.antallPuljer ? `<span>🔢 ${t.konfig.antallPuljer} puljer</span>` : ''}
        </div>
      </div>
    </div>`;
}

function _statusInfo(status) {
  const map = {
    [T_STATUS.SETUP]:           { kl: 'ts-setup',      tekst: 'Oppsett'     },
    [T_STATUS.GROUP_PLAY]:      { kl: 'ts-aktiv',      tekst: 'Puljespill'  },
    [T_STATUS.PLAYOFF_SEEDING]: { kl: 'ts-seeding',    tekst: 'Seeding'     },
    [T_STATUS.PLAYOFFS]:        { kl: 'ts-aktiv',      tekst: 'Sluttspill'  },
    [T_STATUS.FINISHED]:        { kl: 'ts-ferdig',     tekst: 'Ferdig'      },
  };
  return map[status] ?? { kl: '', tekst: status };
}

window.apneTurnering = async function(id) {
  _aktivTurneringId = id;
  try {
    const t = await hentTurnering(id);
    app.aktivTurnering = t;
    switch (t.status) {
      case T_STATUS.SETUP:           _naviger('turnering-oppsett'); visOppsett(t);   break;
      case T_STATUS.GROUP_PLAY:      _naviger('turnering-pulje');   visPulje(t);     break;
      case T_STATUS.PLAYOFF_SEEDING: _naviger('turnering-pulje');   visPulje(t);     break;
      case T_STATUS.PLAYOFFS:        _naviger('turnering-bracket'); visBracket(t);   break;
      case T_STATUS.FINISHED:        _naviger('turnering-resultat'); visResultat(t); break;
      default:                       _naviger('turnering-oppsett'); visOppsett(t);
    }
  } catch (e) {
    visFBFeil('Kunne ikke åpne turnering: ' + (e?.message ?? e));
  }
};

// ════════════════════════════════════════════════════════
// NY TURNERING — modal
// ════════════════════════════════════════════════════════
window.visNyTurneringModal = function() {
  document.getElementById('modal-ny-turnering').style.display = 'flex';
  const inp = document.getElementById('ny-turnering-navn');
  if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 200); }
  // Reset til defaults
  document.querySelectorAll('.t-puljer-velger .t-velger-knapp').forEach((b,i) => {
    b.classList.toggle('aktiv', i === 0); // 2 puljer default
  });
};
window.lukkNyTurneringModal = function() {
  document.getElementById('modal-ny-turnering').style.display = 'none';
};

window.bekreftNyTurnering = async function() {
  const navn         = document.getElementById('ny-turnering-navn')?.value?.trim();
  const antallPuljer = parseInt(document.querySelector('.t-puljer-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? '2');
  const seedingModus = document.querySelector('.t-seeding-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? SEEDING_MODUS.STANDARD;
  const plasseringA  = document.getElementById('toggle-plasseringskamper-a')?.checked !== false;
  const plasseringBC = document.getElementById('toggle-plasseringskamper-bc')?.checked === true;

  if (!navn) { visMelding('Skriv inn turneringsnavn.', 'advarsel'); return; }

  try {
    const id = await opprettTurnering({ navn, antallPuljer, seedingModus, plasseringskamperA: plasseringA, plasseringskamperBC: plasseringBC });
    lukkNyTurneringModal();
    visMelding('Turnering opprettet!');
    await apneTurnering(id);
  } catch (e) {
    visMelding(e?.message ?? 'Kunne ikke opprette turnering.', 'feil');
  }
};

// ════════════════════════════════════════════════════════
// OPPSETT-SKJERM — lag og puljer
// ════════════════════════════════════════════════════════
export async function visOppsett(turnering) {
  const t = turnering ?? await hentTurnering(_aktivTurneringId);
  app.aktivTurnering = t;

  document.getElementById('oppsett-turnering-navn').textContent = t.navn;
  oppdaterLagListe(t);
  oppdaterPuljePreview(t);
  oppdaterOppsettKnapper(t);
}

function oppdaterLagListe(t) {
  const liste = document.getElementById('turnering-lag-liste');
  if (!liste) return;

  if (!t.lag?.length) {
    liste.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted2);font-size:15px">Ingen lag lagt til ennå</div>`;
    return;
  }

  liste.innerHTML = t.lag.map((l, i) => `
    <div class="t-lag-element" data-id="${escHtml(l.id)}">
      <div class="t-lag-seed">${i + 1}</div>
      <div class="t-lag-navn" onclick="redigerLagNavn('${escHtml(l.id)}')" title="Klikk for å redigere">${escHtml(l.navn)}</div>
      <button class="t-lag-fjern" onclick="fjernLagUI('${escHtml(l.id)}')" title="Fjern lag">✕</button>
    </div>`).join('');

  document.getElementById('turnering-lag-teller').textContent = `${t.lag.length} lag`;
}

function oppdaterPuljePreview(t) {
  const container = document.getElementById('pulje-preview');
  if (!container || !t.lag?.length) return;

  const antall  = t.konfig?.antallPuljer ?? 2;
  if (t.lag.length < antall * 2) {
    container.innerHTML = `<div style="color:var(--muted2);font-size:15px">Legg til minst ${antall * 2} lag for ${antall} puljer</div>`;
    return;
  }

  try {
    const puljer = genererPuljer(t.lag, antall);
    const lagMap = Object.fromEntries(t.lag.map(l => [l.id, l]));

    container.innerHTML = puljer.map(p => `
      <div style="margin-bottom:14px">
        <div class="seksjon-etikett" style="margin-bottom:8px">${escHtml(p.navn)}</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${p.lagIds.map((id, i) => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--navy3);border:1px solid var(--border);border-radius:8px;font-size:16px">
              <span style="font-family:'DM Mono',monospace;font-size:13px;color:var(--muted);width:18px">${i+1}</span>
              <span>${escHtml(lagMap[id]?.navn ?? id)}</span>
            </div>`).join('')}
        </div>
      </div>`).join('');
  } catch (e) {
    container.innerHTML = `<div style="color:var(--muted2);font-size:15px">${escHtml(e.message)}</div>`;
  }
}

function oppdaterOppsettKnapper(t) {
  const startBtn = document.getElementById('start-puljespill-knapp');
  if (!startBtn) return;
  const antall = t.konfig?.antallPuljer ?? 2;
  const nok    = (t.lag?.length ?? 0) >= antall * 2;
  startBtn.disabled = !nok;
  startBtn.title    = nok ? '' : `Trenger minst ${antall * 2} lag`;
}

window.leggTilLagUI = async function() {
  const inp  = document.getElementById('nytt-lag-inndata');
  const navn = inp?.value?.trim();
  if (!navn) return;
  try {
    await leggTilLag(_aktivTurneringId, navn);
    inp.value = '';
    const t = await hentTurnering(_aktivTurneringId);
    app.aktivTurnering = t;
    oppdaterLagListe(t);
    oppdaterPuljePreview(t);
    oppdaterOppsettKnapper(t);
  } catch (e) {
    visMelding(e?.message ?? 'Feil ved legg til lag.', 'feil');
  }
};

window.fjernLagUI = async function(lagId) {
  try {
    await fjernLag(_aktivTurneringId, lagId);
    const t = await hentTurnering(_aktivTurneringId);
    app.aktivTurnering = t;
    oppdaterLagListe(t);
    oppdaterPuljePreview(t);
    oppdaterOppsettKnapper(t);
  } catch (e) {
    visMelding(e?.message ?? 'Feil ved fjerning.', 'feil');
  }
};

window.redigerLagNavn = function(lagId) {
  const el = document.querySelector(`.t-lag-element[data-id="${lagId}"] .t-lag-navn`);
  if (!el) return;
  const gammelt = el.textContent;
  el.contentEditable = 'true';
  el.focus();
  // Merk alt innhold
  const range = document.createRange();
  range.selectNodeContents(el);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  el.onblur = async () => {
    el.contentEditable = 'false';
    const nytt = el.textContent.trim();
    if (!nytt || nytt === gammelt) { el.textContent = gammelt; return; }
    try {
      await oppdaterLagNavn(_aktivTurneringId, lagId, nytt);
      const t = await hentTurnering(_aktivTurneringId);
      app.aktivTurnering = t;
      oppdaterPuljePreview(t);
    } catch (e) {
      el.textContent = gammelt;
      visMelding(e?.message ?? 'Feil.', 'feil');
    }
  };
  el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } };
};

window.startPuljespillUI = function() {
  _krevAdmin('Start puljespill', 'Bekreft for å generere og starte puljespillet.', async () => {
    const knapp = document.getElementById('start-puljespill-knapp');
    if (knapp) { knapp.disabled = true; knapp.textContent = 'Starter…'; }
    try {
      const t      = await hentTurnering(_aktivTurneringId);
      const antall = t.konfig?.antallPuljer ?? 2;

      // Generer puljer og lagre til Firestore før oppstart
      const puljer = genererPuljer(t.lag, antall);
      await lagrePuljer(_aktivTurneringId, puljer);

      await startPuljespill(_aktivTurneringId);
      const oppdatert = await hentTurnering(_aktivTurneringId);
      app.aktivTurnering = oppdatert;
      _naviger('turnering-pulje');
      visPulje(oppdatert);
    } catch (e) {
      visMelding(e?.message ?? 'Feil ved oppstart.', 'feil');
      if (knapp) { knapp.disabled = false; knapp.textContent = 'START PULJESPILL'; }
    }
  });
};

// ════════════════════════════════════════════════════════
// PULJESKJERM — tabeller og kampregistrering
// ════════════════════════════════════════════════════════
export async function visPulje(turnering) {
  const t = turnering ?? await hentTurnering(_aktivTurneringId);
  app.aktivTurnering = t;

  document.getElementById('pulje-turnering-navn').textContent = t.navn;

  const fremgang = beregnFremgang(t.puljer);
  const fp = document.getElementById('pulje-fremgang');
  if (fp) {
    fp.innerHTML = `
      <div class="fremgang-beholder">
        <div style="flex:1;background:var(--navy3);border-radius:6px;height:6px;overflow:hidden">
          <div style="width:${fremgang.prosent}%;height:100%;background:var(--green2);transition:width .4s"></div>
        </div>
        <span style="font-size:15px;color:var(--muted2);min-width:60px;text-align:right">${fremgang.ferdig}/${fremgang.totalt} kamper</span>
      </div>`;
  }

  const container = document.getElementById('pulje-innhold');
  if (!container) return;

  const lagMap = Object.fromEntries(t.lag.map(l => [l.id, l]));

  container.innerHTML = t.puljer.map(p => {
    const tabell  = beregnPuljetabell(p, t.lag);
    const alleOK  = p.kamper?.every(k => k.ferdig);
    return `
      <div class="seksjon-etikett">${escHtml(p.navn)}</div>
      ${lagTabellHTML(tabell, lagMap)}
      <div style="margin-bottom:20px">
        <div style="font-size:15px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted2);margin-bottom:8px;font-weight:600">Kamper</div>
        ${(p.kamper ?? []).map(k => kampRadHTML(k, p.id, lagMap, t.konfig?.kampformatPulje)).join('')}
      </div>`;
  }).join('');

  // Vis "Gå til sluttspill"-knapp hvis alle kamper er ferdig
  const alleKampFerdig = t.puljer.every(p => p.kamper?.every(k => k.ferdig));
  const sluttBtn = document.getElementById('til-sluttspill-knapp');
  if (sluttBtn) sluttBtn.style.display = alleKampFerdig ? 'flex' : 'none';

  // Vis kvalifiseringsoversikt om alle kamper er ferdig
  if (alleKampFerdig) {
    visKvalifisering(t, lagMap);
  } else {
    const kv = document.getElementById('kvalifisering-boks');
    if (kv) kv.style.display = 'none';
  }
}

function lagTabellHTML(tabell, lagMap) {
  return `
    <div class="kort" style="margin-bottom:12px">
      <div class="kort-innhold" style="padding:0">
        <table style="width:100%;border-collapse:collapse;font-size:15px">
          <thead>
            <tr style="border-bottom:1px solid var(--border)">
              <th style="padding:8px 12px;text-align:left;color:var(--muted2);font-weight:500;font-size:13px">#</th>
              <th style="padding:8px 12px;text-align:left;color:var(--muted2);font-weight:500;font-size:13px">Lag</th>
              <th style="padding:8px 4px;text-align:center;color:var(--muted2);font-weight:500;font-size:13px" title="Seire">S</th>
              <th style="padding:8px 4px;text-align:center;color:var(--muted2);font-weight:500;font-size:13px" title="Tap">T</th>
              <th style="padding:8px 4px;text-align:center;color:var(--muted2);font-weight:500;font-size:13px" title="Poengdifferanse">PD</th>
              <th style="padding:8px 12px 8px 4px;text-align:center;color:var(--muted2);font-weight:500;font-size:13px" title="Poeng for">PF</th>
            </tr>
          </thead>
          <tbody>
            ${tabell.map((s, i) => {
              const lag = lagMap[s.lagId];
              const pdFarge = s.pd > 0 ? 'var(--green2)' : s.pd < 0 ? 'var(--red2)' : 'var(--muted2)';
              return `
                <tr style="border-bottom:1px solid var(--border)${i === tabell.length - 1 ? ';border-bottom:none' : ''}">
                  <td style="padding:10px 12px;font-family:'Bebas Neue',cursive;font-size:18px;color:${i < 2 ? 'var(--yellow)' : 'var(--muted)'}">${i + 1}</td>
                  <td style="padding:10px 12px;font-weight:500">${escHtml(lag?.navn ?? s.lagId)}</td>
                  <td style="padding:10px 4px;text-align:center;color:var(--green2);font-weight:600">${s.seire}</td>
                  <td style="padding:10px 4px;text-align:center;color:var(--muted2)">${s.tap}</td>
                  <td style="padding:10px 4px;text-align:center;color:${pdFarge};font-family:'DM Mono',monospace">${s.pd > 0 ? '+' : ''}${s.pd}</td>
                  <td style="padding:10px 12px 10px 4px;text-align:center;font-family:'DM Mono',monospace;color:var(--muted2)">${s.pf}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function kampRadHTML(kamp, puljeId, lagMap, format) {
  const lag1 = lagMap[kamp.lag1Id]?.navn ?? 'Lag 1';
  const lag2 = lagMap[kamp.lag2Id]?.navn ?? 'Lag 2';
  const f    = format ?? STANDARD_KAMPFORMAT;

  if (kamp.ferdig) {
    const vinner1 = kamp.lag1Poeng > kamp.lag2Poeng;
    return `
      <div class="kamp-rad" style="opacity:${kamp.walkover ? 0.6 : 1}">
        <div style="flex:1">
          <div style="font-size:16px;font-weight:${vinner1 ? 600 : 400};color:${vinner1 ? 'var(--white)' : 'var(--muted2)'}">${escHtml(lag1)}</div>
          <div style="font-size:16px;font-weight:${!vinner1 ? 600 : 400};color:${!vinner1 ? 'var(--white)' : 'var(--muted2)'}">${escHtml(lag2)}</div>
        </div>
        <div style="font-family:'DM Mono',monospace;font-size:20px;color:var(--green2);display:flex;flex-direction:column;align-items:flex-end;gap:2px">
          <span>${kamp.lag1Poeng}</span>
          <span>${kamp.lag2Poeng}</span>
        </div>
        ${kamp.walkover ? '<span style="font-size:13px;color:var(--orange);margin-left:8px">W.O.</span>' : ''}
        <button class="t-rediger-knapp" onclick="apneResultatModal('${escHtml(puljeId)}','${escHtml(kamp.id)}','${escHtml(kamp.lag1Id)}','${escHtml(kamp.lag2Id)}')" style="margin-left:10px">✏️</button>
      </div>`;
  }

  return `
    <div class="kamp-rad">
      <div style="flex:1">
        <div style="font-size:16px;color:var(--muted2)">${escHtml(lag1)}</div>
        <div style="font-size:16px;color:var(--muted2)">${escHtml(lag2)}</div>
      </div>
      <button class="knapp knapp-omriss knapp-liten" onclick="apneResultatModal('${escHtml(puljeId)}','${escHtml(kamp.id)}','${escHtml(kamp.lag1Id)}','${escHtml(kamp.lag2Id)}')">Registrer</button>
    </div>`;
}

function visKvalifisering(t, lagMap) {
  const boks = document.getElementById('kvalifisering-boks');
  if (!boks) return;
  boks.style.display = 'block';

  try {
    const kval = kvalifiserTilSluttspill(t);
    const render = (ids, tittel, farge) => {
      if (!ids?.length) return '';
      return `
        <div style="margin-bottom:16px">
          <div style="font-size:15px;text-transform:uppercase;letter-spacing:1.5px;color:${farge};font-weight:700;margin-bottom:8px">${tittel}</div>
          ${ids.map((id, i) => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--navy3);border:1px solid var(--border);border-radius:8px;margin-bottom:4px;font-size:16px">
              <span style="font-family:'Bebas Neue',cursive;font-size:18px;color:${farge};width:24px">${i+1}</span>
              <span>${escHtml(lagMap[id]?.navn ?? id)}</span>
            </div>`).join('')}
        </div>`;
    };

    boks.innerHTML = `
      <div class="seksjon-etikett">Kvalifisering</div>
      <div class="kort"><div class="kort-innhold">
        ${render(kval.A, '🥇 A-sluttspill (plass 1–8)',    'var(--yellow)')}
        ${render(kval.B, '🥈 B-sluttspill (plass 9–16)',   'var(--accent2)')}
        ${render(kval.C, '🥉 C-sluttspill (plass 17+)',    'var(--muted2)')}
      </div></div>`;
  } catch (e) {
    boks.innerHTML = `<div style="color:var(--red2);font-size:15px">${escHtml(e.message)}</div>`;
  }
}

// ════════════════════════════════════════════════════════
// RESULTAT-MODAL — registrer kampresultat
// ════════════════════════════════════════════════════════
let _modalPuljeId  = null;
let _modalKampId   = null;
let _modalLag1Id   = null;
let _modalLag2Id   = null;
let _modalNivaa    = null; // 'pulje' | 'A' | 'B' | 'C'

window.apneResultatModal = function(puljeEllerNivaa, kampId, lag1Id, lag2Id, erSluttspill = false) {
  _modalPuljeId = erSluttspill ? null : puljeEllerNivaa;
  _modalNivaa   = erSluttspill ? puljeEllerNivaa : null;
  _modalKampId  = kampId;
  _modalLag1Id  = lag1Id;
  _modalLag2Id  = lag2Id;

  const t      = app.aktivTurnering;
  const lagMap = Object.fromEntries((t?.lag ?? []).map(l => [l.id, l]));
  const format = erSluttspill
    ? (t?.konfig?.kampformatSluttspill ?? STANDARD_KAMPFORMAT)
    : (t?.konfig?.kampformatPulje ?? STANDARD_KAMPFORMAT);

  document.getElementById('modal-resultat-lag1').textContent = lagMap[lag1Id]?.navn ?? 'Lag 1';
  document.getElementById('modal-resultat-lag2').textContent = lagMap[lag2Id]?.navn ?? 'Lag 2';
  document.getElementById('modal-resultat-format').textContent =
    `Til ${format.points_to_win}, vinn med ${format.win_by}, maks ${format.max_points}`;
  document.getElementById('modal-resultat-p1').value = '';
  document.getElementById('modal-resultat-p2').value = '';
  document.getElementById('modal-resultat-feil').textContent = '';
  document.getElementById('modal-resultat').style.display = 'flex';
  setTimeout(() => document.getElementById('modal-resultat-p1')?.focus(), 200);
};

window.lukkResultatModal = function() {
  document.getElementById('modal-resultat').style.display = 'none';
};

window.bekreftResultat = async function() {
  const p1 = parseInt(document.getElementById('modal-resultat-p1').value, 10);
  const p2 = parseInt(document.getElementById('modal-resultat-p2').value, 10);
  const t  = app.aktivTurnering;
  const format = _modalNivaa
    ? (t?.konfig?.kampformatSluttspill ?? STANDARD_KAMPFORMAT)
    : (t?.konfig?.kampformatPulje     ?? STANDARD_KAMPFORMAT);

  const val = validerResultat(p1, p2, format);
  if (!val.ok) {
    document.getElementById('modal-resultat-feil').textContent = val.feil;
    return;
  }

  const knapp = document.querySelector('#modal-resultat .knapp-gronn');
  if (knapp) { knapp.disabled = true; knapp.textContent = 'Lagrer…'; }

  try {
    if (_modalNivaa) {
      const ny = await registrerSluttspillResultat(_aktivTurneringId, _modalNivaa, _modalKampId, p1, p2);
      lukkResultatModal();
      const oppdatert = await hentTurnering(_aktivTurneringId);
      app.aktivTurnering = oppdatert;
      visBracket(oppdatert);
    } else {
      await registrerPuljeresultat(_aktivTurneringId, _modalPuljeId, _modalKampId, p1, p2);
      lukkResultatModal();
      const oppdatert = await hentTurnering(_aktivTurneringId);
      app.aktivTurnering = oppdatert;
      visPulje(oppdatert);
    }
    visMelding('Resultat lagret!');
  } catch (e) {
    document.getElementById('modal-resultat-feil').textContent = e?.message ?? 'Feil ved lagring.';
  } finally {
    if (knapp) { knapp.disabled = false; knapp.textContent = 'LAGRE'; }
  }
};

window.registrerWalkoverUI = async function() {
  if (!_modalPuljeId || !_modalKampId) return;
  const vinnerId = _modalLag1Id; // Default: lag 1 vinner
  try {
    await registrerWalkover(_aktivTurneringId, _modalPuljeId, _modalKampId, vinnerId);
    lukkResultatModal();
    const t = await hentTurnering(_aktivTurneringId);
    app.aktivTurnering = t;
    visPulje(t);
    visMelding('Walkover registrert.');
  } catch (e) {
    visMelding(e?.message ?? 'Feil.', 'feil');
  }
};

// ════════════════════════════════════════════════════════
// BRACKET-SKJERM
// ════════════════════════════════════════════════════════
export async function visBracket(turnering) {
  const t = turnering ?? await hentTurnering(_aktivTurneringId);
  app.aktivTurnering = t;

  document.getElementById('bracket-turnering-navn').textContent = t.navn;

  const lagMap = Object.fromEntries(t.lag.map(l => [l.id, l]));
  const container = document.getElementById('bracket-innhold');
  if (!container) return;

  const { A, B, C } = t.sluttspill ?? {};

  let html = '';

  if (A?.kamper?.length) html += bracketNivaaHTML('A-SLUTTSPILL', 'var(--yellow)',    A.kamper, lagMap, 'A');
  if (B?.kamper?.length) html += bracketNivaaHTML('B-SLUTTSPILL', 'var(--accent2)',   B.kamper, lagMap, 'B');
  if (C?.kamper?.length) html += bracketNivaaHTML('C-SLUTTSPILL', 'var(--muted2)',    C.kamper, lagMap, 'C');

  container.innerHTML = html || '<div style="text-align:center;padding:40px;color:var(--muted2)">Ingen sluttspill ennå.</div>';

  // Vis avslutt-knapp om alt er ferdig
  const altFerdig = erAltFerdig(t);
  const avsluttBtn = document.getElementById('avslutt-turnering-knapp');
  if (avsluttBtn) avsluttBtn.style.display = altFerdig ? 'flex' : 'none';
}

function bracketNivaaHTML(tittel, farge, kamper, lagMap, nivaa) {
  const runder = grupperKamperIRunder(kamper);

  return `
    <div class="seksjon-etikett" style="color:${farge}">${tittel}</div>
    <div style="overflow-x:auto;margin-bottom:24px;padding-bottom:8px">
      <div style="display:flex;gap:16px;min-width:max-content;align-items:flex-start">
        ${runder.map(r => bracketRundeHTML(r, lagMap, nivaa, farge)).join('')}
      </div>
    </div>`;
}

function grupperKamperIRunder(kamper) {
  const rundeRekkefølge = ['Åttedelsfinale', 'Kvartfinale', 'Plass 5–8', 'Semifinale', 'Finale', '3. plass', '5. plass', '7. plass', '1. plass', '9. plass', '17. plass'];
  const map = {};
  for (const k of kamper) {
    const r = k.runde ?? 'Ukjent';
    if (!map[r]) map[r] = [];
    map[r].push(k);
  }
  // Sorter runder i logisk rekkefølge
  return Object.entries(map)
    .sort(([a], [b]) => (rundeRekkefølge.indexOf(a) - rundeRekkefølge.indexOf(b)))
    .map(([navn, kamp]) => ({ navn, kamp }));
}

function bracketRundeHTML(runde, lagMap, nivaa, farge) {
  return `
    <div style="min-width:200px">
      <div style="font-size:13px;text-transform:uppercase;letter-spacing:1.5px;color:${farge};font-weight:600;margin-bottom:10px;text-align:center">${escHtml(runde.navn)}</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${runde.kamp.map(k => bracketKampHTML(k, lagMap, nivaa)).join('')}
      </div>
    </div>`;
}

function bracketKampHTML(kamp, lagMap, nivaa) {
  const lag1 = lagMap[kamp.lag1Id];
  const lag2 = lagMap[kamp.lag2Id];
  const l1n  = lag1?.navn ?? (kamp.lag1Id ? '?' : 'TBD');
  const l2n  = lag2?.navn ?? (kamp.lag2Id ? '?' : 'TBD');
  const kant = kamp.ferdig ? 'var(--green)' : 'var(--border2)';
  const v1   = kamp.ferdig && kamp.lag1Poeng > kamp.lag2Poeng;
  const v2   = kamp.ferdig && kamp.lag2Poeng > kamp.lag1Poeng;
  const klikkbar = lag1 && lag2 && !kamp.ferdig;

  return `
    <div class="kort" style="border-color:${kant};cursor:${klikkbar ? 'pointer' : 'default'};min-width:200px"
      ${klikkbar ? `onclick="apneResultatModal('${escHtml(nivaa)}','${escHtml(kamp.id)}','${escHtml(kamp.lag1Id)}','${escHtml(kamp.lag2Id)}',true)"` : ''}>
      <div class="kort-innhold" style="padding:10px 12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:16px;font-weight:${v1 ? 700 : 400};color:${v1 ? 'var(--white)' : kamp.lag1Id ? 'var(--muted2)' : 'var(--muted)'}">${escHtml(l1n)}</span>
          ${kamp.ferdig ? `<span style="font-family:'DM Mono',monospace;font-size:18px;color:${v1 ? 'var(--green2)' : 'var(--muted2)'}">${kamp.lag1Poeng}</span>` : ''}
        </div>
        <div style="height:1px;background:var(--border);margin:0 -12px"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
          <span style="font-size:16px;font-weight:${v2 ? 700 : 400};color:${v2 ? 'var(--white)' : kamp.lag2Id ? 'var(--muted2)' : 'var(--muted)'}">${escHtml(l2n)}</span>
          ${kamp.ferdig ? `<span style="font-family:'DM Mono',monospace;font-size:18px;color:${v2 ? 'var(--green2)' : 'var(--muted2)'}">${kamp.lag2Poeng}</span>` : ''}
        </div>
        ${kamp.ferdig ? '' : `<div style="text-align:center;margin-top:8px;font-size:13px;color:${klikkbar ? 'var(--accent2)' : 'var(--muted)'}">${klikkbar ? 'Trykk for å registrere' : 'Venter på lag'}</div>`}
      </div>
    </div>`;
}

function erAltFerdig(t) {
  const sj = (kamper) => (kamper ?? []).every(k => k.ferdig);
  return sj(t.sluttspill?.A?.kamper) &&
         sj(t.sluttspill?.B?.kamper) &&
         sj(t.sluttspill?.C?.kamper);
}

window.tilSluttspillUI = function() {
  _krevAdmin('Start sluttspill', 'Puljespillet låses og sluttspillet genereres automatisk.', async () => {
    try {
      await startSluttspill(_aktivTurneringId);
      const t = await hentTurnering(_aktivTurneringId);
      app.aktivTurnering = t;
      _naviger('turnering-bracket');
      visBracket(t);
    } catch (e) {
      visMelding(e?.message ?? 'Feil ved oppstart av sluttspill.', 'feil');
    }
  });
};

window.avsluttTurneringUI = function() {
  _krevAdmin('Avslutt turnering', 'Turneringen avsluttes og endelig rangering beregnes.', async () => {
    try {
      await avsluttTurnering(_aktivTurneringId);
      const t = await hentTurnering(_aktivTurneringId);
      app.aktivTurnering = t;
      _naviger('turnering-resultat');
      visResultat(t);
    } catch (e) {
      visMelding(e?.message ?? 'Feil ved avslutning.', 'feil');
    }
  });
};

// ════════════════════════════════════════════════════════
// RESULTATSKJERM — endelig rangering
// ════════════════════════════════════════════════════════
export async function visResultat(turnering) {
  const t = turnering ?? await hentTurnering(_aktivTurneringId);
  app.aktivTurnering = t;

  document.getElementById('resultat-turnering-navn').textContent = t.navn;

  const rangering  = t.rangering ?? beregnEndeligRangering(t);
  const container  = document.getElementById('resultat-innhold');
  if (!container) return;

  if (!rangering.length) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted2)">Ingen resultater ennå.</div>';
    return;
  }

  const plassMedal = (p) => p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : '';
  const plassFarge = (p) => p === 1 ? 'var(--yellow)' : p <= 3 ? 'var(--accent2)' : 'var(--muted)';

  container.innerHTML = `
    <div class="kort"><div class="kort-innhold" style="padding:0">
      ${rangering.map(r => `
        <div class="rang-rad">
          <div class="rang-nummer" style="background:${r.plass <= 3 ? 'rgba(234,179,8,.15)' : 'rgba(100,116,139,.1)'};color:${plassFarge(r.plass)}">
            ${plassMedal(r.plass) || r.plass}
          </div>
          <div class="rang-navn">${escHtml(r.lag.navn)}</div>
          <div style="font-family:'Bebas Neue',cursive;font-size:20px;color:${plassFarge(r.plass)}">${r.plass}.</div>
        </div>`).join('')}
    </div></div>`;
}

// ════════════════════════════════════════════════════════
// VELGER-HJELPER (inline toggle-knapper)
// ════════════════════════════════════════════════════════
window.velgAlternativ = function(gruppe, verdi) {
  document.querySelectorAll(`.${gruppe} .t-velger-knapp`).forEach(b => {
    b.classList.toggle('aktiv', b.dataset.verdi === String(verdi));
  });
};
