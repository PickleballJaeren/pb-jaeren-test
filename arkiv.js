// ════════════════════════════════════════════════════════
// arkiv.js — historikk og sletting av økter
// ════════════════════════════════════════════════════════
import {
  db, SAM,
  collection, doc, getDoc, getDocs,
  query, where, orderBy, limit,
  writeBatch, serverTimestamp,
} from './firebase.js';
import { app } from './state.js';
import { visMelding, visFBFeil, escHtml } from './ui.js';

// ── Avhengigheter injisert fra app.js via arkivInit() ────────────────────────
let _naviger   = () => {};
let _krevAdmin = () => {};
let _getAktivKlubbId = () => null;

export function arkivInit(deps) {
  _naviger         = deps.naviger;
  _krevAdmin       = deps.krevAdmin;
  _getAktivKlubbId = deps.getAktivKlubbId;
}


export async function lastArkiv() {
  if (!db) { visMelding('Firebase ikke tilkoblet.', 'feil'); return; }
  const laster = document.getElementById('arkiv-laster');
  const liste  = document.getElementById('arkiv-liste');
  if (laster) laster.style.display = 'flex';
  if (liste)  liste.innerHTML = '';

  try {
    const snap = await getDocs(
      query(collection(db, SAM.TRENINGER), where('klubbId', '==', _getAktivKlubbId()), orderBy('opprettetDato', 'desc'))
    );
    if (laster) laster.style.display = 'none';

    if (snap.empty) {
      if (liste) liste.innerHTML =
        '<div style="padding:20px;text-align:center;color:var(--muted2);font-size:16px">Ingen økter registrert ennå</div>';
      return;
    }

    if (liste) {
      liste.innerHTML = snap.docs.map((d, i) => {
        const t    = d.data();
        const dato = t.opprettetDato?.toDate?.() ?? null;
        const datoStr = dato
          ? dato.toLocaleDateString('nb-NO', { day:'numeric', month:'long', year:'numeric' })
          : 'Ukjent dato';
        const tidStr = dato
          ? dato.toLocaleTimeString('nb-NO', { hour:'2-digit', minute:'2-digit' })
          : '';
        const status  = t.status === 'aktiv' ? '● Aktiv' : 'Avsluttet';
        const statFarge = t.status === 'aktiv' ? 'var(--green2)' : 'var(--muted2)';
        const runder  = t.gjeldendRunde ?? 1;
        const maks    = t.maksRunder    ?? '?';
        const baner   = t.antallBaner   ?? '?';

        return `<div class="kort" style="cursor:pointer;margin-bottom:10px;active:opacity:.85" data-treningid="${d.id}" onclick="apneTreningsdetaljFraDom(this)">
          <div class="kort-hode" style="align-items:center">
            <div style="flex:1">
              <div style="font-family:'Bebas Neue',cursive;font-size:23px;letter-spacing:1px;color:var(--white)">
                Økt ${snap.docs.length - i}
              </div>
              <div style="font-size:15px;color:var(--muted2);margin-top:2px">${datoStr}${tidStr ? ' • ' + tidStr : ''}</div>
            </div>
            <div style="text-align:right;margin-right:10px">
              <div style="font-size:14px;color:${statFarge};font-weight:700">${status}</div>
              <div style="font-size:14px;color:var(--muted2);margin-top:2px">${baner} baner • ${runder}/${maks} runder</div>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2" style="flex-shrink:0"><path d="M9 18l6-6-6-6"/></svg>
          </div>
        </div>`;
      }).join('');
    }
  } catch (e) {
    if (laster) laster.style.display = 'none';
    visFBFeil('Kunne ikke laste arkiv: ' + (e?.message ?? e));
  }
}
window.lastArkiv = lastArkiv;

// Lagrer ID globalt — trygt mot anførselstegn-problemer i onclick
let aktivTreningDetaljId = null;
export function apneTreningsdetaljFraDom(el) {
  aktivTreningDetaljId = el.dataset.treningid;
  apneTreningsdetalj(aktivTreningDetaljId);
}
window.apneTreningsdetaljFraDom = apneTreningsdetaljFraDom;

export async function apneTreningsdetalj(treningId) {
  if (!db || !treningId) return;

  // Naviger og vis lastingsindikator
  document.getElementById('detalj-rangering').innerHTML =
    '<div class="laster"><div class="laster-snurr"></div>Laster resultater…</div>';
  document.getElementById('detalj-rating').innerHTML = '';
  document.getElementById('detalj-kamper').innerHTML =
    '<div class="laster"><div class="laster-snurr"></div>Laster kamper…</div>';
  _naviger('treningsdetalj');

  try {
    const snap = await getDoc(doc(db, SAM.TRENINGER, treningId));
    if (!snap.exists()) { visMelding('Økt ikke funnet.', 'feil'); _naviger('arkiv'); return; }
    const t       = snap.data();
    const dato    = t.opprettetDato?.toDate?.() ?? null;
    const erAktiv = t.status === 'aktiv';
    const erAuto  = t.autoAvsluttet === true;

    document.getElementById('detalj-tittel').textContent =
      erAktiv ? 'Pågående økt' : 'Avsluttet økt';
    document.getElementById('detalj-dato').textContent = dato
      ? dato.toLocaleDateString('nb-NO', { weekday:'short', day:'numeric', month:'long', year:'numeric' })
        + ' • ' + dato.toLocaleTimeString('nb-NO', { hour:'2-digit', minute:'2-digit' })
      : '';

    // Meta-chips
    const antallBaner    = t.antallBaner   ?? '?';
    const gjeldendRunde  = t.gjeldendRunde ?? 1;
    const maksRunder     = t.maksRunder    ?? '?';
    const poengPerKamp   = t.poengPerKamp  ?? '?';
    const antallSpillere = (t.baneOversikt ?? []).reduce((sum, b) => sum + (b.spillere?.length ?? 0), 0)
                         + (t.venteliste ?? []).length;
    const metaChips = [
      { ikon: '⛳', tekst: antallBaner + ' baner' },
      { ikon: '🔄', tekst: gjeldendRunde + '/' + maksRunder + ' runder' },
      { ikon: '👥', tekst: antallSpillere + ' deltakere' },
      { ikon: '🎯', tekst: poengPerKamp + ' poeng/kamp' },
    ];
    document.getElementById('detalj-meta').innerHTML = metaChips.map(c =>
      `<div style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;background:var(--navy3);border:1px solid var(--border);border-radius:20px;font-size:15px;color:var(--muted2)">
        <span style="font-size:16px">${c.ikon}</span>${c.tekst}
      </div>`
    ).join('');

    // Hent sluttresultater og alle kamper parallelt
    const [resSnap, kampSnap] = await Promise.all([
      getDocs(query(collection(db, SAM.RESULTATER), where('treningId', '==', treningId))),
      getDocs(query(collection(db, SAM.KAMPER),     where('treningId', '==', treningId))),
    ]);

    const resultater = resSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.sluttPlassering ?? 999) - (b.sluttPlassering ?? 999));

    const alleKamper = kampSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.rundeNr - b.rundeNr) || (a.baneNr ?? '').localeCompare(b.baneNr ?? '') || (a.kampNr - b.kampNr));

    // ── Sluttrangering og ratingendringer ────────────────
    if (resultater.length > 0) {
      document.getElementById('detalj-rangering').innerHTML = resultater.map(r => {
        const ini = (r.spillerNavn ?? '?').split(' ').map(w => w[0] ?? '').join('').slice(0,2).toUpperCase() || '?';
        return `<div class="lb-rad" style="cursor:default">
          <div class="lb-plass${r.sluttPlassering <= 3 ? ' topp3' : ''}">${r.sluttPlassering}</div>
          <div class="lb-avatar">${ini}</div>
          <div class="lb-navn">${escHtml(r.spillerNavn ?? 'Ukjent')}</div>
          <div style="text-align:right">
            <div style="font-family:'DM Mono',monospace;font-size:15px;color:var(--muted2)">${r.ratingEtter ?? '—'}</div>
            <div class="lb-endring ${(r.ratingEndring ?? 0) >= 0 ? 'pos' : 'neg'}">
              ${(r.ratingEndring ?? 0) >= 0 ? '+' : ''}${r.ratingEndring ?? 0}
            </div>
          </div>
        </div>`;
      }).join('');

      document.getElementById('detalj-rating').innerHTML = resultater.map(r => `
        <div class="lb-rad" style="cursor:default">
          <div style="flex:1;font-size:17px">${escHtml(r.spillerNavn ?? 'Ukjent')}</div>
          <div style="font-family:'DM Mono',monospace;font-size:15px;color:var(--muted2);margin-right:10px">
            ${r.ratingFor ?? STARTRATING} → ${r.ratingEtter ?? STARTRATING}
          </div>
          <div class="lb-endring ${(r.ratingEndring ?? 0) >= 0 ? 'pos' : 'neg'}">
            ${(r.ratingEndring ?? 0) >= 0 ? '+' : ''}${r.ratingEndring ?? 0}
          </div>
        </div>`).join('');

    } else if (erAktiv) {
      // Pågående økt — vis deltakere
      const baner = t.baneOversikt ?? [];
      const vl    = t.venteliste   ?? [];
      const runde = t.gjeldendRunde ?? 1;
      const maks  = t.maksRunder   ?? '?';
      let html = `<div style="padding:8px 0 12px;font-size:16px;color:var(--accent2);font-weight:600;display:flex;align-items:center;gap:8px">
        <div class="runde-prikk-live"></div>Runde ${runde} av ${maks} pågår
      </div>`;
      baner.forEach(bane => {
        html += `<div style="margin-bottom:14px">
          <div style="font-size:13px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted2);margin-bottom:4px">Bane ${bane.baneNr}</div>`;
        (bane.spillere ?? []).forEach(s => {
          const ini = (s.navn ?? '?').split(' ').map(w => w[0] ?? '').join('').slice(0,2).toUpperCase() || '?';
          html += `<div class="lb-rad" style="cursor:default;padding:8px 0">
            <div class="lb-avatar" style="width:32px;height:32px;font-size:16px">${ini}</div>
            <div style="flex:1;font-size:17px">${escHtml(s.navn ?? 'Ukjent')}</div>
            <div style="font-family:'DM Mono',monospace;font-size:15px;color:var(--yellow)">⭐ ${s.rating ?? STARTRATING}</div>
          </div>`;
        });
        html += '</div>';
      });
      if (vl.length > 0) {
        html += `<div style="font-size:13px;text-transform:uppercase;letter-spacing:1.5px;color:var(--orange);margin:8px 0 4px">Venteliste</div>`;
        vl.forEach(s => {
          const ini = (s.navn ?? '?').split(' ').map(w => w[0] ?? '').join('').slice(0,2).toUpperCase() || '?';
          html += `<div class="lb-rad" style="cursor:default;padding:8px 0">
            <div class="lb-avatar" style="width:32px;height:32px;font-size:16px;background:var(--orange)">${ini}</div>
            <div style="flex:1;font-size:17px">${escHtml(s.navn ?? 'Ukjent')}</div>
            <div style="font-family:'DM Mono',monospace;font-size:15px;color:var(--yellow)">⭐ ${s.rating ?? STARTRATING}</div>
          </div>`;
        });
      }
      document.getElementById('detalj-rangering').innerHTML = html;
      document.getElementById('detalj-rating').innerHTML =
        '<div style="padding:12px 0;text-align:center;font-size:16px;color:var(--muted2)">Ratingendringer beregnes når økten avsluttes av admin.</div>';
    } else {
      const melding = erAuto
        ? 'Økten ble avsluttet automatisk etter 5 timer. Ingen ratingendringer ble beregnet.'
        : 'Ingen resultater registrert for denne økten.';
      document.getElementById('detalj-rangering').innerHTML =
        `<div style="padding:20px;text-align:center;font-size:16px;color:var(--muted2)">${melding}</div>`;
      document.getElementById('detalj-rating').innerHTML = '';
    }

    // ── Kampresultater per runde og bane ─────────────────
    const ferdigeKamper = alleKamper.filter(k => k.ferdig && k.lag1Poeng != null && k.lag2Poeng != null);

    if (ferdigeKamper.length === 0) {
      document.getElementById('detalj-kamper').innerHTML =
        '<div style="padding:12px 0 0;text-align:center;font-size:15px;color:var(--muted2)">Ingen kampresultater registrert.</div>';
    } else {
      // Grupper: runde → bane
      const runder = {};
      ferdigeKamper.forEach(k => {
        const rNr = k.rundeNr ?? 1;
        const bNr = k.baneNr ?? 'bane?';
        if (!runder[rNr]) runder[rNr] = {};
        if (!runder[rNr][bNr]) runder[rNr][bNr] = [];
        runder[rNr][bNr].push(k);
      });

      let html = '';
      Object.keys(runder).sort((a,b) => Number(a)-Number(b)).forEach(rNr => {
        html += `<div style="font-size:13px;text-transform:uppercase;letter-spacing:2px;color:var(--accent2);font-weight:600;margin:14px 0 8px;display:flex;align-items:center;gap:8px">
          Runde ${rNr}<span style="flex:1;height:1px;background:var(--border);display:block"></span>
        </div>`;

        Object.keys(runder[rNr]).sort().forEach(bNr => {
          const baneNummer = bNr.replace('bane','');
          const kamper     = runder[rNr][bNr];
          html += `<div class="kort" style="margin-bottom:10px">
            <div class="kort-hode">
              <span style="font-family:'Bebas Neue',cursive;font-size:22px;color:var(--accent);letter-spacing:2px">${baneNummer}</span>
              <span style="font-size:13px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted2)">Bane</span>
            </div>
            <div class="kort-innhold" style="padding:0">`;

          kamper.forEach(k => {
            const l1Navn = `${escHtml(k.lag1_s1_navn ?? '?')} + ${escHtml(k.lag1_s2_navn ?? '?')}`;
            const l2Navn = `${escHtml(k.lag2_s1_navn ?? '?')} + ${escHtml(k.lag2_s2_navn ?? '?')}`;
            const l1Vant = k.lag1Poeng > k.lag2Poeng;
            const l2Vant = k.lag2Poeng > k.lag1Poeng;
            const hvilerHTML = k.hviler_navn
              ? `<div style="font-size:13px;color:var(--orange);margin-top:4px">💤 ${escHtml(k.hviler_navn)} hvilte — fikk ${k.hvilerPoeng ?? '?'} poeng</div>`
              : '';
            html += `<div class="kamp-rad" style="padding:10px 16px">
              <div class="kamp-nummer" style="font-size:13px">K${k.kampNr}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:15px;color:${l1Vant ? 'var(--white)' : 'var(--muted2)'};font-weight:${l1Vant ? '600' : '400'}">${l1Navn}</div>
                <div style="font-size:13px;color:var(--muted);margin:2px 0">mot</div>
                <div style="font-size:15px;color:${l2Vant ? 'var(--white)' : 'var(--muted2)'};font-weight:${l2Vant ? '600' : '400'}">${l2Navn}</div>
                ${hvilerHTML}
              </div>
              <div style="font-family:'DM Mono',monospace;font-size:20px;font-weight:700;flex-shrink:0;color:var(--green2)">${k.lag1Poeng}–${k.lag2Poeng}</div>
            </div>`;
          });

          html += '</div></div>';
        });
      });

      document.getElementById('detalj-kamper').innerHTML = html;
    }

  } catch (e) {
    console.error('[apneTreningsdetalj]', e);
    document.getElementById('detalj-rangering').innerHTML =
      '<div style="padding:16px;text-align:center;font-size:16px;color:var(--red2)">Feil ved lasting. Prøv igjen.</div>';
    document.getElementById('detalj-kamper').innerHTML = '';
    visFBFeil('Kunne ikke laste øktdetaljer: ' + (e?.message ?? e));
  }
}
window.apneTreningsdetalj = apneTreningsdetalj;

// ════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════
// SLETT ØKT (admin)
// ════════════════════════════════════════════════════════
export function visSlettOktModal() {
  if (!aktivTreningDetaljId) { visMelding('Ingen økt valgt.', 'feil'); return; }
  _krevAdmin(
    'Slett økt',
    'Kun administrator kan slette lagrede økter.',
    () => {
      document.getElementById('modal-slett-okt').style.display = 'flex';
    }
  );
}
window.visSlettOktModal = visSlettOktModal;

export async function utforSlettOkt() {
  const treningId = aktivTreningDetaljId;
  if (!db || !treningId) { visMelding('Ingen økt valgt.', 'feil'); return; }
  document.getElementById('modal-slett-okt').style.display = 'none';
  visMelding('Sletter økt…', 'advarsel');

  try {
    const BATCH_MAKS = 400;
    let batch  = writeBatch(db);
    let teller = 0;

    const kommit = async () => {
      if (teller > 0) { await batch.commit(); batch = writeBatch(db); teller = 0; }
    };
    const slettDoc = async (ref) => {
      batch.delete(ref);
      teller++;
      if (teller >= BATCH_MAKS) await kommit();
    };

    // 1. Slett treningsdokumentet
    await slettDoc(doc(db, SAM.TRENINGER, treningId));

    // 2. Slett alle kamper
    const kamperSnap = await getDocs(
      query(collection(db, SAM.KAMPER), where('treningId', '==', treningId))
    );
    for (const d of kamperSnap.docs) await slettDoc(d.ref);

    // 3. Slett treningSpillere
    const tsSnap = await getDocs(
      query(collection(db, SAM.TS), where('treningId', '==', treningId))
    );
    for (const d of tsSnap.docs) await slettDoc(d.ref);

    // 4. Slett resultater
    const resSnap = await getDocs(
      query(collection(db, SAM.RESULTATER), where('treningId', '==', treningId))
    );
    for (const d of resSnap.docs) await slettDoc(d.ref);

    // 5. Slett ratinghistorikk for denne økten
    const histSnap = await getDocs(
      query(collection(db, SAM.HISTORIKK), where('treningId', '==', treningId))
    );
    for (const d of histSnap.docs) await slettDoc(d.ref);

    await kommit();

    // Rydd opp sessionStorage om dette var aktiv økt
    if (sessionStorage.getItem('aktivTreningId') === treningId) {
      sessionStorage.removeItem('aktivTreningId');
      app.treningId = null;
    }
    aktivTreningDetaljId = null;

    visMelding('Økt slettet.');
    _naviger('arkiv');
    lastArkiv();
  } catch (e) {
    console.error('[slettOkt]', e);
    visFBFeil('Feil ved sletting av økt: ' + (e?.message ?? e));
  }
}
window.utforSlettOkt = utforSlettOkt;

// ════════════════════════════════════════════════════════
// SLETT ALLE ØKTER (admin)
// ════════════════════════════════════════════════════════
export async function visSlettAlleOkterModal() {
  if (!db) { visMelding('Firebase ikke tilkoblet.', 'feil'); return; }

  _krevAdmin(
    'Slett alle økter',
    'Kun administrator kan slette alle lagrede økter.',
    async () => {
      // Tell opp antall økter før vi viser modalen
      try {
        const snap = await getDocs(collection(db, SAM.TRENINGER));
        const antall = snap.size;
        document.getElementById('slett-alle-teller').textContent =
          antall === 0
            ? 'Ingen lagrede økter funnet.'
            : `${antall} økt${antall === 1 ? '' : 'er'} vil bli slettet.`;
        document.getElementById('modal-slett-alle-okter').style.display = 'flex';
      } catch (e) {
        visFBFeil('Kunne ikke telle økter: ' + (e?.message ?? e));
      }
    }
  );
}
window.visSlettAlleOkterModal = visSlettAlleOkterModal;

export async function utforSlettAlleOkter() {
  if (!db) { visMelding('Firebase ikke tilkoblet.', 'feil'); return; }
  document.getElementById('modal-slett-alle-okter').style.display = 'none';
  visMelding('Sletter alle økter… vennligst vent.', 'advarsel');

  try {
    const BATCH_MAKS = 400;
    let batch  = writeBatch(db);
    let teller = 0;

    const kommit = async () => {
      if (teller > 0) { await batch.commit(); batch = writeBatch(db); teller = 0; }
    };
    const slettDoc = async (ref) => {
      batch.delete(ref);
      teller++;
      if (teller >= BATCH_MAKS) await kommit();
    };

    // Hent alle trenings-IDer først
    const treningSnap = await getDocs(collection(db, SAM.TRENINGER));
    const treningIds  = treningSnap.docs.map(d => d.id);

    if (treningIds.length === 0) {
      visMelding('Ingen økter å slette.', 'advarsel');
      return;
    }

    // Slett alle treningsdokumenter
    for (const d of treningSnap.docs) await slettDoc(d.ref);

    // Slett alle undersamlinger (Firestore tillater maks 10 IDer i where-in)
    const samlingerMedTreningId = [SAM.KAMPER, SAM.TS, SAM.RESULTATER, SAM.HISTORIKK];

    for (const sam of samlingerMedTreningId) {
      // Del opp i grupper på 10 (Firestore 'in'-grense)
      for (let i = 0; i < treningIds.length; i += 10) {
        const gruppe = treningIds.slice(i, i + 10);
        const snap = await getDocs(
          query(collection(db, sam), where('treningId', 'in', gruppe))
        );
        for (const d of snap.docs) await slettDoc(d.ref);
      }
    }

    await kommit();

    // Rydd opp sessionStorage om aktiv økt var blant de slettede
    if (sessionStorage.getItem('aktivTreningId')) {
      sessionStorage.removeItem('aktivTreningId');
      app.treningId = null;
    }

    visMelding(`${treningIds.length} økt${treningIds.length === 1 ? '' : 'er'} slettet.`);
    _naviger('arkiv');
    lastArkiv();
  } catch (e) {
    console.error('[slettAlleOkter]', e);
    visFBFeil('Feil ved sletting av alle økter: ' + (e?.message ?? e));
  }
}
window.utforSlettAlleOkter = utforSlettAlleOkter;