// ════════════════════════════════════════════════════════
// turnering-ui.js — Turneringsmodul UI
// Alle skjermvisninger og HTML-generering for turneringer.
// Ingen Firestore-logikk — kaller turnering.js for data.
// ════════════════════════════════════════════════════════

import { escHtml, visMelding, visFBFeil } from './ui.js';
import { app } from './state.js';
import {
  T_STATUS, SEEDING_MODUS, STANDARD_KAMPFORMAT,
  lagKampformat, hentFormatForRunde,
  hentAktiveTurneringer, hentAlleTurneringer, hentTurnering,
  opprettTurnering, oppdaterTurneringKonfig,
  leggTilLag, fjernLag, oppdaterLagNavn, flyttLag,
  genererPuljer, lagrePuljer, startPuljespill,
  registrerPuljeresultat, registrerWalkover,
  beregnPuljetabell, kvalifiserTilSluttspill,
  startSluttspill, registrerSluttspillResultat,
  oppdaterKampformat,
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

// ════════════════════════════════════════════════════════
// NAVIGASJONSSTACK
// ════════════════════════════════════════════════════════
const _navStack  = []; // tilbake-historikk
const _fremStack = []; // fremover-historikk
let   _gjeldende = null; // nåværende skjerm

function _oppdaterNavKnapper() {
  const harFrem = _fremStack.length > 0;
  document.querySelectorAll('[id^="t-nav-frem"]').forEach(btn => {
    btn.style.display = harFrem ? 'flex' : 'none';
  });
}

// Naviger fremover — rydder frem-stacken (ny retning)
function _navigerFremover(fraSkjerm, tilSkjerm) {
  if (fraSkjerm) _navStack.push(fraSkjerm);
  _fremStack.length = 0; // ny navigasjon tømmer fremover-historikk
  _gjeldende = tilSkjerm;
  _naviger(tilSkjerm);
  _oppdaterNavKnapper();
}

async function _gjenoppbyggSkjerm(skjerm) {
  const t = app.aktivTurnering;
  if (skjerm === 'turnering')          await visTurneringOversikt();
  else if (skjerm === 'turnering-oppsett'  && t) visOppsett(t);
  else if (skjerm === 'turnering-pulje'    && t) visPulje(t);
  else if (skjerm === 'turnering-bracket'  && t) visBracket(t);
  else if (skjerm === 'turnering-resultat' && t) visResultat(t);
}

// Tilbake-knapp
window.turneringTilbake = async function() {
  const forrige = _navStack.pop();
  if (!forrige) { _naviger('oppsett'); return; }
  if (_gjeldende) _fremStack.push(_gjeldende);
  _gjeldende = forrige;
  _naviger(forrige);
  await _gjenoppbyggSkjerm(forrige);
  _oppdaterNavKnapper();
};

// Fremover-knapp
window.turneringFremover = async function() {
  const neste = _fremStack.pop();
  if (!neste) return;
  if (_gjeldende) _navStack.push(_gjeldende);
  _gjeldende = neste;
  _naviger(neste);
  await _gjenoppbyggSkjerm(neste);
  _oppdaterNavKnapper();
};

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
    <div class="kort" style="margin-bottom:12px">
      <div class="kort-innhold">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-family:'Bebas Neue',cursive;font-size:22px;letter-spacing:1px;cursor:pointer;flex:1"
            onclick="apneTurnering('${escHtml(t.id)}')">${escHtml(t.navn)}</div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="t-status-merke ${statusInfo.kl}">${statusInfo.tekst}</span>
            <button class="t-slett-knapp" title="Slett turnering"
              onclick="event.stopPropagation();slettTurneringUI('${escHtml(t.id)}','${escHtml(t.navn)}')">🗑</button>
          </div>
        </div>
        <div style="display:flex;gap:16px;font-size:15px;color:var(--muted2);cursor:pointer"
          onclick="apneTurnering('${escHtml(t.id)}')">
          <span>🏐 ${antallLag} lag</span>
          <span>📅 ${dato}</span>
          ${t.konfig?.antallPuljer ? `<span>🔢 ${t.konfig.antallPuljer} puljer</span>` : ''}
        </div>
      </div>
    </div>`;
}

window.slettTurneringUI = function(id, navn) {
  _krevAdmin(
    'Slett turnering',
    `«${navn}» slettes permanent og kan ikke gjenopprettes.`,
    async () => {
      try {
        await slettTurnering(id);
        visMelding('Turnering slettet.');
        await visTurneringOversikt();
      } catch (e) {
        visMelding(e?.message ?? 'Kunne ikke slette turnering.', 'feil');
      }
    }
  );
};

window.visSlettAlleTurneringerModal = function() {
  _krevAdmin(
    'Slett alle turneringer',
    'Alle turneringer slettes permanent. Kan ikke angres.',
    () => {
      document.getElementById('modal-slett-alle-turneringer').style.display = 'flex';
    }
  );
};
window.lukkSlettAlleTurneringerModal = function() {
  document.getElementById('modal-slett-alle-turneringer').style.display = 'none';
};

window.utforSlettAlleTurneringer = async function() {
  const knapp = document.querySelector('#modal-slett-alle-turneringer .knapp-fare');
  if (knapp) { knapp.disabled = true; knapp.textContent = 'Sletter…'; }
  try {
    const alle = await hentAlleTurneringer();
    await Promise.all(alle.map(t => slettTurnering(t.id)));
    lukkSlettAlleTurneringerModal();
    visMelding(`${alle.length} turnering${alle.length === 1 ? '' : 'er'} slettet.`);
    await visTurneringOversikt();
  } catch (e) {
    visMelding(e?.message ?? 'Noe gikk galt.', 'feil');
  } finally {
    if (knapp) { knapp.disabled = false; knapp.textContent = 'SLETT ALLE'; }
  }
};

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
      case T_STATUS.SETUP:           _navigerFremover('turnering', 'turnering-oppsett'); visOppsett(t);   break;
      case T_STATUS.GROUP_PLAY:      _navigerFremover('turnering', 'turnering-pulje');   visPulje(t);     break;
      case T_STATUS.PLAYOFF_SEEDING: _navigerFremover('turnering', 'turnering-pulje');   visPulje(t);     break;
      case T_STATUS.PLAYOFFS:        _navigerFremover('turnering', 'turnering-bracket'); visBracket(t);   break;
      case T_STATUS.FINISHED:        _navigerFremover('turnering', 'turnering-resultat'); visResultat(t); break;
      default:                       _navigerFremover('turnering', 'turnering-oppsett'); visOppsett(t);
    }
  } catch (e) {
    visFBFeil('Kunne ikke åpne turnering: ' + (e?.message ?? e));
  }
};

// ════════════════════════════════════════════════════════
// NY TURNERING — modal
// ════════════════════════════════════════════════════════
window.visNyTurneringModal = function() {
  _fylltInnstillingerModal(null); // null = ny turnering, bruk defaults
  document.getElementById('modal-innstillinger-tittel').textContent = 'Ny turnering';
  document.getElementById('modal-innstillinger-knapp').textContent  = 'OPPRETT →';
  document.getElementById('modal-innstillinger-knapp').onclick      = bekreftNyTurnering;
  document.getElementById('modal-ny-turnering').style.display = 'flex';
  setTimeout(() => document.getElementById('ny-turnering-navn')?.focus(), 200);
};
window.lukkNyTurneringModal = function() {
  document.getElementById('modal-ny-turnering').style.display = 'none';
  // Nullstill readonly-tilstand så neste åpning starter rent
  document.querySelectorAll('#modal-ny-turnering .t-velger-knapp').forEach(b => {
    b.style.pointerEvents = '';
    b.style.opacity       = '';
  });
  document.querySelectorAll('#modal-ny-turnering input[type=checkbox]').forEach(cb => {
    cb.disabled = false;
  });
  const navnInp = document.getElementById('ny-turnering-navn');
  if (navnInp) navnInp.readOnly = false;
  const knapp = document.getElementById('modal-innstillinger-knapp');
  if (knapp) knapp.style.display = 'flex';
};

// Åpner samme modal men forhåndsutfylt med eksisterende konfig — for redigering
window.visInnstillingerModal = async function() {
  let t = app.aktivTurnering;
  if (!t && _aktivTurneringId) {
    try { t = await hentTurnering(_aktivTurneringId); app.aktivTurnering = t; }
    catch (e) { visMelding('Kunne ikke laste innstillinger.', 'feil'); return; }
  }
  if (!t) { visMelding('Ingen aktiv turnering.', 'advarsel'); return; }

  _fylltInnstillingerModal(t);
  document.getElementById('modal-innstillinger-tittel').textContent = 'Innstillinger';

  const erSetup = t.status === T_STATUS.SETUP;

  // Skjul/vis lagre-knapp og sett velgere som readonly om ikke i setup
  const knapp = document.getElementById('modal-innstillinger-knapp');
  if (knapp) {
    knapp.style.display = erSetup ? 'flex' : 'none';
  }

  // Deaktiver alle velger-knapper om ikke i setup
  document.querySelectorAll('#modal-ny-turnering .t-velger-knapp').forEach(b => {
    b.style.pointerEvents = erSetup ? '' : 'none';
    b.style.opacity       = erSetup ? '' : '0.6';
  });
  document.querySelectorAll('#modal-ny-turnering input[type=checkbox]').forEach(cb => {
    cb.disabled = !erSetup;
  });
  const navnInp = document.getElementById('ny-turnering-navn');
  if (navnInp) navnInp.readOnly = !erSetup;

  if (erSetup) {
    document.getElementById('modal-innstillinger-knapp').textContent = 'LAGRE →';
    document.getElementById('modal-innstillinger-knapp').onclick     = lagreInnstillinger;
  }

  document.getElementById('modal-ny-turnering').style.display = 'flex';
};

// Fyller modal med verdier — null gir defaults, turnering-objekt gir eksisterende verdier
function _fylltInnstillingerModal(t) {
  const k  = t?.konfig ?? {};
  const pf = k.kampformatPulje      ?? lagKampformat('single', 11);
  const kf = k.kampformatKvartfinale ?? lagKampformat('single', 11);
  const sf = k.kampformatSemifinale  ?? lagKampformat('single', 11);
  const ff = k.kampformatFinale      ?? lagKampformat('single', 15);

  // Navn
  const inp = document.getElementById('ny-turnering-navn');
  if (inp) inp.value = t?.navn ?? '';

  // Puljer
  velgAlternativ('t-puljer-velger', String(k.antallPuljer ?? 2));

  // Seeding
  velgAlternativ('t-seeding-velger', k.seedingModus ?? SEEDING_MODUS.STANDARD);

  // Plasseringskamper
  const togA  = document.getElementById('toggle-plasseringskamper-a');
  const togBC = document.getElementById('toggle-plasseringskamper-bc');
  if (togA)  togA.checked  = k.plasseringskamperA  !== false;
  if (togBC) togBC.checked = k.plasseringskamperBC === true;

  // Kampformat pulje
  velgAlternativ('t-pulje-type-velger',  pf.type);
  velgAlternativ('t-pulje-poeng-velger', String(pf.points_to_win));

  // Kampformat sluttspill
  velgAlternativ('t-kvart-type-velger',  kf.type);
  velgAlternativ('t-kvart-poeng-velger', String(kf.points_to_win));
  velgAlternativ('t-semi-type-velger',   sf.type);
  velgAlternativ('t-semi-poeng-velger',  String(sf.points_to_win));
  velgAlternativ('t-finale-type-velger', ff.type);
  velgAlternativ('t-finale-poeng-velger',String(ff.points_to_win));
}

window.lagreInnstillinger = async function() {
  const t = app.aktivTurnering;
  if (!t) return;

  const navn         = document.getElementById('ny-turnering-navn')?.value?.trim();
  const antallPuljer = parseInt(document.querySelector('.t-puljer-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? '2');
  const seedingModus = document.querySelector('.t-seeding-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? SEEDING_MODUS.STANDARD;
  const plasseringA  = document.getElementById('toggle-plasseringskamper-a')?.checked !== false;
  const plasseringBC = document.getElementById('toggle-plasseringskamper-bc')?.checked === true;
  const puljeType    = document.querySelector('.t-pulje-type-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? 'single';
  const puljePoeng   = parseInt(document.querySelector('.t-pulje-poeng-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? '11');
  const kvartType    = document.querySelector('.t-kvart-type-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? 'single';
  const kvartPoeng   = parseInt(document.querySelector('.t-kvart-poeng-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? '11');
  const semiType     = document.querySelector('.t-semi-type-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? 'single';
  const semiPoeng    = parseInt(document.querySelector('.t-semi-poeng-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? '11');
  const finaleType   = document.querySelector('.t-finale-type-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? 'single';
  const finalePoeng  = parseInt(document.querySelector('.t-finale-poeng-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? '15');

  if (!navn) { visMelding('Skriv inn turneringsnavn.', 'advarsel'); return; }

  const knapp = document.getElementById('modal-innstillinger-knapp');
  if (knapp) { knapp.disabled = true; knapp.textContent = 'Lagrer…'; }

  try {
    await oppdaterTurneringKonfig(_aktivTurneringId, {
      navn,
      antallPuljer,
      seedingModus,
      plasseringskamperA:    plasseringA,
      plasseringskamperBC:   plasseringBC,
      kampformatPulje:       lagKampformat(puljeType,  puljePoeng),
      kampformatKvartfinale: lagKampformat(kvartType,  kvartPoeng),
      kampformatSemifinale:  lagKampformat(semiType,   semiPoeng),
      kampformatFinale:      lagKampformat(finaleType, finalePoeng),
    });
    lukkNyTurneringModal();
    const oppdatert = await hentTurnering(_aktivTurneringId);
    app.aktivTurnering = oppdatert;
    visOppsett(oppdatert);
    visMelding('Innstillinger lagret!');
  } catch (e) {
    visMelding(e?.message ?? 'Feil ved lagring.', 'feil');
  } finally {
    if (knapp) { knapp.disabled = false; }
  }
};

window.bekreftNyTurnering = async function() {
  const navn         = document.getElementById('ny-turnering-navn')?.value?.trim();
  const antallPuljer = parseInt(document.querySelector('.t-puljer-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? '2');
  const seedingModus = document.querySelector('.t-seeding-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? SEEDING_MODUS.STANDARD;
  const plasseringA  = document.getElementById('toggle-plasseringskamper-a')?.checked !== false;
  const plasseringBC = document.getElementById('toggle-plasseringskamper-bc')?.checked === true;
  const puljeType    = document.querySelector('.t-pulje-type-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? 'single';
  const puljePoeng   = parseInt(document.querySelector('.t-pulje-poeng-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? '11');
  const kvartType    = document.querySelector('.t-kvart-type-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? 'single';
  const kvartPoeng   = parseInt(document.querySelector('.t-kvart-poeng-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? '11');
  const semiType     = document.querySelector('.t-semi-type-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? 'single';
  const semiPoeng    = parseInt(document.querySelector('.t-semi-poeng-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? '11');
  const finaleType   = document.querySelector('.t-finale-type-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? 'single';
  const finalePoeng  = parseInt(document.querySelector('.t-finale-poeng-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? '15');

  if (!navn) { visMelding('Skriv inn turneringsnavn.', 'advarsel'); return; }

  try {
    const id = await opprettTurnering({
      navn, antallPuljer, seedingModus,
      plasseringskamperA:   plasseringA,
      plasseringskamperBC:  plasseringBC,
      kampformatPulje:       lagKampformat(puljeType,  puljePoeng),
      kampformatKvartfinale: lagKampformat(kvartType,  kvartPoeng),
      kampformatSemifinale:  lagKampformat(semiType,   semiPoeng),
      kampformatFinale:      lagKampformat(finaleType, finalePoeng),
    });
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
  oppdaterBracketSetup(t);
  oppdaterOppsettKnapper(t);
}

// Viser sluttspill-bracket i setup-fasen med format-velger per kamp
function oppdaterBracketSetup(t) {
  const container = document.getElementById('bracket-setup-innhold');
  if (!container) return;

  const antallLag  = t.lag?.length ?? 0;
  const antallPuljer = t.konfig?.antallPuljer ?? 2;

  // Estimert antall lag i hvert sluttspill basert på konfig
  let aAntall = 0, bAntall = 0, cAntall = 0;
  if (antallLag >= antallPuljer * 2) {
    aAntall = Math.min(antallLag, 8);
    bAntall = Math.min(Math.max(antallLag - 8, 0), 8);
    cAntall = Math.min(Math.max(antallLag - 16, 0), 16);
  }

  if (aAntall < 2) {
    container.innerHTML = `<div style="color:var(--muted2);font-size:15px;text-align:center;padding:16px 0">Legg til nok lag for å se bracket-oppsett</div>`;
    return;
  }

  // Bruk lagrede bracket-kamper om de finnes, ellers generer placeholder
  const sluttspill = t.sluttspill ?? {};

  const renderNivaa = (nivaa, antall, farge, startplass) => {
    if (antall < 2) return '';
    const lagIds    = Array.from({ length: antall }, (_, i) => `lag_${i}`); // placeholder
    const eksisterende = sluttspill[nivaa]?.kamper;

    // Bygg bracket-kamper kun for visning — bruk eksisterende om tilgjengelig
    let kamper;
    if (eksisterende?.length) {
      kamper = eksisterende;
    } else {
      // Importer inline for å unngå sirkulær avhengighet
      kamper = nivaa === 'A'
        ? _genererAPlaceholder(antall, t.konfig)
        : _genererBCPlaceholder(antall, nivaa, startplass);
    }

    const runder = grupperKamperISetupRunder(kamper);
    return `
      <div style="margin-bottom:20px">
        <div class="seksjon-etikett" style="color:${farge};margin-bottom:10px">${nivaa}-SLUTTSPILL</div>
        <div style="overflow-x:auto;padding-bottom:6px">
          <div style="display:flex;gap:12px;min-width:max-content">
            ${runder.map(r => setupRundeHTML(r, nivaa, farge, t.konfig)).join('')}
          </div>
        </div>
      </div>`;
  };

  container.innerHTML =
    renderNivaa('A', aAntall, 'var(--yellow)', 1) +
    renderNivaa('B', bAntall, 'var(--accent2)', 9) +
    renderNivaa('C', cAntall, 'var(--muted2)', 17);
}

function _genererAPlaceholder(n, konfig) {
  // Forenklet placeholder — speiler logikken i genererABracket
  const plasseringPaa = konfig?.plasseringskamperA !== false;
  const kamper = [];
  if (n <= 2) {
    kamper.push({ id: 'A_FIN', runde: '1. plass', format: null });
  } else if (n <= 4) {
    kamper.push({ id: 'A_SF1', runde: 'Semifinale', format: null });
    kamper.push({ id: 'A_SF2', runde: 'Semifinale', format: null });
    kamper.push({ id: 'A_FIN', runde: '1. plass', format: null });
    if (plasseringPaa) kamper.push({ id: 'A_BRO', runde: '3. plass', format: null });
  } else {
    kamper.push({ id: 'A_QF1', runde: 'Kvartfinale', format: null });
    kamper.push({ id: 'A_QF2', runde: 'Kvartfinale', format: null });
    kamper.push({ id: 'A_QF3', runde: 'Kvartfinale', format: null });
    kamper.push({ id: 'A_QF4', runde: 'Kvartfinale', format: null });
    kamper.push({ id: 'A_SF1', runde: 'Semifinale', format: null });
    kamper.push({ id: 'A_SF2', runde: 'Semifinale', format: null });
    kamper.push({ id: 'A_FIN', runde: '1. plass', format: null });
    kamper.push({ id: 'A_BRO', runde: '3. plass', format: null });
    if (plasseringPaa) {
      kamper.push({ id: 'A_P5_SF1', runde: 'Plass 5–8', format: null });
      kamper.push({ id: 'A_P5_SF2', runde: 'Plass 5–8', format: null });
      kamper.push({ id: 'A_P5_FIN', runde: '5. plass', format: null });
      kamper.push({ id: 'A_P7_FIN', runde: '7. plass', format: null });
    }
  }
  return kamper;
}

function _genererBCPlaceholder(n, prefix, startplass) {
  const kamper = [];
  const sp = startplass;
  if (n <= 2) {
    kamper.push({ id: `${prefix}_FIN`, runde: `${sp}. plass`, format: null });
  } else if (n <= 4) {
    kamper.push({ id: `${prefix}_SF1`, runde: 'Semifinale', format: null });
    kamper.push({ id: `${prefix}_SF2`, runde: 'Semifinale', format: null });
    kamper.push({ id: `${prefix}_FIN`, runde: `${sp}. plass`, format: null });
  } else if (n <= 8) {
    kamper.push({ id: `${prefix}_QF1`, runde: 'Kvartfinale', format: null });
    kamper.push({ id: `${prefix}_QF2`, runde: 'Kvartfinale', format: null });
    kamper.push({ id: `${prefix}_QF3`, runde: 'Kvartfinale', format: null });
    kamper.push({ id: `${prefix}_QF4`, runde: 'Kvartfinale', format: null });
    kamper.push({ id: `${prefix}_SF1`, runde: 'Semifinale', format: null });
    kamper.push({ id: `${prefix}_SF2`, runde: 'Semifinale', format: null });
    kamper.push({ id: `${prefix}_FIN`, runde: `${sp}. plass`, format: null });
  } else {
    for (let i = 1; i <= 8; i++) kamper.push({ id: `${prefix}_R1_${i}`, runde: 'Åttedelsfinale', format: null });
    for (let i = 1; i <= 4; i++) kamper.push({ id: `${prefix}_QF${i}`, runde: 'Kvartfinale', format: null });
    kamper.push({ id: `${prefix}_SF1`, runde: 'Semifinale', format: null });
    kamper.push({ id: `${prefix}_SF2`, runde: 'Semifinale', format: null });
    kamper.push({ id: `${prefix}_FIN`, runde: `${sp}. plass`, format: null });
  }
  return kamper;
}

function grupperKamperISetupRunder(kamper) {
  const rekkefølge = ['Åttedelsfinale', 'Kvartfinale', 'Plass 5–8', 'Semifinale',
    '1. plass', '3. plass', '5. plass', '7. plass', '9. plass', '17. plass'];
  const map = {};
  for (const k of kamper) {
    const r = k.runde ?? 'Ukjent';
    if (!map[r]) map[r] = [];
    map[r].push(k);
  }
  return Object.entries(map)
    .sort(([a], [b]) => {
      const ia = rekkefølge.indexOf(a), ib = rekkefølge.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map(([navn, kamp]) => ({ navn, kamp }));
}

function setupRundeHTML(runde, nivaa, farge, konfig) {
  return `
    <div style="min-width:190px">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:${farge};font-weight:600;margin-bottom:8px;text-align:center">${escHtml(runde.navn)}</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${runde.kamp.map((k, i) => setupKampHTML(k, i + 1, runde.navn, nivaa, konfig)).join('')}
      </div>
    </div>`;
}

function setupKampHTML(kamp, nr, rundeNavn, nivaa, konfig) {
  const format    = kamp.format ?? hentFormatForRunde(rundeNavn, konfig);
  const typeLabel = format.type === 'best_of_3' ? 'B3' : '1G';
  const poeng     = format.points_to_win;
  const erOverstyrt = !!kamp.format;

  // Kortere ID-visning: fjern prefix (A_, B_, C_)
  const visId = kamp.id.replace(/^[ABC]_/, '').replace(/_/g, ' ');

  return `
    <div class="kort" style="border-color:${erOverstyrt ? 'var(--accent2)' : 'var(--border)'}">
      <div class="kort-innhold" style="padding:8px 12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div>
            <div style="font-size:14px;font-family:'DM Mono',monospace;color:var(--muted2)">${escHtml(visId)}</div>
            <div style="font-size:13px;color:${erOverstyrt ? 'var(--accent2)' : 'var(--muted)'}">
              ${typeLabel} · ${poeng} pts${erOverstyrt ? ' ✎' : ''}
            </div>
          </div>
          <button class="knapp knapp-omriss knapp-liten"
            style="font-size:13px;padding:5px 10px;min-width:0"
            onclick="apneKampformatModal('${escHtml(nivaa)}','${escHtml(kamp.id)}','${escHtml(rundeNavn)}')">
            Endre
          </button>
        </div>
      </div>
    </div>`;
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

// ════════════════════════════════════════════════════════
// KAMPFORMAT-MODAL (setup-fase)
// ════════════════════════════════════════════════════════
let _kfNivaa   = null;
let _kfKampId  = null;
let _kfRunde   = null;

window.apneKampformatModal = function(nivaa, kampId, runde) {
  _kfNivaa  = nivaa;
  _kfKampId = kampId;
  _kfRunde  = runde;

  const t      = app.aktivTurnering;
  const kamper = t?.sluttspill?.[nivaa]?.kamper ?? [];
  const kamp   = kamper.find(k => k.id === kampId);
  const format = kamp?.format ?? hentFormatForRunde(runde, t?.konfig);

  // Sett aktive velger-knapper til gjeldende format
  document.querySelectorAll('.kf-type-velger .t-velger-knapp').forEach(b => {
    b.classList.toggle('aktiv', b.dataset.verdi === format.type);
  });
  document.querySelectorAll('.kf-poeng-velger .t-velger-knapp').forEach(b => {
    b.classList.toggle('aktiv', b.dataset.verdi === String(format.points_to_win));
  });

  const visId = kampId.replace(/^[ABC]_/, '').replace(/_/g, ' ');
  document.getElementById('kf-modal-tittel').textContent = `${nivaa}-sluttspill · ${visId}`;
  document.getElementById('kf-modal-runde').textContent  = runde;
  document.getElementById('modal-kampformat').style.display = 'flex';
};

window.lukkKampformatModal = function() {
  document.getElementById('modal-kampformat').style.display = 'none';
};

window.nullstillKampformat = async function() {
  if (!_kfNivaa || !_kfKampId) return;
  // Sett format til null (tilbake til default)
  try {
    await oppdaterKampformat(_aktivTurneringId, _kfNivaa, _kfKampId, null);
    lukkKampformatModal();
    const t = await hentTurnering(_aktivTurneringId);
    app.aktivTurnering = t;
    oppdaterBracketSetup(t);
    visMelding('Format tilbakestilt til default.');
  } catch (e) {
    visMelding(e?.message ?? 'Feil.', 'feil');
  }
};

window.bekreftKampformat = async function() {
  if (!_kfNivaa || !_kfKampId) return;
  const type  = document.querySelector('.kf-type-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? 'single';
  const poeng = parseInt(document.querySelector('.kf-poeng-velger .t-velger-knapp.aktiv')?.dataset?.verdi ?? '11');
  const format = lagKampformat(type, poeng);
  try {
    await oppdaterKampformat(_aktivTurneringId, _kfNivaa, _kfKampId, format);
    lukkKampformatModal();
    const t = await hentTurnering(_aktivTurneringId);
    app.aktivTurnering = t;
    oppdaterBracketSetup(t);
    visMelding('Kampformat oppdatert.');
  } catch (e) {
    visMelding(e?.message ?? 'Feil.', 'feil');
  }
};

window.leggTilLagUI = async function() {
  const inp  = document.getElementById('nytt-lag-inndata');
  const navn = inp?.value?.trim();
  if (!navn) { inp?.focus(); return; }
  try {
    await leggTilLag(_aktivTurneringId, navn);
    inp.value = '';
    inp.focus();
    const t = await hentTurnering(_aktivTurneringId);
    app.aktivTurnering = t;
    oppdaterLagListe(t);
    oppdaterPuljePreview(t);
    oppdaterBracketSetup(t);
    oppdaterOppsettKnapper(t);
  } catch (e) {
    visMelding(e?.message ?? 'Feil ved legg til lag.', 'feil');
    inp?.focus();
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
      _navigerFremover('turnering-oppsett', 'turnering-pulje');
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
    const tabell = beregnPuljetabell(p, t.lag);
    const runder = _grupperKamperPerRunde(p.kamper ?? []);
    return `
      <div class="seksjon-etikett">${escHtml(p.navn)}</div>
      ${lagTabellHTML(tabell, lagMap)}
      <div style="margin-bottom:20px">
        ${runder.map(r => `
          <div style="font-size:13px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted2);font-weight:600;margin-bottom:6px;margin-top:12px">
            Runde ${r.runde}
          </div>
          ${r.kamper.map(k => kampRadHTML(k, p.id, lagMap, t.konfig?.kampformatPulje)).join('')}
        `).join('')}
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

function _grupperKamperPerRunde(kamper) {
  const map = {};
  for (const k of kamper) {
    const r = k.runde ?? 1;
    if (!map[r]) map[r] = [];
    map[r].push(k);
  }
  return Object.keys(map)
    .map(Number)
    .sort((a, b) => a - b)
    .map(r => ({ runde: r, kamper: map[r] }));
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

  let format = t?.konfig?.kampformatPulje ?? STANDARD_KAMPFORMAT;
  if (erSluttspill) {
    const bracket = t?.sluttspill?.[puljeEllerNivaa]?.kamper ?? [];
    const kamp    = bracket.find(k => k.id === kampId);
    format = hentFormatForRunde(kamp?.runde, t?.konfig, kamp?.format ?? null);
  }

  const typeLabel = format.type === 'best_of_3' ? 'Best av 3 · ' : '';
  document.getElementById('modal-resultat-lag1').textContent = lagMap[lag1Id]?.navn ?? 'Lag 1';
  document.getElementById('modal-resultat-lag2').textContent = lagMap[lag2Id]?.navn ?? 'Lag 2';
  document.getElementById('modal-resultat-format').textContent =
    `${typeLabel}Til ${format.points_to_win}, vinn med ${format.win_by}, maks ${format.max_points}`;
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
  let format = t?.konfig?.kampformatPulje ?? STANDARD_KAMPFORMAT;
  if (_modalNivaa) {
    const bracket = t?.sluttspill?.[_modalNivaa]?.kamper ?? [];
    const kamp    = bracket.find(k => k.id === _modalKampId);
    format = hentFormatForRunde(kamp?.runde, t?.konfig);
  }

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
      _navigerFremover('turnering-pulje', 'turnering-bracket');
      visBracket(t);
    } catch (e) {
      visMelding(e?.message ?? 'Feil ved oppstart av sluttspill.', 'feil');
    }
  });
};

window.avsluttTurneringUI = function() {
  _krevAdmin('Avslutt turnering', 'Turneringen avsluttes og endelig rangering beregnes.', async () => {
    try {
      const rangeringRen = await avsluttTurnering(_aktivTurneringId);
      const t = await hentTurnering(_aktivTurneringId);
      app.aktivTurnering = t;
      _navigerFremover('turnering-bracket', 'turnering-resultat');
      await visResultat(t, rangeringRen);
    } catch (e) {
      visMelding(e?.message ?? 'Feil ved avslutning.', 'feil');
    }
  });
};

// ════════════════════════════════════════════════════════
// RESULTATSKJERM — endelig rangering
// ════════════════════════════════════════════════════════
export async function visResultat(turnering, rangeringOverstyr = null) {
  let t = turnering;
  if (!t) {
    t = await hentTurnering(_aktivTurneringId);
  }
  app.aktivTurnering = t;

  document.getElementById('resultat-turnering-navn').textContent = t.navn ?? '';

  const container = document.getElementById('t-resultat-innhold');
  if (!container) return;

  // Bruk direkte rangering om sendt inn, ellers t.rangering, ellers beregn
  let rangering = rangeringOverstyr ?? t.rangering ?? [];
  if (!rangering.length) {
    rangering = beregnEndeligRangering(t);
  }

  const erPagaende = t.status === T_STATUS.PLAYOFFS;

  if (!rangering.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--muted2)">
        <div style="font-size:32px;margin-bottom:12px">🏆</div>
        <div style="font-size:17px;margin-bottom:8px">
          ${erPagaende ? 'Sluttspillet er ikke ferdig ennå.' : 'Ingen resultater å vise.'}
        </div>
        ${erPagaende ? `<div style="font-size:15px;color:var(--muted)">Fullfør alle sluttspillkamper og trykk "Avslutt turnering".</div>` : ''}
      </div>`;
    return;
  }

  const plassMedal = (p) => p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : '';
  const plassFarge = (p) => p === 1 ? 'var(--yellow)' : p <= 3 ? 'var(--accent2)' : 'var(--muted)';
  const hentNavn   = (r) => r.navn ?? r.lag?.navn ?? '?';

  container.innerHTML = `
    ${erPagaende ? `<div style="background:rgba(234,179,8,.1);border:1px solid rgba(234,179,8,.25);border-radius:10px;padding:10px 14px;margin-bottom:16px;font-size:15px;color:var(--yellow)">
      Foreløpig rangering — trykk "Avslutt turnering" for å låse resultatet.
    </div>` : ''}
    <div class="kort"><div class="kort-innhold" style="padding:0">
      ${rangering.map(r => `
        <div class="rang-rad">
          <div class="rang-nummer" style="background:${r.plass <= 3 ? 'rgba(234,179,8,.15)' : 'rgba(100,116,139,.1)'};color:${plassFarge(r.plass)}">
            ${plassMedal(r.plass) || r.plass}
          </div>
          <div class="rang-navn">${escHtml(hentNavn(r))}</div>
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
