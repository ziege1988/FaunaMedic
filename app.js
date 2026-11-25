/* FaunaMedic – Dein Pflanzendoktor
 * Reine Client-App (PWA). KI: Google Gemini API (Free Tier) mit eigenem API-Schlüssel.
 * Alle Daten bleiben auf dem Gerät (IndexedDB / localStorage).
 */
'use strict';

const APP_VERSION = '1.0.0';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash'];
const MAX_PHOTOS = 3;

/* ------------------------------------------------------------------ *
 * Hilfsfunktionen
 * ------------------------------------------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (n, a, b) => Math.min(b, Math.max(a, Number.isFinite(+n) ? +n : 0));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const paras = (text) => String(text || '').split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');

const store = {
  get(key, def = null) { try { const v = localStorage.getItem(key); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* Speicher nicht verfügbar */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* egal */ } },
};

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

const ICON = {
  camera: '<svg viewBox="0 0 24 24"><path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="4"/></svg>',
  gallery: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/></svg>',
  leaf: '<svg viewBox="0 0 24 24"><path d="M5 19c0-8 6-14 14-14-1 8-6 14-14 14z"/><path d="M5 19l7-7"/></svg>',
  bulb: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  temp: '<svg viewBox="0 0 24 24"><path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/></svg>',
  drop: '<svg viewBox="0 0 24 24"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
  flower: '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="2.5"/><path d="M12 6.5C12 4 10 3 9 4s0 3.5 3 5c3-1.5 4-4 3-5s-3 0-3 2.5zM12 11.5V21M12 17c-2-2-4-2-5-1M12 15c2-2 4-2 5-1"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  paw: '<svg viewBox="0 0 24 24"><circle cx="6" cy="10" r="2"/><circle cx="10" cy="6" r="2"/><circle cx="14" cy="6" r="2"/><circle cx="18" cy="10" r="2"/><path d="M8 17c0-3 2-5 4-5s4 2 4 5c0 2-2 2-4 2s-4 0-4-2z"/></svg>',
  question: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  key: '<svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/></svg>',
  stetho: '<svg viewBox="0 0 24 24"><path d="M6 3v6a4 4 0 0 0 8 0V3M10 13v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
};

/* ------------------------------------------------------------------ *
 * Lokale Datenbank (IndexedDB) für den Verlauf inkl. Fotos
 * ------------------------------------------------------------------ */
const db = {
  _p: null,
  open() {
    if (this._p) return this._p;
    this._p = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB nicht verfügbar'));
      const req = indexedDB.open('faunamedic', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('analyses', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._p;
  },
  async tx(mode, fn) {
    const d = await this.open();
    return new Promise((resolve, reject) => {
      const t = d.transaction('analyses', mode);
      const r = fn(t.objectStore('analyses'));
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
    });
  },
  put(item) { return this.tx('readwrite', (s) => s.put(item)).catch(() => toast('Speichern im Verlauf nicht möglich')); },
  get(id) { return this.tx('readonly', (s) => s.get(id)).catch(() => null); },
  all() { return this.tx('readonly', (s) => s.getAll()).catch(() => []); },
  remove(id) { return this.tx('readwrite', (s) => s.delete(id)).catch(() => null); },
};

/* ------------------------------------------------------------------ *
 * Bilder verkleinern (spart Datenvolumen und KI-Kontingent)
 * ------------------------------------------------------------------ */
function compressImage(file, maxSide = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden')); };
    img.src = url;
  });
}

let pickResolver = null;
function pickPhotos(source) {
  return new Promise((resolve) => {
    pickResolver = resolve;
    const input = source === 'camera' ? $('#file-camera') : $('#file-gallery');
    input.value = '';
    input.click();
  });
}
['#file-camera', '#file-gallery'].forEach((sel) => {
  $(sel).addEventListener('change', async (e) => {
    const files = [...e.target.files];
    const out = [];
    for (const f of files) {
      try { out.push(await compressImage(f)); } catch (err) { toast(err.message); }
    }
    if (pickResolver) { pickResolver(out); pickResolver = null; }
  });
});

/* ------------------------------------------------------------------ *
 * KI: Google Gemini
 * ------------------------------------------------------------------ */
const SYSTEM_PROMPT = `Du bist "FaunaMedic", ein erfahrener, warmherziger Pflanzendoktor (Zimmer-, Balkon- und Gartenpflanzen).
Deine Hauptaufgabe ist NICHT nur das Bestimmen der Pflanze, sondern vor allem zu erkennen, WAS DER PFLANZE FEHLT:
z. B. zu nass, zu trocken, zu dunkel, zu viel direkte Sonne/Sonnenbrand, Kälte/Zugluft, Nährstoffmangel, Überdüngung,
Wurzelfäule, Schädlinge (Spinnmilben, Thripse, Woll-/Schmierläuse, Blattläuse, Trauermücken …), Pilz-/Bakterienkrankheiten,
Umtopfstress, zu kleiner Topf, kalkhaltiges Wasser, trockene Heizungsluft usw.

Arbeitsweise:
1. Bestimme die Pflanze so genau wie möglich (deutscher Name + botanischer Name).
2. Untersuche sorgfältig Blätter (Farbe, Ränder, Flecken, Glanz, Unterseite), Stängel, Erde, Topf, Umgebung.
3. Leite Symptome ab und ordne sie wahrscheinlichen Ursachen zu.
4. Sei EHRLICH und KALIBRIERT bei den Prozentwerten. Übertreibe Sicherheit nie. Wenn Details fehlen oder das Bild unscharf ist,
   senke die Sicherheit und stelle gezielte Rückfragen (z. B. "Wie oft gießt du?", "Steht sie am Südfenster?")
   oder fordere konkrete Fotos an (z. B. "Nahaufnahme der Blattunterseite", "Foto der Erde/Wurzeln").
   Bei Sicherheit unter 75 % (Pflanze oder Diagnose) MUSST du mindestens eine Rückfrage oder einen Fotowunsch angeben.
5. Wenn der Nutzer deinen Treffer hinterfragt oder Antworten/Fotos nachreicht: Prüfe deine Einschätzung ernsthaft neu,
   ändere sie, wenn die Argumente stichhaltig sind, und erkläre im Feld "antwort" kurz und offen, warum du bei deiner
   Einschätzung bleibst oder sie änderst. Gib immer das VOLLSTÄNDIGE aktualisierte Ergebnis zurück.

Tonfall: persönlich, duzen, freundlich, klar und kurz, ohne Fachchinesisch (Fachbegriffe nur mit Erklärung). Sprache: Deutsch.
Die Texte sollen sich lesen wie:
- einleitung: "Was wir hier sehen, ist eine …" (1–2 Sätze, gern mit einem netten Detail zur Pflanze)
- pflege_text: "Deine Pflanze liebt … und fühlt sich bei Temperaturen zwischen … am wohlsten. Damit sie blüht, braucht sie …"
- diagnose_text: "Auf dem Foto erkenne ich, dass es deiner Pflanze nicht so gut geht. Sie zeigt …" (oder positiv, falls gesund)
- massnahmen: konkrete, umsetzbare Schritte in sinnvoller Reihenfolge ("Was kannst du dagegen tun?")
Empfehle Pflanzenschutzmittel nur als letzte Option und nenne dann zuerst schonende/biologische Varianten.

Antworte AUSSCHLIESSLICH mit gültigem JSON (kein Markdown) in genau diesem Format:
{
  "bild_ok": true,
  "bild_hinweis": "",
  "antwort": "",
  "pflanze": { "name": "", "botanisch": "", "sicherheit": 0, "alternativen": [ { "name": "", "sicherheit": 0 } ] },
  "zustand": { "status": "gesund|leicht|mittel|stark", "titel": "", "sicherheit": 0 },
  "einleitung": "",
  "pflege_text": "",
  "pflege": { "licht": "", "temperatur": "", "giessen": "", "bluete": "", "standort": "" },
  "diagnose_text": "",
  "symptome": [ "" ],
  "ursachen": [ { "titel": "", "erklaerung": "", "wahrscheinlichkeit": 0 } ],
  "massnahmen": [ { "titel": "", "details": "", "dringend": false } ],
  "rueckfragen": [ "" ],
  "fotowuensche": [ "" ],
  "giftigkeit": "",
  "unsicherheit": ""
}
Regeln: "sicherheit"/"wahrscheinlichkeit" sind ganze Zahlen 0–100. "zustand.titel" ist die Hauptdiagnose in 2–5 Wörtern
(z. B. "Staunässe", "Spinnmilbenbefall", "Gesund & munter"). "ursachen" nach Wahrscheinlichkeit absteigend, max. 4.
"massnahmen" max. 6. "giftigkeit": kurzer Hinweis, ob giftig für Katzen/Hunde/Kinder (leer, wenn unbekannt).
"antwort" nur füllen, wenn der Nutzer etwas nachgefragt/nachgereicht hat. Ist auf dem Bild keine Pflanze erkennbar
oder ist es unbrauchbar: "bild_ok": false und in "bild_hinweis" erklären, welches Foto du brauchst.`;

function getSettings() {
  return { apiKey: store.get('fm.apiKey', ''), model: store.get('fm.model', 'auto') };
}

async function apiFetch(path, opts = {}) {
  const { apiKey } = getSettings();
  const res = await fetch(`${API_BASE}/${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error?.message || ''; } catch { /* egal */ }
    const err = new Error(msg || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Ermittelt automatisch die besten verfügbaren kostenlosen "Flash"-Modelle (robust gegen Modellwechsel bei Google). */
async function resolveModels() {
  const { model } = getSettings();
  if (model && model !== 'auto') return [model, ...FALLBACK_MODELS.filter((m) => m !== model)];
  const cached = store.get('fm.modelCache');
  if (cached && Date.now() - cached.t < 24 * 3600 * 1000 && cached.list?.length) return cached.list;
  try {
    const data = await apiFetch('models?pageSize=200');
    const list = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/(image|tts|audio|live|thinking|exp|robotics|computer|native)/.test(n))
      .sort((a, b) => {
        const score = (n) => {
          const v = parseFloat(n.match(/gemini-([\d.]+)/)?.[1] || '0');
          return v * 100 - (/preview/.test(n) ? 50 : 0) - (/lite/.test(n) ? 20 : 0) - (/-\d{3,}$/.test(n) ? 1 : 0);
        };
        return score(b) - score(a);
      });
    const merged = [...new Set([...list.slice(0, 4), ...FALLBACK_MODELS])];
    store.set('fm.modelCache', { t: Date.now(), list: merged });
    return merged;
  } catch (e) {
    if (e.status === 400 || e.status === 401 || e.status === 403) throw e;
    return FALLBACK_MODELS;
  }
}

function parseJson(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* weiter */ }
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('Antwort der KI war unvollständig');
}

function friendlyError(e) {
  if (!navigator.onLine) return 'Du bist offline. Für die Analyse brauchst du eine Internetverbindung.';
  if (e.status === 400 && /api key/i.test(e.message)) return 'Der API-Schlüssel ist ungültig. Bitte prüfe ihn in den Einstellungen.';
  if (e.status === 401 || e.status === 403) return 'Zugriff verweigert – bitte prüfe deinen API-Schlüssel in den Einstellungen.';
  if (e.status === 429) return 'Das kostenlose KI-Kontingent ist gerade aufgebraucht. Bitte versuche es in einer Minute (oder morgen) erneut.';
  if (e.status >= 500) return 'Der KI-Dienst ist gerade überlastet. Bitte versuche es gleich noch einmal.';
  return 'Analyse fehlgeschlagen: ' + (e.message || 'Unbekannter Fehler');
}

/** turns: [{ role: 'user'|'model', text, images: [dataURL] }] */
async function askGemini(turns) {
  const contents = turns.map((t) => ({
    role: t.role,
    parts: [
      ...(t.images || []).map((d) => ({ inline_data: { mime_type: 'image/jpeg', data: d.split(',')[1] } })),
      ...(t.text ? [{ text: t.text }] : []),
    ],
  }));
  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents,
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
  };
  const models = await resolveModels();
  let lastErr;
  for (const m of models) {
    try {
      const data = await apiFetch(`models/${encodeURIComponent(m)}:generateContent`, { method: 'POST', body: JSON.stringify(body) });
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!text) throw Object.assign(new Error('Leere Antwort (evtl. vom Sicherheitsfilter blockiert)'), { status: 0 });
      store.set('fm.lastModel', m);
      return { raw: text, result: normalize(parseJson(text)) };
    } catch (e) {
      lastErr = e;
      // Ungültiger Schlüssel → sofort abbrechen. Modell nicht vorhanden/überlastet/Kontingent → nächstes Modell probieren.
      if ((e.status === 400 && /api key/i.test(e.message)) || e.status === 401 || e.status === 403) break;
      if (e.status === 404) store.del('fm.modelCache');
    }
  }
  throw lastErr;
}

function normalize(r) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  const str = (x) => (typeof x === 'string' ? x.trim() : '');
  const p = r.pflanze || {};
  const z = r.zustand || {};
  const status = ['gesund', 'leicht', 'mittel', 'stark'].includes(z.status) ? z.status : 'leicht';
  return {
    bild_ok: r.bild_ok !== false,
    bild_hinweis: str(r.bild_hinweis),
    antwort: str(r.antwort),
    pflanze: {
      name: str(p.name) || 'Unbekannte Pflanze',
      botanisch: str(p.botanisch),
      sicherheit: clamp(p.sicherheit, 0, 100),
      alternativen: arr(p.alternativen).filter((a) => a && a.name).map((a) => ({ name: str(a.name), sicherheit: clamp(a.sicherheit, 0, 100) })).slice(0, 3),
    },
    zustand: { status, titel: str(z.titel), sicherheit: clamp(z.sicherheit, 0, 100) },
    einleitung: str(r.einleitung),
    pflege_text: str(r.pflege_text),
    pflege: Object.fromEntries(['licht', 'temperatur', 'giessen', 'bluete', 'standort'].map((k) => [k, str((r.pflege || {})[k])])),
    diagnose_text: str(r.diagnose_text),
    symptome: arr(r.symptome).map(str).filter(Boolean),
    ursachen: arr(r.ursachen).filter((u) => u && u.titel).map((u) => ({ titel: str(u.titel), erklaerung: str(u.erklaerung), wahrscheinlichkeit: clamp(u.wahrscheinlichkeit, 0, 100) })).sort((a, b) => b.wahrscheinlichkeit - a.wahrscheinlichkeit),
    massnahmen: arr(r.massnahmen).filter((m) => m && m.titel).map((m) => ({ titel: str(m.titel), details: str(m.details), dringend: !!m.dringend })),
    rueckfragen: arr(r.rueckfragen).map(str).filter(Boolean),
    fotowuensche: arr(r.fotowuensche).map(str).filter(Boolean),
    giftigkeit: str(r.giftigkeit),
    unsicherheit: str(r.unsicherheit),
  };
}

/* ------------------------------------------------------------------ *
 * App-Zustand & Navigation
 * ------------------------------------------------------------------ */
const state = {
  view: 'home',
  draft: { images: [], location: '', note: '' },
  session: null, // aktuelle Analyse
  busy: false,
};

const LOCATIONS = ['Wohnung', 'Balkon / Terrasse', 'Garten', 'Gewächshaus'];

function go(view, opts = {}) {
  state.view = view;
  const isRoot = view === 'home' || view === 'history';
  $('#btn-back').hidden = isRoot;
  $('#tabbar').classList.toggle('hidden', !isRoot);
  $$('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.nav === view));
  if (!opts.keepScroll) window.scrollTo(0, 0);
  render();
}

function render() {
  const v = $('#view');
  switch (state.view) {
    case 'home': return renderHome(v);
    case 'analyzing': return renderAnalyzing(v);
    case 'result': return renderResult(v);
    case 'history': return renderHistory(v);
    case 'settings': return renderSettings(v);
    case 'help': return renderHelp(v);
    default: return renderHome(v);
  }
}

$('#btn-back').addEventListener('click', () => {
  if (state.view === 'result' && state.session) return go(state.session.fromHistory ? 'history' : 'home');
  if (state.view === 'help') return go('settings');
  go('home');
});
$('#btn-settings').addEventListener('click', () => go('settings'));
$('#brand').addEventListener('click', () => go('home'));
$$('#tabbar button').forEach((b) => b.addEventListener('click', () => go(b.dataset.nav)));

/* ------------------------------------------------------------------ *
 * Startseite
 * ------------------------------------------------------------------ */
function renderHome(v) {
  const d = state.draft;
  const hasKey = !!getSettings().apiKey;
  const slots = ['Ganze Pflanze', 'Problemstelle (nah)', 'Erde / Blattunterseite'];
  v.innerHTML = `
    <section class="hero">
      <img src="icons/logo.svg" alt="FaunaMedic Logo">
      <h1>Fauna<span>Medic</span></h1>
      <div class="tagline">Erkennen · Analysieren · Helfen</div>
    </section>

    ${hasKey ? '' : `
    <div class="card warn">
      <div class="card-head">${ICON.key}<h3>Einmalig einrichten</h3></div>
      <p class="small">Für die Analyse braucht FaunaMedic einen kostenlosen Google-Gemini-Schlüssel. Das dauert ca. 2 Minuten.</p>
      <div style="margin-top:12px"><button class="btn small" id="go-setup">Jetzt einrichten</button></div>
    </div>`}

    <div class="card">
      <div class="card-head">${ICON.stetho}<h2>Was fehlt deiner Pflanze?</h2></div>
      <p class="small muted">Mach 1–3 Fotos. Je mehr Details, desto genauer die Diagnose.</p>
      <div class="photo-grid" style="margin-top:12px">
        ${slots.map((label, i) => d.images[i] ? `
          <div class="photo-slot filled"><img src="${d.images[i]}" alt="Foto ${i + 1}">
            <button class="remove" data-remove="${i}" aria-label="Foto entfernen">${ICON.x}</button></div>` : `
          <button class="photo-slot" data-add="${i}">${i === d.images.length ? ICON.plus : ''}<span>${label}</span></button>`).join('')}
      </div>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn" id="take-photo">${ICON.camera}Foto</button>
        <button class="btn secondary" id="pick-photo">${ICON.gallery}Galerie</button>
      </div>
    </div>

    <div class="card">
      <h3>Wo steht deine Pflanze?</h3>
      <div class="chips" style="margin-top:10px">
        ${LOCATIONS.map((l) => `<button class="chip ${d.location === l ? 'active' : ''}" data-loc="${esc(l)}">${esc(l)}</button>`).join('')}
      </div>
      <label class="field" style="margin-top:14px"><span>Was ist dir aufgefallen? (optional)</span>
        <textarea id="note" placeholder="z. B. Seit einer Woche gelbe Blätter, gieße 2× pro Woche, steht am Ostfenster …">${esc(d.note)}</textarea>
      </label>
    </div>

    <button class="btn" id="analyze" ${d.images.length ? '' : 'disabled'}>${ICON.leaf}Pflanze analysieren</button>
    <p class="disclaimer">Die KI-Einschätzung ersetzt keine Fachberatung. Du kannst jedes Ergebnis hinterfragen.</p>
  `;

  const addPhotos = async (src) => {
    const imgs = await pickPhotos(src);
    d.images = [...d.images, ...imgs].slice(0, MAX_PHOTOS);
    if (imgs.length && d.images.length >= MAX_PHOTOS) toast(`Maximal ${MAX_PHOTOS} Fotos`);
    render();
  };
  $('#go-setup')?.addEventListener('click', () => go('settings'));
  $('#take-photo').addEventListener('click', () => (d.images.length >= MAX_PHOTOS ? toast(`Maximal ${MAX_PHOTOS} Fotos`) : addPhotos('camera')));
  $('#pick-photo').addEventListener('click', () => (d.images.length >= MAX_PHOTOS ? toast(`Maximal ${MAX_PHOTOS} Fotos`) : addPhotos('gallery')));
  $$('[data-add]', v).forEach((b) => b.addEventListener('click', () => addPhotos('camera')));
  $$('[data-remove]', v).forEach((b) => b.addEventListener('click', () => { d.images.splice(+b.dataset.remove, 1); render(); }));
  $$('[data-loc]', v).forEach((b) => b.addEventListener('click', () => { d.location = d.location === b.dataset.loc ? '' : b.dataset.loc; d.note = $('#note').value; render(); }));
  $('#note').addEventListener('input', (e) => { d.note = e.target.value; });
  $('#analyze').addEventListener('click', startAnalysis);
}

/* ------------------------------------------------------------------ *
 * Analyse
 * ------------------------------------------------------------------ */
async function startAnalysis() {
  if (!getSettings().apiKey) { toast('Bitte zuerst den API-Schlüssel hinterlegen'); return go('settings'); }
  const d = state.draft;
  const ctx = [
    'Bitte analysiere meine Pflanze auf den Fotos.',
    d.location ? `Standort: ${d.location}.` : '',
    d.note.trim() ? `Meine Beobachtungen: ${d.note.trim()}` : '',
    `Heutiges Datum: ${new Date().toLocaleDateString('de-DE')} (für saisonale Einordnung).`,
  ].filter(Boolean).join('\n');

  state.session = {
    id: uid(),
    date: Date.now(),
    images: [...d.images],
    turns: [{ role: 'user', text: ctx, images: [...d.images] }],
    thread: [],
    result: null,
  };
  go('analyzing');
  try {
    const { raw, result } = await askGemini(state.session.turns);
    state.session.turns.push({ role: 'model', text: raw });
    state.session.result = result;
    await db.put(state.session);
    state.draft = { images: [], location: '', note: '' };
    go('result');
  } catch (e) {
    go('home');
    toast(friendlyError(e), 5000);
  }
}

function renderAnalyzing(v) {
  const img = state.session?.images[0];
  v.innerHTML = `
    <div class="scan-wrap">${img ? `<img src="${img}" alt="">` : ''}
      <div class="scan-frame"><i></i><i></i><i></i><i></i></div><div class="scan-line"></div>
    </div>
    <p class="loading-text" id="loading-text">Ich schaue mir deine Pflanze genau an …</p>`;
  const msgs = ['Ich schaue mir deine Pflanze genau an …', 'Blätter, Farbe und Struktur werden geprüft …', 'Symptome werden abgeglichen …', 'Ich schreibe dir gleich meine Einschätzung …'];
  let i = 0;
  const t = setInterval(() => {
    const el = $('#loading-text');
    if (!el || state.view !== 'analyzing') return clearInterval(t);
    el.textContent = msgs[++i % msgs.length];
  }, 2200);
}

/** Folgefrage / Hinterfragen / Antworten / Zusatzfotos */
async function sendFollowUp(text, images = [], btn) {
  const s = state.session;
  if (!s || state.busy) return;
  if (!text.trim() && !images.length) return toast('Bitte schreib etwas oder füge ein Foto hinzu');
  state.busy = true;
  if (btn) { btn.disabled = true; btn.dataset.label = btn.innerHTML; btn.textContent = 'Ich prüfe das …'; }
  s.thread.push({ who: 'me', text: text.trim(), images });
  s.turns.push({ role: 'user', text: (text.trim() || 'Hier ist das angefragte Foto.') + '\nBitte prüfe deine Einschätzung neu und gib das vollständige, aktualisierte JSON zurück.', images });
  try {
    const { raw, result } = await askGemini(s.turns);
    s.turns.push({ role: 'model', text: raw });
    s.thread.push({ who: 'ai', text: result.antwort || 'Ich habe meine Einschätzung mit deinen Angaben aktualisiert.' });
    s.result = result;
    s.images = [...s.images, ...images];
    await db.put(s);
    state.busy = false;
    go('result');
    setTimeout(() => $('#thread-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  } catch (e) {
    s.thread.pop(); s.turns.pop();
    state.busy = false;
    if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.label; }
    toast(friendlyError(e), 5000);
  }
}

/* ------------------------------------------------------------------ *
 * Ergebnis
 * ------------------------------------------------------------------ */
function meter(label, val) {
  const cls = val >= 75 ? '' : val >= 50 ? 'mid' : 'low';
  return `<div class="meter"><div class="meter-row"><span>${esc(label)}</span><b>${val} %</b></div>
    <div class="meter-bar ${cls}"><div style="width:${val}%"></div></div></div>`;
}

function renderResult(v) {
  const s = state.session;
  const r = s?.result;
  if (!r) return go('home');
  const st = r.zustand.status;
  const stCls = st === 'gesund' ? 'ok' : st === 'stark' ? 'bad' : 'warn';
  const stLabel = { gesund: 'Gesund', leicht: 'Leichte Probleme', mittel: 'Braucht Hilfe', stark: 'Dringend handeln' }[st];
  const careItems = [
    ['licht', 'Licht', ICON.sun], ['temperatur', 'Temperatur', ICON.temp], ['giessen', 'Gießen', ICON.drop],
    ['bluete', 'Blüte', ICON.flower], ['standort', 'Standort', ICON.pin],
  ].filter(([k]) => r.pflege[k]);
  const lowConfidence = r.pflanze.sicherheit < 75 || r.zustand.sicherheit < 75;

  v.innerHTML = `
    ${!r.bild_ok ? `
    <div class="card warn"><div class="card-head">${ICON.camera}<h3>Ich brauche ein besseres Foto</h3></div>
      <p>${esc(r.bild_hinweis || 'Auf dem Foto kann ich die Pflanze nicht gut genug erkennen.')}</p></div>` : ''}

    <div class="card">
      <div class="result-head">
        <img src="${s.images[0]}" alt="">
        <div>
          <h2>${esc(r.pflanze.name)}</h2>
          ${r.pflanze.botanisch ? `<div class="sci">${esc(r.pflanze.botanisch)}</div>` : ''}
          <span class="badge ${stCls}">${stLabel}</span>
        </div>
      </div>
      ${meter('Sicherheit Pflanze', r.pflanze.sicherheit)}
      ${meter('Sicherheit Diagnose', r.zustand.sicherheit)}
      ${r.pflanze.alternativen.length ? `<p class="small muted" style="margin-top:10px">Könnte auch sein: ${r.pflanze.alternativen.map((a) => `${esc(a.name)} (${a.sicherheit} %)`).join(', ')}</p>` : ''}
    </div>

    ${r.einleitung || r.pflege_text ? `
    <div class="card"><div class="card-head">${ICON.leaf}<h3>Deine Pflanze</h3></div>
      <div class="speech">${paras(r.einleitung)}${paras(r.pflege_text)}</div>
      ${careItems.length ? `<div class="care-grid" style="margin-top:14px">
        ${careItems.map(([k, label, icon], i) => `<div class="care-item ${careItems.length % 2 && i === careItems.length - 1 ? 'wide' : ''}">
          <div class="k">${icon}${label}</div><div class="v">${esc(r.pflege[k])}</div></div>`).join('')}</div>` : ''}
    </div>` : ''}

    <div class="card ${stCls === 'ok' ? 'tint' : stCls}">
      <div class="card-head">${st === 'gesund' ? ICON.check : ICON.alert}<h3>${esc(r.zustand.titel || stLabel)}</h3></div>
      <div class="speech">${paras(r.diagnose_text)}</div>
      ${r.symptome.length ? `<h3 style="margin-top:14px">Symptome</h3><ul class="list">
        ${r.symptome.map((x) => `<li><span class="dot sym">${ICON.check}</span><span>${esc(x)}</span></li>`).join('')}</ul>` : ''}
    </div>

    ${r.ursachen.length ? `
    <div class="card"><div class="card-head">${ICON.stetho}<h3>Mögliche Ursachen</h3></div>
      ${r.ursachen.map((u) => `<div class="cause">${meter(u.titel, u.wahrscheinlichkeit)}${u.erklaerung ? `<p class="small" style="margin-top:6px">${esc(u.erklaerung)}</p>` : ''}</div>`).join('')}
    </div>` : ''}

    ${r.massnahmen.length ? `
    <div class="card"><div class="card-head">${ICON.bulb}<h3>Was kannst du tun?</h3></div>
      <ul class="list">${r.massnahmen.map((m) => `<li><span class="dot ${m.dringend ? 'urgent' : ''}">${m.dringend ? '!' : ICON.check}</span>
        <span><b>${esc(m.titel)}</b>${m.dringend ? ' <span class="badge bad">dringend</span>' : ''}${m.details ? `<br><span class="sub">${esc(m.details)}</span>` : ''}</span></li>`).join('')}</ul>
    </div>` : ''}

    ${r.giftigkeit ? `<div class="card tint"><div class="card-head">${ICON.paw}<h3>Gut zu wissen</h3></div><p class="small">${esc(r.giftigkeit)}</p></div>` : ''}

    ${r.rueckfragen.length || r.fotowuensche.length ? `
    <div class="card ${lowConfidence ? 'warn' : ''}" id="questions">
      <div class="card-head">${ICON.question}<h3>Damit ich sicherer werde</h3></div>
      ${r.unsicherheit ? `<p class="small" style="margin-bottom:12px">${esc(r.unsicherheit)}</p>` : ''}
      ${r.rueckfragen.map((q, i) => `<div class="qa"><div class="q">${esc(q)}</div>
        <input type="text" data-answer="${i}" placeholder="Deine Antwort …"></div>`).join('')}
      ${r.fotowuensche.length ? `<div class="qa"><div class="q">Fotowunsch</div>
        <ul class="list">${r.fotowuensche.map((f) => `<li><span class="dot sym">${ICON.camera}</span><span>${esc(f)}</span></li>`).join('')}</ul>
        <div class="photo-grid" id="extra-photos" style="margin-top:8px"></div>
        <div class="btn-row" style="margin-top:8px">
          <button class="btn ghost small" id="extra-cam">${ICON.camera}Foto</button>
          <button class="btn ghost small" id="extra-gal">${ICON.gallery}Galerie</button></div></div>` : ''}
      <div style="margin-top:14px"><button class="btn" id="send-answers">${ICON.check}Antworten senden</button></div>
    </div>` : ''}

    ${s.thread.length ? `
    <div class="card" id="thread-card"><div class="card-head">${ICON.chat}<h3>Unser Gespräch</h3></div>
      <div class="thread">${s.thread.map((m) => `<div class="bubble ${m.who}">${esc(m.text)}${(m.images || []).map((im) => `<img src="${im}" alt="">`).join('')}</div>`).join('')}</div>
    </div>` : ''}

    <div class="card" id="challenge">
      <div class="card-head">${ICON.chat}<h3>Stimmt das? Hinterfrage mich!</h3></div>
      <p class="small muted">Wenn dir etwas komisch vorkommt, sag es mir – ich prüfe meine Einschätzung neu.</p>
      <div class="chips" style="margin-top:10px">
        ${['Das ist eine andere Pflanze', 'Die Diagnose passt nicht', 'Warum bist du so sicher?', 'Welche Ursachen gibt es noch?', 'Ist das ansteckend für andere Pflanzen?']
          .map((c) => `<button class="chip" data-chip="${esc(c)}">${esc(c)}</button>`).join('')}
      </div>
      <textarea id="challenge-text" style="margin-top:12px" placeholder="z. B. Ich gieße nur alle 2 Wochen, Staunässe kann es nicht sein."></textarea>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn ghost small" id="challenge-photo" style="flex:0 0 auto">${ICON.camera}</button>
        <button class="btn" id="challenge-send">Nachfragen</button>
      </div>
      <div class="photo-grid" id="challenge-photos" style="margin-top:8px"></div>
    </div>

    <div class="btn-row">
      <button class="btn secondary" id="new-scan">${ICON.camera}Neue Pflanze</button>
    </div>
    <p class="disclaimer">KI-Einschätzung ohne Gewähr${store.get('fm.lastModel') ? ` · Modell: ${esc(store.get('fm.lastModel'))}` : ''}</p>
  `;

  // Zusatzfotos für Rückfragen
  const extra = [];
  const drawThumbs = (el, arr) => {
    if (!el) return;
    el.innerHTML = arr.map((im, i) => `<div class="photo-slot filled"><img src="${im}" alt=""><button class="remove" data-i="${i}" aria-label="Entfernen">${ICON.x}</button></div>`).join('');
    $$('.remove', el).forEach((b) => b.addEventListener('click', () => { arr.splice(+b.dataset.i, 1); drawThumbs(el, arr); }));
  };
  const addExtra = async (src) => { extra.push(...(await pickPhotos(src))); extra.splice(MAX_PHOTOS); drawThumbs($('#extra-photos'), extra); };
  $('#extra-cam')?.addEventListener('click', () => addExtra('camera'));
  $('#extra-gal')?.addEventListener('click', () => addExtra('gallery'));
  $('#send-answers')?.addEventListener('click', (e) => {
    const answers = r.rueckfragen.map((q, i) => ({ q, a: $(`[data-answer="${i}"]`)?.value.trim() })).filter((x) => x.a);
    const text = answers.map((x) => `Frage: ${x.q}\nMeine Antwort: ${x.a}`).join('\n\n');
    sendFollowUp(text, [...extra], e.currentTarget);
  });

  // Hinterfragen
  const chal = [];
  $$('[data-chip]', v).forEach((b) => b.addEventListener('click', () => {
    const ta = $('#challenge-text');
    ta.value = ta.value ? `${ta.value.trim()} ${b.dataset.chip}` : b.dataset.chip;
    ta.focus();
  }));
  $('#challenge-photo').addEventListener('click', async () => { chal.push(...(await pickPhotos('gallery'))); chal.splice(MAX_PHOTOS); drawThumbs($('#challenge-photos'), chal); });
  $('#challenge-send').addEventListener('click', (e) => sendFollowUp($('#challenge-text').value, [...chal], e.currentTarget));
  $('#new-scan').addEventListener('click', () => go('home'));
}

/* ------------------------------------------------------------------ *
 * Verlauf
 * ------------------------------------------------------------------ */
async function renderHistory(v) {
  v.innerHTML = '<h1 style="margin:8px 0 14px">Meine Pflanzen</h1><div id="hist"></div>';
  const items = (await db.all()).filter((x) => x.result).sort((a, b) => b.date - a.date);
  const el = $('#hist');
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `<div class="empty">${ICON.leaf}<p>Noch keine Analysen.<br>Mach dein erstes Pflanzenfoto!</p></div>`;
    return;
  }
  el.innerHTML = items.map((x) => `
    <div style="position:relative">
      <button class="hist-item" data-open="${x.id}">
        <img src="${x.images[0]}" alt="">
        <div style="flex:1;min-width:0">
          <div class="t">${esc(x.result.pflanze.name)}</div>
          <div class="small">${esc(x.result.zustand.titel || '')}</div>
          <div class="d">${new Date(x.date).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
        </div>
      </button>
      <button class="icon-btn" data-del="${x.id}" aria-label="Löschen" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);box-shadow:none;background:var(--grey-50)">${ICON.trash}</button>
    </div>`).join('');
  $$('[data-open]', el).forEach((b) => b.addEventListener('click', async () => {
    const s = await db.get(b.dataset.open);
    if (!s) return;
    state.session = { ...s, fromHistory: true };
    go('result');
  }));
  $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Diese Analyse wirklich löschen?')) return;
    await db.remove(b.dataset.del);
    renderHistory(v);
  }));
}

/* ------------------------------------------------------------------ *
 * Einstellungen
 * ------------------------------------------------------------------ */
function renderSettings(v) {
  const s = getSettings();
  v.innerHTML = `
    <h1 style="margin:8px 0 14px">Einstellungen</h1>
    <div class="card">
      <div class="card-head">${ICON.key}<h3>KI-Schlüssel (Google Gemini)</h3></div>
      <p class="small muted">Kostenlos, ohne Kreditkarte. Der Schlüssel wird nur auf diesem Gerät gespeichert.</p>
      <label class="field" style="margin-top:12px"><span>API-Schlüssel</span>
        <input type="password" id="api-key" value="${esc(s.apiKey)}" placeholder="AIza…" autocomplete="off" autocapitalize="off" spellcheck="false">
      </label>
      <label class="field" style="margin-top:12px"><span>KI-Modell</span>
        <input type="text" id="model" value="${esc(s.model)}" placeholder="auto" autocapitalize="off" spellcheck="false">
      </label>
      <p class="small muted" style="margin-top:6px">„auto“ wählt automatisch das beste kostenlose Modell (empfohlen).</p>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn secondary" id="test">Testen</button>
        <button class="btn" id="save">Speichern</button>
      </div>
      <button class="btn ghost" id="help" style="margin-top:10px">${ICON.question}So bekommst du den Schlüssel</button>
    </div>

    <div class="card">
      <h3>Datenschutz</h3>
      <p class="small" style="margin-top:6px">Deine Fotos werden zur Analyse an Google (Gemini API) gesendet. Im kostenlosen Tarif darf Google
      die Daten laut eigenen Bedingungen zur Verbesserung seiner Dienste nutzen – lade daher keine Fotos mit Personen oder privaten Details hoch.
      Dein Verlauf wird ausschließlich auf deinem Gerät gespeichert.</p>
      <button class="btn ghost small" id="wipe" style="margin-top:12px">${ICON.trash}Alle lokalen Daten löschen</button>
    </div>
    <p class="version">FaunaMedic ${APP_VERSION} · Updates werden beim Start automatisch geladen</p>
  `;
  const save = () => {
    store.set('fm.apiKey', $('#api-key').value.trim());
    store.set('fm.model', $('#model').value.trim() || 'auto');
    store.del('fm.modelCache');
  };
  $('#save').addEventListener('click', () => { save(); toast('Gespeichert'); go('home'); });
  $('#help').addEventListener('click', () => go('help'));
  $('#test').addEventListener('click', async (e) => {
    save();
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Teste …';
    try {
      const models = await resolveModels();
      await apiFetch(`models/${encodeURIComponent(models[0])}:generateContent`, {
        method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Antworte nur mit: OK' }] }] }),
      });
      toast(`Verbindung klappt ✓ (${models[0]})`, 3500);
    } catch (err) {
      toast(friendlyError(err), 5000);
    } finally { btn.disabled = false; btn.textContent = 'Testen'; }
  });
  $('#wipe').addEventListener('click', async () => {
    if (!confirm('Verlauf, Fotos und Schlüssel auf diesem Gerät löschen?')) return;
    for (const x of await db.all()) await db.remove(x.id);
    ['fm.apiKey', 'fm.model', 'fm.modelCache', 'fm.lastModel'].forEach((k) => store.del(k));
    toast('Alle Daten gelöscht');
    render();
  });
}

function renderHelp(v) {
  v.innerHTML = `
    <h1 style="margin:8px 0 14px">Kostenlosen Schlüssel holen</h1>
    <div class="card">
      <ol class="steps">
        <li>Öffne <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a></li>
        <li>Mit deinem Google-Konto anmelden und den Nutzungsbedingungen zustimmen.</li>
        <li>Auf <b>„API-Schlüssel erstellen“</b> tippen.</li>
        <li>Den Schlüssel (beginnt mit <code>AIza</code>) kopieren.</li>
        <li>Hier in FaunaMedic unter <b>Einstellungen</b> einfügen, „Testen“ und „Speichern“.</li>
      </ol>
    </div>
    <div class="card tint">
      <h3>Gut zu wissen</h3>
      <p class="small" style="margin-top:6px">Der kostenlose Tarif reicht für den privaten Gebrauch gut aus (begrenzte Anfragen pro Minute und Tag).
      Es fallen keine Kosten an, solange du in Google AI Studio <b>keine</b> Abrechnung (Billing) aktivierst.</p>
    </div>
    <button class="btn" id="back-settings">Zurück zu den Einstellungen</button>`;
  $('#back-settings').addEventListener('click', () => go('settings'));
}

/* ------------------------------------------------------------------ *
 * Automatische Updates beim Start (Service Worker)
 * ------------------------------------------------------------------ */
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    try { sessionStorage.setItem('fm.updated', '1'); } catch { /* egal */ }
    window.location.reload();
  });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
      reg.update(); // bei jedem Start sofort nach neuer Version suchen
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update(); });
    } catch { /* z. B. im privaten Modus – App funktioniert trotzdem */ }
  });
}

/* Start */
go('home');
try {
  if (sessionStorage.getItem('fm.updated')) { sessionStorage.removeItem('fm.updated'); toast(`FaunaMedic wurde aktualisiert (v${APP_VERSION})`); }
} catch { /* egal */ }
