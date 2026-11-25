/* Flora Medici – Ansichten & Ablauf
 * Jede Pflanze ist ein fest angelegter "Patient" mit Patientenakte:
 *  - Untersuchungen (Erstbefund, Kontrolltermine) mit Zweitprüfung
 *  - Behandlungsplan mit Aufgaben und nächstem Kontrolltermin (inkl. iPhone-Mitteilung)
 *  - Sprechstunde: jederzeit Fragen stellen, Antworten mit Markierungen auf dem eigenen Foto
 */
import {
  $, $$, esc, paras, uid, store, toast, ICON, pickPhotos, initPhotoInputs,
  today, fmtDate, relDay, daysUntil, fmtTimestamp,
} from './util.js';
import { db } from './db.js';
import { getSettings, diagnose, followUp, askQuestion, friendlyError, testConnection } from './ai.js';
import {
  buildPlan, addQuestionTasks, dueItems, updateBadge, pushSettings, setupPush, sendTest, disablePush,
  syncReminders, scheduleSync, isStandalone, pushSupported,
} from './reminders.js';

const APP_VERSION = '2.0.1';
const MAX_PHOTOS = 3;
const LOCATIONS = ['Wohnung', 'Balkon / Terrasse', 'Garten', 'Gewächshaus'];
const STATUS_LABEL = { gesund: 'Gesund', natuerlich: 'Natürlicher Vorgang', leicht: 'Leichte Probleme', mittel: 'Braucht Hilfe', stark: 'Dringend handeln' };
const statusClass = (st) => (st === 'gesund' || st === 'natuerlich' ? 'ok' : st === 'stark' ? 'bad' : 'warn');
const TREND = { besser: ['Es geht bergauf', 'ok'], gleich: ['Unverändert', 'warn'], schlechter: ['Verschlechtert', 'bad'] };

const state = {
  draft: { images: [], location: '', note: '', plantId: null },
  loading: null, // { img, text }
  busy: false,
  askDraft: { text: '', images: [] },
};

const allPlants = () => db.allPlants();
const afterChange = () => { scheduleSync(allPlants); allPlants().then(updateBadge); };

/* ------------------------------------------------------------------ *
 * Navigation (Hash-Routen, damit Mitteilungen direkt die Pflanze öffnen)
 * ------------------------------------------------------------------ */
const route = () => {
  const [name = 'home', ...params] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name, params };
};
const nav = (hash) => { if (location.hash === `#${hash}`) render(); else location.hash = hash; };
const PARENT = { plant: 'plants', visit: (p) => `plant/${p[0]}`, ask: (p) => `plant/${p[0]}`, settings: 'home', help: 'settings', pushhelp: 'settings', scan: (p) => `plant/${p[0]}` };

window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
$('#btn-back').addEventListener('click', () => {
  const r = route();
  const p = PARENT[r.name];
  nav(typeof p === 'function' ? p(r.params) : p || 'home');
});
$('#btn-settings').addEventListener('click', () => nav('settings'));
$('#brand').addEventListener('click', () => nav('home'));
$$('#tabbar button').forEach((b) => b.addEventListener('click', () => nav(b.dataset.nav)));

async function render() {
  const v = $('#view');
  if (state.loading) return renderLoading(v);
  const r = route();
  const isRoot = ['home', 'plants'].includes(r.name);
  $('#btn-back').hidden = isRoot;
  $('#tabbar').classList.toggle('hidden', !isRoot);
  $$('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.nav === r.name));
  switch (r.name) {
    case 'plants': return renderPlants(v);
    case 'plant': {
      if (r.params[1] === 'checkup') return nav(`scan/${r.params[0]}`);
      return renderPlant(v, r.params[0]);
    }
    case 'scan': return renderHome(v, r.params[0]);
    case 'visit': return renderVisit(v, r.params[0], r.params[1]);
    case 'ask': return renderAsk(v, r.params[0]);
    case 'settings': return renderSettings(v);
    case 'help': return renderHelp(v);
    case 'pushhelp': return renderPushHelp(v);
    default: return renderHome(v, null);
  }
}

/* ------------------------------------------------------------------ *
 * Bausteine
 * ------------------------------------------------------------------ */
function meter(label, val) {
  const cls = val >= 75 ? '' : val >= 50 ? 'mid' : 'low';
  return `<div class="meter"><div class="meter-row"><span>${esc(label)}</span><b>${val} %</b></div>
    <div class="meter-bar ${cls}"><div style="width:${val}%"></div></div></div>`;
}
const badge = (st) => `<span class="badge ${statusClass(st)}">${STATUS_LABEL[st] || 'Unklar'}</span>`;
const thumbs = (arr) => arr.map((im, i) => `<div class="photo-slot filled"><img src="${im}" alt=""><button class="remove" data-rm="${i}" aria-label="Entfernen">${ICON.x}</button></div>`).join('');
function bindThumbs(el, arr, redraw) {
  $$('[data-rm]', el).forEach((b) => b.addEventListener('click', () => { arr.splice(+b.dataset.rm, 1); redraw(); }));
}
function setBusy(btn, on, label = 'Einen Moment …') {
  if (!btn) return;
  if (on) { btn.disabled = true; btn.dataset.label = btn.innerHTML; btn.textContent = label; } else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

function nextInfo(p) {
  const due = dueItems([p]);
  if (due.length) return { text: due.some((d) => d.kind === 'checkup') ? 'Kontrolltermin fällig' : `${due.length} Aufgabe${due.length > 1 ? 'n' : ''} fällig`, cls: 'warn' };
  const c = p.plan?.checkup;
  if (c && !c.done) return { text: `Kontrolle ${relDay(c.date)}`, cls: 'ok' };
  return null;
}

/* ------------------------------------------------------------------ *
 * Startseite / Untersuchung
 * ------------------------------------------------------------------ */
async function renderHome(v, plantId) {
  const d = state.draft;
  if ((plantId || null) !== d.plantId) state.draft = { images: [], location: '', note: '', plantId: plantId || null };
  const plants = await allPlants();
  const plant = plantId ? plants.find((p) => p.id === plantId) : null;
  if (plantId && !plant) return nav('home');
  const due = dueItems(plants);
  const hasKey = !!getSettings().apiKey;
  const ps = pushSettings();
  const slots = ['Ganze Pflanze', 'Problemstelle (nah)', 'Erde / Blattunterseite'];
  const dd = state.draft;

  v.innerHTML = `
    ${plant ? `
    <div class="card tint">
      <div class="result-head"><img src="${plant.cover}" alt="">
        <div><div class="muted small">Kontrolltermin für</div><h2>${esc(plant.name)}</h2>
        ${plant.plan?.checkup?.foto ? `<p class="small" style="margin-top:4px">${ICON.camera.replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px"')} ${esc(plant.plan.checkup.foto)}</p>` : ''}</div>
      </div>
    </div>` : `
    <section class="hero ${plants.length ? 'compact' : ''}">
      <img src="icons/logo.svg" alt="Flora Medici Logo">
      <h1>Flora <span>Medici</span></h1>
      <div class="tagline">Erkennen · Analysieren · Helfen</div>
    </section>`}

    ${!plant && due.length ? `
    <div class="card warn">
      <div class="card-head">${ICON.bell}<h3>Heute in deiner Pflanzenpraxis</h3></div>
      <ul class="list">${due.slice(0, 6).map((x) => `<li class="tap" data-plant="${x.plant.id}"><span class="dot ${x.kind === 'checkup' ? 'urgent' : ''}">${x.kind === 'checkup' ? '!' : ICON.check}</span>
        <span><b>${esc(x.plant.name)}</b><br><span class="sub">${x.kind === 'checkup' ? 'Kontrolltermin – neues Foto machen' : esc(x.task.titel)}${daysUntil(x.date) < 0 ? ` · seit ${relDay(x.date).replace('vor ', '')}` : ''}</span></span></li>`).join('')}</ul>
    </div>` : ''}

    ${hasKey ? '' : `
    <div class="card warn">
      <div class="card-head">${ICON.key}<h3>Einmalig einrichten</h3></div>
      <p class="small">Für die Analyse braucht Flora Medici einen kostenlosen Google-Gemini-Schlüssel.</p>
      <div style="margin-top:12px"><button class="btn small" id="go-setup">Jetzt einrichten</button></div>
    </div>`}

    <div class="card">
      <div class="card-head">${ICON.stetho}<h2>${plant ? 'Wie geht es ihr heute?' : 'Neuer Patient: Was fehlt deiner Pflanze?'}</h2></div>
      <p class="small muted">${plant ? 'Fotografiere möglichst aus dem gleichen Blickwinkel wie beim letzten Mal.' : 'Mach 1–3 Fotos. Je mehr Details, desto genauer die Diagnose.'}</p>
      <div class="photo-grid" style="margin-top:12px">
        ${slots.map((label, i) => dd.images[i] ? `
          <div class="photo-slot filled"><img src="${dd.images[i]}" alt="Foto ${i + 1}">
            <button class="remove" data-remove="${i}" aria-label="Foto entfernen">${ICON.x}</button></div>` : `
          <button class="photo-slot" data-add="${i}">${i === dd.images.length ? ICON.plus : ''}<span>${label}</span></button>`).join('')}
      </div>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn" id="take-photo">${ICON.camera}Foto</button>
        <button class="btn secondary" id="pick-photo">${ICON.gallery}Galerie</button>
      </div>
    </div>

    <div class="card">
      ${plant ? '' : `<h3>Wo steht deine Pflanze?</h3>
      <div class="chips" style="margin:10px 0 14px">
        ${LOCATIONS.map((l) => `<button class="chip ${dd.location === l ? 'active' : ''}" data-loc="${esc(l)}">${esc(l)}</button>`).join('')}
      </div>`}
      <label class="field"><span>${plant ? 'Was hat sich seit dem letzten Termin getan? (optional)' : 'Was ist dir aufgefallen? (optional)'}</span>
        <textarea id="note" placeholder="${plant ? 'z. B. Plan eingehalten, neue Blätter kommen, unten noch ein gelbes Blatt …' : 'z. B. Untere Blätter werden gelb und fallen ab, gieße 2× pro Woche, steht am Ostfenster …'}">${esc(dd.note)}</textarea>
      </label>
    </div>

    <button class="btn" id="analyze" ${dd.images.length ? '' : 'disabled'}>${ICON.leaf}${plant ? 'Kontrolle starten' : 'Pflanze untersuchen'}</button>
    ${!plant && plants.length && !ps.enabled && pushSupported() && !store.get('fm.pushHintHidden') ? `
    <div class="card tint" style="margin-top:14px">
      <div class="card-head">${ICON.bell}<h3>Erinnerungen aufs iPhone?</h3></div>
      <p class="small">Flora Medici kann dich an Aufgaben und Kontrolltermine erinnern – als Mitteilung, auch wenn die App geschlossen ist.</p>
      <div class="btn-row" style="margin-top:10px"><button class="btn small ghost" id="hide-push-hint">Später</button><button class="btn small" id="go-push">Einrichten</button></div>
    </div>` : ''}
    <p class="disclaimer">Die KI-Einschätzung ersetzt keine Fachberatung. Du kannst jedes Ergebnis hinterfragen.</p>
  `;

  const addPhotos = async (src) => {
    if (dd.images.length >= MAX_PHOTOS) return toast(`Maximal ${MAX_PHOTOS} Fotos`);
    const imgs = await pickPhotos(src);
    dd.images = [...dd.images, ...imgs].slice(0, MAX_PHOTOS);
    render();
  };
  $('#go-setup')?.addEventListener('click', () => nav('settings'));
  $('#go-push')?.addEventListener('click', () => nav('settings'));
  $('#hide-push-hint')?.addEventListener('click', () => { store.set('fm.pushHintHidden', true); render(); });
  $$('[data-plant]', v).forEach((li) => li.addEventListener('click', () => nav(`plant/${li.dataset.plant}`)));
  $('#take-photo').addEventListener('click', () => addPhotos('camera'));
  $('#pick-photo').addEventListener('click', () => addPhotos('gallery'));
  $$('[data-add]', v).forEach((b) => b.addEventListener('click', () => addPhotos('camera')));
  $$('[data-remove]', v).forEach((b) => b.addEventListener('click', () => { dd.images.splice(+b.dataset.remove, 1); render(); }));
  $$('[data-loc]', v).forEach((b) => b.addEventListener('click', () => { dd.location = dd.location === b.dataset.loc ? '' : b.dataset.loc; dd.note = $('#note').value; render(); }));
  $('#note').addEventListener('input', (e) => { dd.note = e.target.value; });
  $('#analyze').addEventListener('click', () => runAnalysis(plant));
}

function renderLoading(v) {
  const L = state.loading;
  $('#btn-back').hidden = true;
  $('#tabbar').classList.add('hidden');
  v.innerHTML = `
    <div class="scan-wrap">${L.img ? `<img src="${L.img}" alt="">` : ''}
      <div class="scan-frame"><i></i><i></i><i></i><i></i></div><div class="scan-line"></div>
    </div>
    <p class="loading-text" id="loading-text">${esc(L.text)}</p>`;
}
const setLoadingText = (t) => { if (state.loading) { state.loading.text = t; const el = $('#loading-text'); if (el) el.textContent = t; } };

async function runAnalysis(plant) {
  if (!getSettings().apiKey) { toast('Bitte zuerst den KI-Schlüssel hinterlegen'); return nav('settings'); }
  const d = state.draft;
  const images = [...d.images];
  const lastVisit = plant?.visits[plant.visits.length - 1];
  const lines = [
    plant ? `Dies ist ein KONTROLLTERMIN für meine ${plant.name}${plant.botanisch ? ` (${plant.botanisch})` : ''}.` : 'Bitte untersuche meine Pflanze auf den Fotos.',
    (plant?.location || d.location) ? `Standort: ${plant?.location || d.location}.` : '',
    plant?.plan ? `Behandlungsplan seit letztem Termin: ${plant.plan.tasks.filter((t) => t.source === 'plan').map((t) => `${t.titel} (${t.done ? 'erledigt' : 'nicht abgehakt'})`).join('; ') || 'keine Aufgaben'}.` : '',
    d.note.trim() ? `Meine Beobachtungen: ${d.note.trim()}` : '',
    `Heutiges Datum: ${new Date().toLocaleDateString('de-DE')} (für die Jahreszeit).`,
  ].filter(Boolean).join('\n');
  const previous = lastVisit ? {
    dateText: fmtTimestamp(lastVisit.date),
    summary: `${lastVisit.result.zustand.titel} – ${lastVisit.result.diagnose_text}`.slice(0, 900),
    images: lastVisit.images.slice(0, 1),
  } : null;

  state.loading = { img: images[0], text: 'Ich schaue mir deine Pflanze genau an …' };
  render();
  try {
    const { result, turns } = await diagnose({ contextText: lines, images, previous }, setLoadingText);
    const visit = { id: uid(), date: Date.now(), kind: plant ? 'kontrolle' : 'erstbefund', images, note: d.note.trim(), result, turns, thread: [] };
    const p = plant ? await db.getPlant(plant.id) : {
      id: uid(), created: Date.now(), name: result.pflanze.name, botanisch: result.pflanze.botanisch, customName: false,
      location: d.location, cover: images[0], visits: [], plan: null, chat: [],
    };
    p.visits.push(visit);
    applyResultToPlant(p, visit);
    await db.putPlant(p);
    state.draft = { images: [], location: '', note: '', plantId: null };
    state.loading = null;
    afterChange();
    nav(`visit/${p.id}/${visit.id}`);
  } catch (e) {
    state.loading = null;
    render();
    toast(friendlyError(e), 5000);
  }
}

function applyResultToPlant(p, visit) {
  const r = visit.result;
  if (!p.customName && r.bild_ok) { p.name = r.pflanze.name; }
  if (r.pflanze.botanisch) p.botanisch = r.pflanze.botanisch;
  p.status = { status: r.zustand.status, titel: r.zustand.titel };
  p.cover = visit.images[0] || p.cover;
  if (r.bild_ok) p.plan = buildPlan(r, visit.id, p.plan);
}

/* ------------------------------------------------------------------ *
 * Meine Pflanzen
 * ------------------------------------------------------------------ */
async function renderPlants(v) {
  const plants = (await allPlants()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  v.innerHTML = `
    <h1 style="margin:8px 0 4px">Meine Pflanzen</h1>
    <p class="small muted" style="margin-bottom:14px">${plants.length ? `${plants.length} Patient${plants.length > 1 ? 'en' : ''} in deiner Pflanzenpraxis` : ''}</p>
    ${plants.length ? plants.map((p) => {
      const n = nextInfo(p);
      return `<button class="hist-item" data-open="${p.id}">
        <img src="${p.cover}" alt="">
        <div style="flex:1;min-width:0">
          <div class="t">${esc(p.name)}</div>
          <div>${badge(p.status?.status)}${n ? ` <span class="badge ${n.cls}">${esc(n.text)}</span>` : ''}</div>
          <div class="d">${p.visits.length} Untersuchung${p.visits.length > 1 ? 'en' : ''} · seit ${fmtTimestamp(p.created)}</div>
        </div>${ICON.chevron}
      </button>`;
    }).join('') : `<div class="empty">${ICON.leaf}<p>Noch keine Pflanzen.<br>Untersuche deine erste Pflanze!</p></div>`}
    <button class="btn secondary" id="new-plant" style="margin-top:8px">${ICON.plus}Neue Pflanze untersuchen</button>`;
  $$('[data-open]', v).forEach((b) => b.addEventListener('click', () => nav(`plant/${b.dataset.open}`)));
  $('#new-plant').addEventListener('click', () => nav('home'));
}

/* ------------------------------------------------------------------ *
 * Patientenakte einer Pflanze
 * ------------------------------------------------------------------ */
async function renderPlant(v, id) {
  const p = await db.getPlant(id);
  if (!p) { toast('Diese Pflanze gibt es nicht mehr'); return nav('plants'); }
  const plan = p.plan;
  const c = plan?.checkup;
  const open = (plan?.tasks || []).filter((t) => !t.done);
  const done = (plan?.tasks || []).filter((t) => t.done);
  const byDate = {};
  open.forEach((t) => (byDate[t.date] = byDate[t.date] || []).push(t));
  const lastQ = [...p.chat].reverse().find((m) => m.who === 'me');
  const ps = pushSettings();

  v.innerHTML = `
    <div class="card">
      <div class="result-head">
        <img src="${p.cover}" alt="">
        <div style="flex:1;min-width:0">
          <h2>${esc(p.name)} <button class="inline-btn" id="rename" aria-label="Umbenennen">${ICON.edit}</button></h2>
          ${p.botanisch ? `<div class="sci">${esc(p.botanisch)}</div>` : ''}
          ${badge(p.status?.status)}
        </div>
      </div>
      <p class="small muted" style="margin-top:10px">Patient seit ${fmtTimestamp(p.created)}${p.location ? ` · ${esc(p.location)}` : ''}${p.status?.titel ? ` · Befund: ${esc(p.status.titel)}` : ''}</p>
    </div>

    <div class="card ${c && !c.done && daysUntil(c.date) <= 0 ? 'warn' : 'tint'}">
      <div class="card-head">${ICON.calendar}<h3>${c && !c.done ? `Nächster Kontrolltermin: ${relDay(c.date)}` : 'Kontrolltermin'}</h3></div>
      ${c && !c.done ? `<p class="small">${fmtDate(c.date, { weekday: 'long', day: 'numeric', month: 'long' })}${c.foto ? ` – ${esc(c.foto)}` : ''}</p>` : '<p class="small">Zurzeit ist kein Termin geplant. Du kannst jederzeit eine Kontrolle machen.</p>'}
      <div style="margin-top:12px"><button class="btn" id="checkup">${ICON.camera}Kontrolle jetzt machen</button></div>
      ${ps.enabled ? `<p class="small muted" style="margin-top:8px">${ICON.bell.replace('<svg', '<svg style="width:15px;height:15px;vertical-align:-2px"')} Du bekommst eine Erinnerung um ${esc(ps.time)} Uhr.</p>` : ''}
    </div>

    <div class="card">
      <div class="card-head">${ICON.bulb}<h3>Behandlungsplan</h3></div>
      ${open.length ? Object.entries(byDate).map(([date, ts]) => `
        <div class="plan-day ${daysUntil(date) < 0 ? 'overdue' : daysUntil(date) === 0 ? 'today' : ''}">
          <div class="plan-date">${daysUntil(date) <= 0 ? (daysUntil(date) === 0 ? 'Heute' : `Überfällig (${fmtDate(date)})`) : `${relDay(date)[0].toUpperCase()}${relDay(date).slice(1)}${daysUntil(date) < 7 ? ` · ${fmtDate(date)}` : ''}`}</div>
          ${ts.map((t) => `<label class="task"><input type="checkbox" data-task="${t.id}"><span><b>${esc(t.titel)}</b>${t.details ? `<br><span class="sub">${esc(t.details)}</span>` : ''}</span></label>`).join('')}
        </div>`).join('') : '<p class="small muted">Keine offenen Aufgaben. 🌿</p>'}
      ${done.length ? `<details style="margin-top:8px"><summary class="small muted">${done.length} erledigt</summary>
        ${done.map((t) => `<label class="task done"><input type="checkbox" checked data-task="${t.id}"><span>${esc(t.titel)}</span></label>`).join('')}</details>` : ''}
    </div>

    <div class="card">
      <div class="card-head">${ICON.chat}<h3>Sprechstunde</h3></div>
      <p class="small muted">Frag mich alles zu deiner ${esc(p.name)} – ich kenne ihre Krankengeschichte.</p>
      ${lastQ ? `<p class="small" style="margin-top:8px">Zuletzt gefragt: „${esc(lastQ.text.slice(0, 80))}${lastQ.text.length > 80 ? '…' : ''}“</p>` : ''}
      <div class="chips" style="margin-top:10px">
        ${['Wie blüht sie prächtiger?', 'Wann und wie schneide ich sie?', 'Wann muss ich umtopfen?', 'Wie überwintere ich sie?']
          .map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
      </div>
      <div style="margin-top:12px"><button class="btn secondary" id="ask">${ICON.chat}${p.chat.length ? 'Gespräch fortsetzen' : 'Frage stellen'}</button></div>
    </div>

    <div class="card">
      <div class="card-head">${ICON.stetho}<h3>Krankengeschichte</h3></div>
      ${[...p.visits].reverse().map((vi) => {
        const t = TREND[vi.result.verlauf?.trend];
        return `<button class="visit-row" data-visit="${vi.id}">
          <img src="${vi.images[0]}" alt="">
          <span style="flex:1;min-width:0"><b>${vi.kind === 'kontrolle' ? 'Kontrolle' : 'Erstbefund'}</b> · ${fmtTimestamp(vi.date)}<br>
          <span class="sub">${esc(vi.result.zustand.titel || STATUS_LABEL[vi.result.zustand.status])}</span>
          ${t ? `<span class="badge ${t[1]}">${t[0]}</span>` : ''}</span>${ICON.chevron}</button>`;
      }).join('')}
    </div>

    <button class="btn ghost" id="delete" style="margin-top:4px">${ICON.trash}Pflanze aus der Praxis entfernen</button>`;

  $('#checkup').addEventListener('click', () => nav(`scan/${p.id}`));
  $('#ask').addEventListener('click', () => nav(`ask/${p.id}`));
  $$('[data-q]', v).forEach((b) => b.addEventListener('click', () => { state.askDraft = { text: b.dataset.q, images: [] }; nav(`ask/${p.id}`); }));
  $$('[data-visit]', v).forEach((b) => b.addEventListener('click', () => nav(`visit/${p.id}/${b.dataset.visit}`)));
  $$('[data-task]', v).forEach((cb) => cb.addEventListener('change', async () => {
    const fresh = await db.getPlant(p.id);
    const t = fresh.plan.tasks.find((x) => x.id === cb.dataset.task);
    if (t) t.done = cb.checked;
    await db.putPlant(fresh);
    afterChange();
    if (cb.checked) toast('Super, erledigt! 🌿');
    renderPlant(v, p.id);
  }));
  $('#rename').addEventListener('click', async () => {
    const name = prompt('Wie soll deine Pflanze heißen?', p.name);
    if (!name || !name.trim()) return;
    const fresh = await db.getPlant(p.id);
    fresh.name = name.trim().slice(0, 60);
    fresh.customName = true;
    await db.putPlant(fresh);
    afterChange();
    renderPlant(v, p.id);
  });
  $('#delete').addEventListener('click', async () => {
    if (!confirm(`„${p.name}“ mit allen Untersuchungen, Fotos und Fragen endgültig löschen?`)) return;
    await db.removePlant(p.id);
    afterChange();
    toast('Pflanze entfernt');
    nav('plants');
  });
}

/* ------------------------------------------------------------------ *
 * Untersuchungsergebnis
 * ------------------------------------------------------------------ */
async function renderVisit(v, plantId, visitId) {
  const p = await db.getPlant(plantId);
  const visit = p?.visits.find((x) => x.id === visitId);
  if (!visit) return nav(p ? `plant/${plantId}` : 'plants');
  const r = visit.result;
  const st = r.zustand.status;
  const stCls = statusClass(st);
  const isOk = stCls === 'ok';
  const careItems = [['licht', 'Licht', ICON.sun], ['temperatur', 'Temperatur', ICON.temp], ['giessen', 'Gießen', ICON.drop], ['bluete', 'Blüte', ICON.flower], ['standort', 'Standort', ICON.pin]].filter(([k]) => r.pflege[k]);
  const lowConfidence = r.pflanze.sicherheit < 75 || r.zustand.sicherheit < 75;
  const trend = TREND[r.verlauf.trend];
  const pr = r.pruefung;
  const isPlanVisit = p.plan?.visitId === visit.id;

  v.innerHTML = `
    <p class="small muted" style="margin:4px 0 10px">${visit.kind === 'kontrolle' ? 'Kontrolltermin' : 'Erstbefund'} vom ${fmtTimestamp(visit.date)}</p>
    ${!r.bild_ok ? `<div class="card warn"><div class="card-head">${ICON.camera}<h3>Ich brauche ein besseres Foto</h3></div>
      <p>${esc(r.bild_hinweis || 'Auf dem Foto kann ich die Pflanze nicht gut genug erkennen.')}</p></div>` : ''}

    <div class="card">
      <div class="result-head">
        <img src="${visit.images[0]}" alt="">
        <div><h2>${esc(r.pflanze.name)}</h2>${r.pflanze.botanisch ? `<div class="sci">${esc(r.pflanze.botanisch)}</div>` : ''}${badge(st)}</div>
      </div>
      ${meter('Sicherheit Pflanze', r.pflanze.sicherheit)}
      ${meter('Sicherheit Diagnose', r.zustand.sicherheit)}
      ${r.pflanze.alternativen.length ? `<p class="small muted" style="margin-top:10px">Könnte auch sein: ${r.pflanze.alternativen.map((a) => `${esc(a.name)} (${a.sicherheit} %)`).join(', ')}</p>` : ''}
    </div>

    ${pr ? `<div class="card ${pr.ergebnis === 'bestaetigt' ? 'tint' : pr.ergebnis === 'angepasst' ? 'tint' : 'warn'}">
      <div class="card-head">${ICON.shield}<h3>${{ bestaetigt: 'Zweitprüfung: bestätigt', angepasst: 'Zweitprüfung: korrigiert', unsicher: 'Zweitprüfung: noch unsicher', nicht_geprueft: 'Zweitprüfung nicht möglich' }[pr.ergebnis] || 'Zweitprüfung'}</h3></div>
      ${pr.hinweise ? `<p class="small">${esc(pr.hinweise)}</p>` : ''}</div>` : ''}

    ${trend ? `<div class="card ${trend[1] === 'ok' ? 'tint' : trend[1]}"><div class="card-head">${ICON.trend}<h3>Verlauf: ${trend[0]}</h3></div>
      <div class="speech">${paras(r.verlauf.text)}</div>
      ${visit.kind === 'kontrolle' && p.visits.length > 1 ? (() => {
        const prev = p.visits[p.visits.findIndex((x) => x.id === visit.id) - 1];
        return prev ? `<div class="compare"><figure><img src="${prev.images[0]}" alt=""><figcaption>Vorher · ${new Date(prev.date).toLocaleDateString('de-DE')}</figcaption></figure>
          <figure><img src="${visit.images[0]}" alt=""><figcaption>Jetzt</figcaption></figure></div>` : '';
      })() : ''}</div>` : ''}

    ${r.einleitung || r.pflege_text ? `
    <div class="card"><div class="card-head">${ICON.leaf}<h3>Deine Pflanze</h3></div>
      <div class="speech">${paras(r.einleitung)}${paras(r.pflege_text)}</div>
      ${careItems.length ? `<div class="care-grid" style="margin-top:14px">
        ${careItems.map(([k, label, icon], i) => `<div class="care-item ${careItems.length % 2 && i === careItems.length - 1 ? 'wide' : ''}">
          <div class="k">${icon}${label}</div><div class="v">${esc(r.pflege[k])}</div></div>`).join('')}</div>` : ''}
    </div>` : ''}

    ${r.natuerlich.ist_natuerlich ? `
    <div class="card tint"><div class="card-head">${ICON.leaf}<h3>Kein Grund zur Sorge</h3></div>
      <div class="speech">${paras(r.natuerlich.erklaerung || 'Was du hier siehst, ist ein ganz natürlicher Vorgang und keine Krankheit.')}</div></div>` : ''}

    <div class="card ${isOk ? 'tint' : stCls}">
      <div class="card-head">${isOk ? ICON.check : ICON.alert}<h3>${esc(r.zustand.titel || STATUS_LABEL[st])}</h3></div>
      <div class="speech">${paras(r.diagnose_text)}</div>
      ${r.symptome.length ? `<h3 style="margin-top:14px">Symptome</h3><ul class="list">
        ${r.symptome.map((x) => `<li><span class="dot sym">${ICON.check}</span><span>${esc(x)}</span></li>`).join('')}</ul>` : ''}
    </div>

    ${r.ursachen.length ? `<div class="card"><div class="card-head">${ICON.stetho}<h3>Mögliche Ursachen</h3></div>
      ${r.ursachen.map((u) => `<div class="cause">${meter(u.titel, u.wahrscheinlichkeit)}${u.erklaerung ? `<p class="small" style="margin-top:6px">${esc(u.erklaerung)}</p>` : ''}</div>`).join('')}</div>` : ''}

    ${r.massnahmen.length ? `<div class="card"><div class="card-head">${ICON.bulb}<h3>Was kannst du tun?</h3></div>
      <ul class="list">${r.massnahmen.map((m) => `<li><span class="dot ${m.dringend ? 'urgent' : ''}">${m.dringend ? '!' : ICON.check}</span>
        <span><b>${esc(m.titel)}</b>${m.dringend ? ' <span class="badge bad">dringend</span>' : ''}${m.details ? `<br><span class="sub">${esc(m.details)}</span>` : ''}</span></li>`).join('')}</ul></div>` : ''}

    ${isPlanVisit ? `<div class="card tint"><div class="card-head">${ICON.calendar}<h3>Dein Behandlungsplan</h3></div>
      <ul class="list">
        ${r.behandlungsplan.slice(0, 5).map((b) => `<li><span class="dot">${ICON.check}</span><span><b>${b.tag === 0 ? 'Heute' : b.tag === 1 ? 'Morgen' : `In ${b.tag} Tagen`}:</b> ${esc(b.titel)}</span></li>`).join('')}
        ${p.plan.checkup ? `<li><span class="dot urgent">!</span><span><b>Kontrolltermin ${relDay(p.plan.checkup.date)}</b>${relDay(p.plan.checkup.date) === fmtDate(p.plan.checkup.date) ? '' : ` (${fmtDate(p.plan.checkup.date)})`}: ${esc(p.plan.checkup.foto || 'neues Foto machen')}</span></li>` : ''}
      </ul>
      <div style="margin-top:12px"><button class="btn secondary" id="to-plant">Zur Patientenakte</button></div></div>` : ''}

    ${r.giftigkeit ? `<div class="card tint"><div class="card-head">${ICON.paw}<h3>Gut zu wissen</h3></div><p class="small">${esc(r.giftigkeit)}</p></div>` : ''}

    ${r.rueckfragen.length || r.fotowuensche.length ? `
    <div class="card ${lowConfidence ? 'warn' : ''}">
      <div class="card-head">${ICON.question}<h3>Damit ich sicherer werde</h3></div>
      ${r.unsicherheit ? `<p class="small" style="margin-bottom:12px">${esc(r.unsicherheit)}</p>` : ''}
      ${r.rueckfragen.map((q, i) => `<div class="qa"><div class="q">${esc(q)}</div><input type="text" data-answer="${i}" placeholder="Deine Antwort …"></div>`).join('')}
      ${r.fotowuensche.length ? `<div class="qa"><div class="q">Fotowunsch</div>
        <ul class="list">${r.fotowuensche.map((f) => `<li><span class="dot sym">${ICON.camera}</span><span>${esc(f)}</span></li>`).join('')}</ul>
        <div class="photo-grid" id="extra-photos" style="margin-top:8px"></div>
        <div class="btn-row" style="margin-top:8px"><button class="btn ghost small" id="extra-cam">${ICON.camera}Foto</button><button class="btn ghost small" id="extra-gal">${ICON.gallery}Galerie</button></div></div>` : ''}
      <div style="margin-top:14px"><button class="btn" id="send-answers">${ICON.check}Antworten senden</button></div>
    </div>` : ''}

    ${visit.thread.length ? `<div class="card" id="thread-card"><div class="card-head">${ICON.chat}<h3>Unser Gespräch</h3></div>
      <div class="thread">${visit.thread.map((m) => `<div class="bubble ${m.who}">${esc(m.text)}${(m.images || []).map((im) => `<img src="${im}" alt="">`).join('')}</div>`).join('')}</div></div>` : ''}

    <div class="card">
      <div class="card-head">${ICON.chat}<h3>Stimmt das? Hinterfrage mich!</h3></div>
      <p class="small muted">Wenn dir etwas komisch vorkommt, sag es mir – ich prüfe meine Einschätzung neu.</p>
      <div class="chips" style="margin-top:10px">
        ${['Ist das vielleicht ganz normal?', 'Das ist eine andere Pflanze', 'Die Diagnose passt nicht', 'Warum bist du so sicher?', 'Welche Ursachen gibt es noch?']
          .map((c) => `<button class="chip" data-chip="${esc(c)}">${esc(c)}</button>`).join('')}
      </div>
      <textarea id="challenge-text" style="margin-top:12px" placeholder="z. B. Ich gieße nur alle 2 Wochen, Staunässe kann es nicht sein."></textarea>
      <div class="photo-grid" id="challenge-photos" style="margin-top:8px"></div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn ghost small" id="challenge-photo" style="flex:0 0 auto" aria-label="Foto hinzufügen">${ICON.camera}</button>
        <button class="btn" id="challenge-send">Nachfragen</button>
      </div>
    </div>
    <p class="disclaimer">KI-Einschätzung ohne Gewähr${store.get('fm.lastModel') ? ` · Modell: ${esc(store.get('fm.lastModel'))}` : ''}</p>`;

  $('#to-plant')?.addEventListener('click', () => nav(`plant/${p.id}`));

  const extra = [];
  const drawExtra = () => { const el = $('#extra-photos'); if (el) { el.innerHTML = thumbs(extra); bindThumbs(el, extra, drawExtra); } };
  $('#extra-cam')?.addEventListener('click', async () => { extra.push(...await pickPhotos('camera')); extra.splice(MAX_PHOTOS); drawExtra(); });
  $('#extra-gal')?.addEventListener('click', async () => { extra.push(...await pickPhotos('gallery')); extra.splice(MAX_PHOTOS); drawExtra(); });
  $('#send-answers')?.addEventListener('click', (e) => {
    const text = r.rueckfragen.map((q, i) => ({ q, a: $(`[data-answer="${i}"]`)?.value.trim() })).filter((x) => x.a).map((x) => `Frage: ${x.q}\nMeine Antwort: ${x.a}`).join('\n\n');
    sendVisitFollowUp(p.id, visit.id, text, [...extra], e.currentTarget);
  });

  const chal = [];
  const drawChal = () => { const el = $('#challenge-photos'); el.innerHTML = thumbs(chal); bindThumbs(el, chal, drawChal); };
  $$('[data-chip]', v).forEach((b) => b.addEventListener('click', () => {
    const ta = $('#challenge-text');
    ta.value = ta.value ? `${ta.value.trim()} ${b.dataset.chip}` : b.dataset.chip;
  }));
  $('#challenge-photo').addEventListener('click', async () => { chal.push(...await pickPhotos('gallery')); chal.splice(MAX_PHOTOS); drawChal(); });
  $('#challenge-send').addEventListener('click', (e) => sendVisitFollowUp(p.id, visit.id, $('#challenge-text').value, [...chal], e.currentTarget));
}

async function sendVisitFollowUp(plantId, visitId, text, images, btn) {
  if (state.busy) return;
  if (!text.trim() && !images.length) return toast('Bitte schreib etwas oder füge ein Foto hinzu');
  state.busy = true;
  setBusy(btn, true, 'Ich prüfe das …');
  try {
    const p = await db.getPlant(plantId);
    const visit = p.visits.find((x) => x.id === visitId);
    const { result, turns } = await followUp(visit.turns, text.trim(), images);
    visit.thread.push({ who: 'me', text: text.trim() || 'Foto nachgereicht', images });
    visit.thread.push({ who: 'ai', text: result.antwort || 'Ich habe meine Einschätzung mit deinen Angaben aktualisiert.' });
    visit.turns = turns;
    visit.result = result;
    visit.images = [...visit.images, ...images];
    if (p.visits[p.visits.length - 1].id === visit.id) {
      const wasPlan = p.plan?.visitId === visit.id;
      if (!p.customName && result.bild_ok) p.name = result.pflanze.name;
      if (result.pflanze.botanisch) p.botanisch = result.pflanze.botanisch;
      p.status = { status: result.zustand.status, titel: result.zustand.titel };
      if (wasPlan && result.bild_ok) p.plan = buildPlan(result, visit.id, p.plan);
    }
    await db.putPlant(p);
    afterChange();
    state.busy = false;
    await render();
    setTimeout(() => $('#thread-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  } catch (e) {
    state.busy = false;
    setBusy(btn, false);
    toast(friendlyError(e), 5000);
  }
}

/* ------------------------------------------------------------------ *
 * Sprechstunde (Fragen zur Pflanze)
 * ------------------------------------------------------------------ */
function profileText(p) {
  const last = p.visits[p.visits.length - 1];
  const r = last?.result;
  const openTasks = (p.plan?.tasks || []).filter((t) => !t.done).map((t) => `${t.titel} (${fmtDate(t.date)})`).join('; ');
  return [
    `Name: ${p.name}${p.botanisch ? ` (${p.botanisch})` : ''}`,
    p.location ? `Standort: ${p.location}` : '',
    `Patient seit: ${fmtTimestamp(p.created)}, ${p.visits.length} Untersuchung(en)`,
    r ? `Letzter Befund (${fmtTimestamp(last.date)}): ${r.zustand.titel} – ${r.diagnose_text}`.slice(0, 700) : '',
    r?.pflege_text ? `Pflegeprofil: ${r.pflege_text}`.slice(0, 400) : '',
    openTasks ? `Offene Aufgaben: ${openTasks}` : '',
  ].filter(Boolean).join('\n');
}

function renderAnswer(m) {
  const a = m.answer || {};
  const mk = a.markierungen;
  const markImg = m.markImage;
  return `
    <div class="speech">${paras(a.antwort || m.text)}</div>
    ${markImg && mk?.punkte?.length ? `
      <figure class="marked">
        <div class="mark-wrap"><img src="${markImg}" alt="Dein Foto mit Markierungen">
          ${mk.punkte.map((pt, i) => `<span class="mark" style="left:${pt.x / 10}%;top:${pt.y / 10}%">${esc(pt.label || i + 1)}</span>`).join('')}
        </div>
        <figcaption><ul class="list">${mk.punkte.map((pt, i) => `<li><span class="dot urgent">${esc(pt.label || i + 1)}</span><span>${esc(pt.text)}</span></li>`).join('')}</ul>
        <p class="small muted">Markierungen von der KI auf deinem Foto – bitte vor dem Schneiden mit eigenen Augen prüfen.</p></figcaption>
      </figure>` : ''}
    ${a.skizze_svg ? `<figure class="sketch"><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(a.skizze_svg)}" alt="Skizze"><figcaption class="small muted">Schemaskizze</figcaption></figure>` : ''}
    ${a.schritte?.length ? `<ol class="steps-list">${a.schritte.map((s) => `<li><b>${esc(s.titel)}</b>${s.details ? `<br><span class="sub">${esc(s.details)}</span>` : ''}</li>`).join('')}</ol>` : ''}
    ${a.aufgaben?.length ? `<div class="tasks-offer">
      <div class="small" style="font-weight:600;margin-bottom:6px">${ICON.calendar.replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px"')} Termine dazu</div>
      ${a.aufgaben.map((t) => `<div class="small">• ${fmtDate(t.datum, { day: 'numeric', month: 'long', year: 'numeric' })}: ${esc(t.titel)}</div>`).join('')}
      ${m.tasksAdded ? '<p class="small" style="margin-top:6px;color:var(--green-600)">✓ In deinen Behandlungsplan übernommen</p>' : `<button class="btn small secondary" data-addtasks="${m.id}" style="margin-top:8px">Als Erinnerung übernehmen</button>`}
    </div>` : ''}
    ${a.rueckfragen?.length ? `<div class="small" style="margin-top:10px"><b>Damit ich genauer werde:</b> ${a.rueckfragen.map(esc).join(' · ')}</div>` : ''}
    <div class="selfcheck">${meter('Wie sicher ich mir bin', a.sicherheit || 0)}
      ${a.pruefung ? `<p class="small muted" style="margin-top:6px">${ICON.shield.replace('<svg', '<svg style="width:15px;height:15px;vertical-align:-3px"')} Selbstprüfung: ${esc(a.pruefung)}</p>` : ''}</div>`;
}

async function renderAsk(v, plantId) {
  const p = await db.getPlant(plantId);
  if (!p) return nav('plants');
  const d = state.askDraft;
  v.innerHTML = `
    <div class="ask-head"><img src="${p.cover}" alt=""><div><div class="small muted">Sprechstunde</div><b>${esc(p.name)}</b></div></div>
    <div class="thread chat" id="chat">
      ${p.chat.length ? '' : `<div class="bubble ai">Hallo! Ich kenne die Krankengeschichte deiner ${esc(p.name)}. Was möchtest du wissen? Bei Fragen zum Schneiden schick mir am besten ein aktuelles Foto – dann zeige ich dir direkt darauf, wo du schneiden solltest.</div>`}
      ${p.chat.map((m) => m.who === 'me'
        ? `<div class="bubble me">${esc(m.text)}${(m.images || []).map((im) => `<img src="${im}" alt="">`).join('')}</div>`
        : `<div class="bubble ai rich">${renderAnswer(m)}</div>`).join('')}
    </div>
    <div class="composer card">
      ${p.chat.length ? '' : `<div class="chips" style="margin-bottom:10px">
        ${['Wie blüht sie prächtiger?', 'Wann und wie schneide ich sie?', 'Welchen Dünger braucht sie?', 'Wann muss ich umtopfen?'].map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`}
      <div class="photo-grid" id="ask-photos"></div>
      <textarea id="ask-text" placeholder="Deine Frage …">${esc(d.text)}</textarea>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn ghost small" id="ask-cam" style="flex:0 0 auto" aria-label="Foto aufnehmen">${ICON.camera}</button>
        <button class="btn ghost small" id="ask-gal" style="flex:0 0 auto" aria-label="Foto aus Galerie">${ICON.gallery}</button>
        <button class="btn" id="ask-send">${ICON.send}Fragen</button>
      </div>
    </div>`;

  const drawPhotos = () => { const el = $('#ask-photos'); el.innerHTML = thumbs(d.images); el.style.marginBottom = d.images.length ? '10px' : '0'; bindThumbs(el, d.images, drawPhotos); };
  drawPhotos();
  $('#ask-text').addEventListener('input', (e) => { d.text = e.target.value; });
  $$('[data-q]', v).forEach((b) => b.addEventListener('click', () => { d.text = b.dataset.q; $('#ask-text').value = d.text; }));
  $('#ask-cam').addEventListener('click', async () => { d.images.push(...await pickPhotos('camera')); d.images.splice(2); drawPhotos(); });
  $('#ask-gal').addEventListener('click', async () => { d.images.push(...await pickPhotos('gallery')); d.images.splice(2); drawPhotos(); });
  $$('[data-addtasks]', v).forEach((b) => b.addEventListener('click', async () => {
    const fresh = await db.getPlant(p.id);
    const msg = fresh.chat.find((m) => m.id === b.dataset.addtasks);
    if (!msg) return;
    addQuestionTasks(fresh, msg.answer.aufgaben);
    msg.tasksAdded = true;
    await db.putPlant(fresh);
    afterChange();
    toast(pushSettings().enabled ? 'Übernommen – du wirst rechtzeitig erinnert' : 'In den Behandlungsplan übernommen');
    renderAsk(v, p.id);
  }));
  $('#ask-send').addEventListener('click', (e) => sendQuestion(p.id, e.currentTarget));
  if (p.chat.length) setTimeout(() => $('#chat').lastElementChild?.scrollIntoView({ block: 'start' }), 30);
}

async function sendQuestion(plantId, btn) {
  const d = state.askDraft;
  const q = d.text.trim();
  if (!q) return toast('Bitte schreib deine Frage');
  if (!getSettings().apiKey) { toast('Bitte zuerst den KI-Schlüssel hinterlegen'); return nav('settings'); }
  if (state.busy) return;
  state.busy = true;
  setBusy(btn, true, 'Ich überlege …');
  try {
    const p = await db.getPlant(plantId);
    const lastVisit = p.visits[p.visits.length - 1];
    const images = [...d.images, ...(lastVisit?.images || []).slice(0, d.images.length ? 1 : 2)].slice(0, 3);
    const history = p.chat.map((m) => ({ who: m.who, text: m.who === 'me' ? m.text : [m.answer?.antwort, ...(m.answer?.schritte || []).map((s) => `- ${s.titel}`)].filter(Boolean).join('\n') }));
    const answer = await askQuestion({ profileText: profileText(p), images, history, question: q });
    const markImage = answer.markierungen.punkte.length ? images[answer.markierungen.bild - 1] || '' : '';
    p.chat.push({ id: uid(), who: 'me', date: Date.now(), text: q, images: [...d.images] });
    p.chat.push({ id: uid(), who: 'ai', date: Date.now(), text: answer.antwort, answer, markImage, tasksAdded: false });
    await db.putPlant(p);
    state.askDraft = { text: '', images: [] };
    state.busy = false;
    await render();
    setTimeout(() => $('#chat')?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  } catch (e) {
    state.busy = false;
    setBusy(btn, false);
    toast(friendlyError(e), 5000);
  }
}

/* ------------------------------------------------------------------ *
 * Einstellungen
 * ------------------------------------------------------------------ */
function renderSettings(v) {
  const s = getSettings();
  const ps = pushSettings();
  v.innerHTML = `
    <h1 style="margin:8px 0 14px">Einstellungen</h1>
    <div class="card">
      <div class="card-head">${ICON.key}<h3>KI-Schlüssel (Google Gemini)</h3></div>
      <p class="small muted">Kostenlos. Wird nur auf diesem Gerät gespeichert.</p>
      <label class="field" style="margin-top:12px"><span>API-Schlüssel</span>
        <input type="password" id="api-key" value="${esc(s.apiKey)}" placeholder="AQ.… oder AIza…" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label class="switch" style="margin-top:14px"><input type="checkbox" id="verify" ${s.verify ? 'checked' : ''}>
        <span><b>Zweitprüfung jeder Diagnose</b><br><span class="small muted">Eine zweite, unabhängige KI-Prüfung hinterfragt jeden Befund. Empfohlen – braucht doppelt so viele KI-Anfragen.</span></span></label>
      <details style="margin-top:12px"><summary class="small muted">Erweitert</summary>
        <label class="field" style="margin-top:10px"><span>KI-Modell</span><input type="text" id="model" value="${esc(s.model)}" placeholder="auto" autocapitalize="off" spellcheck="false"></label>
        <p class="small muted" style="margin-top:6px">„auto“ wählt automatisch das beste kostenlose Modell.</p></details>
      <div class="btn-row" style="margin-top:14px"><button class="btn secondary" id="test">Testen</button><button class="btn" id="save">Speichern</button></div>
      <button class="btn ghost" id="help" style="margin-top:10px">${ICON.question}So bekommst du den Schlüssel</button>
    </div>

    <div class="card">
      <div class="card-head">${ICON.bell}<h3>Erinnerungen (Mitteilungen)</h3></div>
      <p class="small"><b>Status:</b> ${ps.enabled ? '✅ aktiv' : '⚪ nicht eingerichtet'}${ps.pending ? ' · ⚠️ Übertragung ausstehend' : ''}${ps.lastSync ? ` · zuletzt übertragen ${new Date(ps.lastSync).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}</p>
      ${!isStandalone() ? '<p class="small" style="margin-top:8px;color:var(--warn-ink)">Mitteilungen funktionieren auf dem iPhone nur, wenn du Flora Medici über das Symbol auf dem Home-Bildschirm öffnest.</p>' : ''}
      <label class="field" style="margin-top:12px"><span>Uhrzeit der Erinnerungen</span><input type="time" id="push-time" value="${esc(ps.time)}"></label>
      <label class="field" style="margin-top:12px"><span>GitHub-Zugangsschlüssel</span>
        <input type="password" id="push-token" value="${esc(ps.token)}" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <details style="margin-top:10px"><summary class="small muted">Erweitert</summary>
        <label class="field" style="margin-top:10px"><span>GitHub-Konto</span><input type="text" id="push-owner" value="${esc(ps.owner)}" autocapitalize="off" spellcheck="false"></label>
        <label class="field" style="margin-top:10px"><span>Repository</span><input type="text" id="push-repo" value="${esc(ps.repo)}" autocapitalize="off" spellcheck="false"></label></details>
      <button class="btn" id="push-setup" style="margin-top:14px">${ICON.bell}${ps.enabled ? 'Einstellungen übernehmen' : 'Mitteilungen einrichten'}</button>
      <p class="small muted" id="push-step" style="margin-top:8px;min-height:1.2em"></p>
      ${ps.enabled ? `<div class="btn-row"><button class="btn secondary small" id="push-test">Test senden</button><button class="btn ghost small" id="push-off">Ausschalten</button></div>` : ''}
      <button class="btn ghost" id="push-help" style="margin-top:10px">${ICON.question}Anleitung Mitteilungen</button>
    </div>

    <div class="card">
      <h3>Datenschutz</h3>
      <p class="small" style="margin-top:6px">Fotos werden zur Analyse an Google (Gemini API) gesendet; im kostenlosen Tarif darf Google sie zur Verbesserung seiner Dienste nutzen – keine Fotos mit Personen hochladen.
      Deine Pflanzen und Fotos werden nur auf diesem Gerät gespeichert. Für Mitteilungen werden nur Erinnerungstexte (Pflanzenname, Aufgabe, Zeitpunkt) verschlüsselt als GitHub-Secret abgelegt.</p>
      <button class="btn ghost small" id="wipe" style="margin-top:12px">${ICON.trash}Alle lokalen Daten löschen</button>
    </div>
    <p class="version">Flora Medici ${APP_VERSION} · Updates werden beim Start automatisch geladen</p>`;

  const saveAi = () => {
    store.set('fm.apiKey', $('#api-key').value.trim());
    store.set('fm.model', $('#model').value.trim() || 'auto');
    store.set('fm.verify', $('#verify').checked);
    store.del('fm.modelCache');
  };
  $('#save').addEventListener('click', () => { saveAi(); toast('Gespeichert'); nav('home'); });
  $('#verify').addEventListener('change', () => store.set('fm.verify', $('#verify').checked));
  $('#help').addEventListener('click', () => nav('help'));
  $('#push-help').addEventListener('click', () => nav('pushhelp'));
  $('#test').addEventListener('click', async (e) => {
    saveAi();
    setBusy(e.currentTarget, true, 'Teste …');
    try { toast(`KI-Verbindung klappt ✓ (${await testConnection()})`, 3500); } catch (err) { toast(friendlyError(err), 5000); }
    setBusy(e.currentTarget, false);
  });

  $('#push-setup').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const token = $('#push-token').value.trim();
    if (!token) { toast('Bitte zuerst den GitHub-Zugangsschlüssel einfügen'); return; }
    store.set('fm.push', { ...pushSettings(), owner: $('#push-owner').value.trim(), repo: $('#push-repo').value.trim() });
    setBusy(btn, true, 'Richte ein …');
    $('#push-step').classList.remove('error-box');
    // Wichtig: setupPush direkt (ohne vorheriges await) aufrufen – iOS verlangt die Erlaubnisabfrage direkt nach dem Tippen.
    setupPush({ token, time: $('#push-time').value }, [], (t) => { $('#push-step').textContent = t; })
      .then(async (res) => {
        await syncReminders(await allPlants(), { force: true });
        if (res?.testOk) { toast('Fertig! Die Test-Mitteilung kommt in 1–2 Minuten. 🔔', 5000); render(); return; }
        await render();
        const el = $('#push-step');
        if (el) { el.classList.add('error-box'); el.textContent = `Mitteilungen sind eingerichtet ✅ – nur der Test konnte nicht gestartet werden. ${res?.testError || ''}`; }
      })
      .catch((err) => {
        const el = $('#push-step');
        el.classList.add('error-box');
        el.textContent = `❌ ${err.message || 'Einrichtung fehlgeschlagen'}`;
        setBusy(btn, false);
      });
  });
  $('#push-test')?.addEventListener('click', async (e) => {
    setBusy(e.currentTarget, true, 'Sende …');
    try { await sendTest(); toast('Angefordert – die Mitteilung kommt in 1–2 Minuten.', 4000); } catch (err) { toast(err.message, 5000); }
    setBusy(e.currentTarget, false);
  });
  $('#push-off')?.addEventListener('click', () => { if (confirm('Erinnerungen wirklich ausschalten?')) { disablePush(); render(); } });
  $('#wipe').addEventListener('click', async () => {
    if (!confirm('Alle Pflanzen, Fotos, Fragen und Schlüssel auf diesem Gerät löschen?')) return;
    await db.clearAll();
    disablePush();
    ['fm.apiKey', 'fm.model', 'fm.modelCache', 'fm.lastModel', 'fm.push', 'fm.verify'].forEach((k) => store.del(k));
    toast('Alle Daten gelöscht');
    afterChange();
    render();
  });
}

function renderHelp(v) {
  v.innerHTML = `
    <h1 style="margin:8px 0 14px">Kostenlosen KI-Schlüssel holen</h1>
    <div class="card"><ol class="steps">
      <li>Öffne <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> und melde dich mit deinem Google-Konto an.</li>
      <li>Auf <b>„API-Schlüssel erstellen“</b> tippen.</li>
      <li>Den Schlüssel über <b>„Copy key“</b> vollständig kopieren (beginnt meist mit <code>AQ.</code>).</li>
      <li>Hier unter <b>Einstellungen</b> einfügen, „Testen“ und „Speichern“.</li>
    </ol></div>
    <div class="card tint"><p class="small">Es fallen keine Kosten an, solange du in Google AI Studio <b>keine</b> Abrechnung (Billing) aktivierst.</p></div>
    <button class="btn" id="back-settings">Zurück</button>`;
  $('#back-settings').addEventListener('click', () => nav('settings'));
}

function renderPushHelp(v) {
  const ps = pushSettings();
  v.innerHTML = `
    <h1 style="margin:8px 0 14px">Mitteilungen einrichten</h1>
    <div class="card"><h3>1. GitHub-Zugangsschlüssel erstellen (am Computer)</h3><ol class="steps small">
      <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a> öffnen.</li>
      <li>Name: <b>Flora Medici</b>, Ablauf: maximal.</li>
      <li>Repository access: <b>Only select repositories</b> → <b>${esc(ps.repo)}</b>.</li>
      <li>Permissions → Repository: <b>Actions</b> und <b>Secrets</b> jeweils auf <b>Read and write</b>.</li>
      <li><b>Generate token</b> → Schlüssel kopieren (beginnt mit <code>github_pat_</code>).</li></ol></div>
    <div class="card"><h3>2. In der App eintragen (am iPhone)</h3><ol class="steps small">
      <li>Flora Medici über das Home-Bildschirm-Symbol öffnen.</li>
      <li>Einstellungen → Erinnerungen → Schlüssel einfügen, Uhrzeit wählen.</li>
      <li><b>Mitteilungen einrichten</b> tippen und <b>Erlauben</b> wählen.</li></ol></div>
    <div class="card"><h3>3. Taktgeber bei cron-job.org</h3><ol class="steps small">
      <li>Neuen Cronjob anlegen, alle <b>15 Minuten</b>.</li>
      <li>URL: <code style="word-break:break-all">https://api.github.com/repos/${esc(ps.owner)}/${esc(ps.repo)}/actions/workflows/push.yml/dispatches</code></li>
      <li>Methode <b>POST</b>, Body: <code>{"ref":"&lt;Branch&gt;"}</code></li>
      <li>Header: <code>Authorization: Bearer &lt;GitHub-Schlüssel&gt;</code>, <code>Accept: application/vnd.github+json</code></li></ol>
      <p class="small muted" style="margin-top:6px">Genau wie bei deiner Solux-App – die ausführliche Anleitung steht in der README.</p></div>
    <button class="btn" id="back-settings">Zurück</button>`;
  $('#back-settings').addEventListener('click', () => nav('settings'));
}

/* ------------------------------------------------------------------ *
 * Automatische Updates beim Start (Service Worker)
 * ------------------------------------------------------------------ */
function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    try { sessionStorage.setItem('fm.updated', '1'); } catch { /* egal */ }
    window.location.reload();
  });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate' && e.data.hash) nav(e.data.hash.replace(/^#/, ''));
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    reg.update();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { reg.update(); allPlants().then(updateBadge); render(); } });
  }).catch(() => { /* z. B. privater Modus */ });
}

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */
(async function start() {
  initPhotoInputs();
  initServiceWorker();
  await db.migrate();
  await render();
  const plants = await allPlants();
  updateBadge(plants);
  syncReminders(plants); // holt ausstehende Übertragungen nach (nur wenn Mitteilungen aktiv)
  try {
    if (sessionStorage.getItem('fm.updated')) { sessionStorage.removeItem('fm.updated'); toast(`Flora Medici wurde aktualisiert (v${APP_VERSION})`); }
  } catch { /* egal */ }
}());
