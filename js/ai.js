/* Flora Medici – KI (Google Gemini, Free Tier)
 * - Diagnose (Erstbefund & Kontrolltermin) mit Behandlungsplan
 * - Unabhängige Zweitprüfung jeder Diagnose
 * - Fragen zur Pflanze mit Markierungen auf dem eigenen Foto und Skizze
 */
import { store, clamp, str, arr, today, isValidISO } from './util.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash'];

export function getSettings() {
  return {
    apiKey: store.get('fm.apiKey', ''),
    model: store.get('fm.model', 'auto'),
    verify: store.get('fm.verify', true),
  };
}

/* ------------------------------------------------------------------ *
 * Prompts
 * ------------------------------------------------------------------ */
const PERSONA = `Du bist "Flora Medici", ein erfahrener, warmherziger Pflanzendoktor (Zimmer-, Balkon- und Gartenpflanzen).
Tonfall: persönlich, duzen, freundlich, klar und kurz, ohne Fachchinesisch (Fachbegriffe nur mit Erklärung). Sprache: Deutsch.
Sei EHRLICH und KALIBRIERT: Prozentwerte sind echte Einschätzungen, übertreibe Sicherheit nie. Prüfe jede Aussage kritisch,
bevor du sie machst: Passt sie zu genau dieser Pflanzenart, zur Jahreszeit, zum Standort und zu dem, was auf den Fotos
wirklich zu sehen ist? Wenn nicht sicher: sag es offen, frage nach oder fordere ein passendes Foto an.
Empfehle Pflanzenschutzmittel nur als letzte Option und nenne zuerst schonende/biologische Varianten.`;

const NATURAL = `WICHTIG – Natürliche Vorgänge von echten Problemen unterscheiden (bevor du eine Krankheit diagnostizierst!):
- Normaler Blattwurf/Alterung: Einzelne ALTE, UNTERE/innere Blätter vergilben gleichmäßig und fallen ab, während die Pflanze
  oben/an den Triebspitzen gesund nachtreibt (z. B. Monstera, Ficus, Dracaena, Yucca, Palmen, Gummibaum).
- Saisonaler Laubfall: Laubabwerfende Garten- und Kübelpflanzen verfärben sich im Herbst und verlieren ihr Laub.
  Berücksichtige Datum und Standort (drinnen/draußen) für die Jahreszeit.
- Winterruhe; Einziehen von Knollen/Zwiebeln nach der Blüte (Amaryllis, Alpenveilchen, Tulpen, Dahlien).
- Reaktion auf Standortwechsel/Umtopfen (z. B. Ficus benjamina wirft kurzzeitig Blätter ab).
- Natürliches Verblühen, Luftwurzeln, normale Panaschierung, rötliche Austriebe, Verholzen, eintrocknende Sukkulenten-Unterblätter.
Wenige, alte, untere Blätter gleichmäßig betroffen → eher natürlich. Junge Blätter/Triebspitzen, sehr viele Blätter,
Flecken, Beläge, Gespinste, Löcher, Matsch, Geruch → eher ein Problem.
Ist es natürlich: "zustand.status" = "natuerlich", "natuerlich.ist_natuerlich" = true, beruhigend erklären und sagen,
woran man erkennt, wann es doch problematisch würde. Unklar? Nachfragen ("Alte untere Blätter oder neue Triebe?",
"Wie viele Blätter pro Woche?", "Kürzlich umgestellt?") oder Foto der ganzen Pflanze anfordern.`;

const DIAG_SCHEMA = `{
  "bild_ok": true,
  "bild_hinweis": "",
  "antwort": "",
  "pflanze": { "name": "", "botanisch": "", "sicherheit": 0, "alternativen": [ { "name": "", "sicherheit": 0 } ] },
  "zustand": { "status": "gesund|natuerlich|leicht|mittel|stark", "titel": "", "sicherheit": 0 },
  "natuerlich": { "ist_natuerlich": false, "erklaerung": "" },
  "verlauf": { "trend": "erstbefund|besser|gleich|schlechter", "text": "" },
  "einleitung": "",
  "pflege_text": "",
  "pflege": { "licht": "", "temperatur": "", "giessen": "", "bluete": "", "standort": "" },
  "diagnose_text": "",
  "symptome": [ "" ],
  "ursachen": [ { "titel": "", "erklaerung": "", "wahrscheinlichkeit": 0 } ],
  "massnahmen": [ { "titel": "", "details": "", "dringend": false } ],
  "behandlungsplan": [ { "tag": 0, "titel": "", "details": "" } ],
  "kontrolle_in_tagen": 7,
  "kontrolle_foto": "",
  "rueckfragen": [ "" ],
  "fotowuensche": [ "" ],
  "giftigkeit": "",
  "unsicherheit": ""
}`;

const DIAG_RULES = `Regeln: "sicherheit"/"wahrscheinlichkeit" ganze Zahlen 0–100. "zustand.titel" = Hauptdiagnose in 2–5 Wörtern.
"ursachen" absteigend, max. 4. "massnahmen" max. 6. Bei Sicherheit < 75 % MUSS mindestens eine Rückfrage oder ein Fotowunsch kommen.
Texte: einleitung "Was wir hier sehen, ist eine …"; pflege_text "Deine Pflanze liebt … Damit sie blüht, braucht sie …";
diagnose_text "Auf dem Foto erkenne ich …".
BEHANDLUNGSPLAN wie beim Arzt: konkrete Aufgaben für die nächsten Tage. "tag" = Tage ab heute (0 = heute, max. 21),
max. 8 Einträge, realistisch und in sinnvoller Reihenfolge (z. B. Tag 0 "Gießpause einlegen", Tag 3 "Erde mit Finger prüfen").
Bei gesunden/natürlichen Pflanzen nur 0–2 sanfte Pflegeaufgaben.
"kontrolle_in_tagen": wann ein neues Kontrollfoto sinnvoll ist (stark: 2–4, mittel: 5–7, leicht: 7–14, gesund/natürlich: 21–30).
"kontrolle_foto": was genau dann fotografiert werden soll.
"verlauf": nur bei Kontrollterminen ausfüllen (sonst trend "erstbefund", text leer).
"giftigkeit": kurz, ob giftig für Katzen/Hunde/Kinder (leer wenn unbekannt).
"antwort": nur füllen, wenn der Nutzer nachgefragt/nachgereicht hat – erkläre offen, ob und warum du deine Einschätzung änderst.
Keine Pflanze erkennbar oder Foto unbrauchbar: "bild_ok": false und in "bild_hinweis" sagen, welches Foto du brauchst.`;

export const DIAGNOSE_PROMPT = `${PERSONA}

Deine Hauptaufgabe ist NICHT nur das Bestimmen der Pflanze, sondern vor allem zu erkennen, WAS IHR FEHLT:
zu nass, zu trocken, zu dunkel, Sonnenbrand, Kälte/Zugluft, Nährstoffmangel, Überdüngung, Wurzelfäule, Schädlinge
(Spinnmilben, Thripse, Woll-/Schmierläuse, Blattläuse, Trauermücken …), Pilz-/Bakterienkrankheiten, Umtopfstress,
zu kleiner Topf, kalkhaltiges Wasser, trockene Heizungsluft usw.
Untersuche Blätter (Farbe, Ränder, Flecken, Glanz, Unterseite), Stängel, Erde, Topf und Umgebung.

KONTROLLTERMIN: Wenn dir ein früherer Befund und VORHER-Fotos mitgegeben werden, vergleiche VORHER und JETZT genau,
bewerte den Verlauf ("verlauf.trend" besser/gleich/schlechter, "verlauf.text" persönlich: "Seit dem letzten Termin …"),
und passe Diagnose und Behandlungsplan an.

${NATURAL}

Antworte AUSSCHLIESSLICH mit gültigem JSON (kein Markdown) in genau diesem Format:
${DIAG_SCHEMA}
${DIAG_RULES}`;

const VERIFY_PROMPT = `Du bist ein ZWEITER, unabhängiger Pflanzenexperte (Gutachter) für Flora Medici.
Ein Kollege hat zu den Fotos eine Erstdiagnose erstellt. Deine Aufgabe: sie KRITISCH prüfen, nicht einfach bestätigen.
Prüfe insbesondere:
1. Stimmt die Pflanzenbestimmung? Gibt es verwechselbare Arten?
2. Passen die genannten Symptome wirklich zu dem, was auf den Fotos zu sehen ist (nichts erfunden, nichts übersehen)?
3. Ist es vielleicht ein natürlicher Vorgang (normaler Blattwurf, Herbst, Ruhephase) statt einer Krankheit – oder umgekehrt?
4. Sind die Prozentwerte realistisch (nicht zu selbstsicher)?
5. Sind Maßnahmen und Behandlungsplan richtig, sicher und für genau diese Art geeignet?
Korrigiere alles, was nicht stimmt, und senke die Sicherheit, wenn Zweifel bleiben.

${NATURAL}

Gib das VOLLSTÄNDIGE, ggf. korrigierte Ergebnis im selben JSON-Format zurück, PLUS das Feld
"pruefung": { "ergebnis": "bestaetigt|angepasst|unsicher", "hinweise": "" }
"hinweise": 1–3 kurze Sätze an den Nutzer (duzen), was du geprüft und ggf. geändert hast.
Antworte AUSSCHLIESSLICH mit gültigem JSON. Format:
${DIAG_SCHEMA.replace(/\n}$/, ',\n  "pruefung": { "ergebnis": "bestaetigt", "hinweise": "" }\n}')}
${DIAG_RULES}`;

const QUESTION_PROMPT = `${PERSONA}

Der Nutzer stellt eine Frage zu SEINER Pflanze (Steckbrief, letzter Befund und Fotos werden mitgeschickt).
Beantworte sie konkret für genau diese Pflanze, Jahreszeit und diesen Standort.
Prüfe deine Antwort vor dem Absenden selbst: Ist der Rat für diese Art korrekt? Passt der Zeitpunkt? Gibt es Risiken?
Notiere das Ergebnis dieser Selbstprüfung in "pruefung".

BILDER sind wichtig, gerade bei praktischen Fragen (Schneiden, Umtopfen, Vermehren, Stützen, Schädlinge erkennen):
1. "markierungen": Wenn sinnvoll, markiere auf einem der mitgeschickten Fotos ("bild" = Nummer des Fotos, beginnend bei 1)
   die relevanten Stellen (z. B. wo geschnitten werden soll). Koordinaten "y" und "x" jeweils 0–1000 relativ zur Bildhöhe/-breite
   (0,0 = oben links). Max. 6 Punkte, "label" = kurze Nummer/Buchstabe, "text" = was an dieser Stelle zu tun ist.
   Markiere NUR, wenn du die Stelle auf dem Foto wirklich erkennst – sonst leeres Array.
2. "skizze_svg": Bei Handgriffen eine einfache, klare Schemazeichnung als SVG (viewBox="0 0 400 260", weißer Hintergrund,
   nur einfache Formen/Linien und kurze deutsche Beschriftungen, font-family="sans-serif", Farben: Grün #4A7F47 und #A8CFA0,
   Grau #7C857F, Schnittlinie/Warnung rot #D9534F gestrichelt). Kein Script, keine externen Bilder. Leer lassen, wenn nicht hilfreich.
Wenn für eine praktische Frage kein passendes Foto vorliegt (z. B. Schnitt, aber Zweige nicht gut sichtbar), bitte in
"rueckfragen" um ein konkretes Foto ("Mach bitte ein Foto vom ganzen Strauch von der Seite").

AUFGABEN: Wenn aus der Antwort Termine folgen (z. B. "Ende Februar zurückschneiden", "ab März alle 2 Wochen düngen"),
gib sie in "aufgaben" mit konkretem "datum" (JJJJ-MM-TT, ab heute) an – max. 4.

Antworte AUSSCHLIESSLICH mit gültigem JSON:
{
  "antwort": "",
  "schritte": [ { "titel": "", "details": "" } ],
  "markierungen": { "bild": 1, "punkte": [ { "y": 0, "x": 0, "label": "1", "text": "" } ] },
  "skizze_svg": "",
  "aufgaben": [ { "datum": "JJJJ-MM-TT", "titel": "", "details": "" } ],
  "sicherheit": 0,
  "pruefung": "",
  "rueckfragen": [ "" ]
}
"antwort": persönlich und kurz (max. ca. 6 Sätze), Details in "schritte" (max. 7). "sicherheit": 0–100, wie sicher du dir bist.`;

/* ------------------------------------------------------------------ *
 * API-Zugriff
 * ------------------------------------------------------------------ */
export async function apiFetch(path, opts = {}) {
  const { apiKey } = getSettings();
  const res = await fetch(`${API_BASE}/${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error?.message || ''; } catch { /* egal */ }
    throw Object.assign(new Error(msg || `HTTP ${res.status}`), { status: res.status });
  }
  return res.json();
}

/** Ermittelt automatisch die besten verfügbaren kostenlosen "Flash"-Modelle. */
export async function resolveModels() {
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
        const score = (n) => parseFloat(n.match(/gemini-([\d.]+)/)?.[1] || '0') * 100
          - (/preview/.test(n) ? 50 : 0) - (/lite/.test(n) ? 20 : 0) - (/-\d{3,}$/.test(n) ? 1 : 0);
        return score(b) - score(a);
      });
    const merged = [...new Set([...list.slice(0, 4), ...FALLBACK_MODELS])];
    store.set('fm.modelCache', { t: Date.now(), list: merged });
    return merged;
  } catch (e) {
    if ([400, 401, 403].includes(e.status)) throw e;
    return FALLBACK_MODELS;
  }
}

function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* weiter */ }
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('Antwort der KI war unvollständig');
}

export function friendlyError(e) {
  if (!navigator.onLine) return 'Du bist offline. Für die KI brauchst du eine Internetverbindung.';
  if ((e.status === 400 && /api key/i.test(e.message)) || e.status === 401 || e.status === 403) return 'Der KI-Schlüssel wird nicht akzeptiert. Bitte prüfe ihn in den Einstellungen.';
  if (e.status === 429) return 'Das kostenlose KI-Kontingent ist gerade aufgebraucht. Bitte in einer Minute (oder morgen) erneut versuchen.';
  if (e.status >= 500) return 'Der KI-Dienst ist gerade überlastet. Bitte gleich noch einmal versuchen.';
  return 'Das hat nicht geklappt: ' + (e.message || 'Unbekannter Fehler');
}

/** Wandelt einen Gesprächsverlauf in Gemini-"contents" um.
 *  turns: [{ role: 'user'|'model', parts: [ 'Text' | { img: dataURL } ] }]  */
function toContents(turns) {
  return turns.map((t) => ({
    role: t.role,
    parts: (t.parts || []).filter(Boolean).map((p) => {
      if (typeof p === 'string') return { text: p };
      const m = /^data:([^;]+);base64,(.*)$/.exec(p.img || '');
      return m ? { inline_data: { mime_type: m[1], data: m[2] } } : { text: '' };
    }),
  }));
}

export async function askGemini(turns, system, temperature = 0.3) {
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: toContents(turns),
    generationConfig: { temperature, responseMimeType: 'application/json' },
  };
  const models = await resolveModels();
  let lastErr;
  for (const m of models) {
    try {
      const data = await apiFetch(`models/${encodeURIComponent(m)}:generateContent`, { method: 'POST', body: JSON.stringify(body) });
      const raw = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!raw) throw Object.assign(new Error('Leere Antwort (evtl. vom Sicherheitsfilter blockiert)'), { status: 0 });
      store.set('fm.lastModel', m);
      return { raw, json: parseJson(raw) };
    } catch (e) {
      lastErr = e;
      if ((e.status === 400 && /api key/i.test(e.message)) || e.status === 401 || e.status === 403) break;
      if (e.status === 404) store.del('fm.modelCache');
    }
  }
  throw lastErr;
}

export async function testConnection() {
  const models = await resolveModels();
  await apiFetch(`models/${encodeURIComponent(models[0])}:generateContent`, {
    method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Antworte nur mit: OK' }] }] }),
  });
  return models[0];
}

/* ------------------------------------------------------------------ *
 * Normalisierung (robust gegen unvollständige KI-Antworten)
 * ------------------------------------------------------------------ */
export function normalizeDiagnosis(r = {}) {
  const p = r.pflanze || {};
  const z = r.zustand || {};
  const nat = r.natuerlich || {};
  let status = ['gesund', 'natuerlich', 'leicht', 'mittel', 'stark'].includes(z.status) ? z.status : 'leicht';
  if (nat.ist_natuerlich === true && (status === 'gesund' || status === 'leicht')) status = 'natuerlich';
  const v = r.verlauf || {};
  const pr = r.pruefung || null;
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
    natuerlich: { ist_natuerlich: nat.ist_natuerlich === true || status === 'natuerlich', erklaerung: str(nat.erklaerung) },
    verlauf: { trend: ['besser', 'gleich', 'schlechter'].includes(v.trend) ? v.trend : 'erstbefund', text: str(v.text) },
    einleitung: str(r.einleitung),
    pflege_text: str(r.pflege_text),
    pflege: Object.fromEntries(['licht', 'temperatur', 'giessen', 'bluete', 'standort'].map((k) => [k, str((r.pflege || {})[k])])),
    diagnose_text: str(r.diagnose_text),
    symptome: arr(r.symptome).map(str).filter(Boolean),
    ursachen: arr(r.ursachen).filter((u) => u && u.titel).map((u) => ({ titel: str(u.titel), erklaerung: str(u.erklaerung), wahrscheinlichkeit: clamp(u.wahrscheinlichkeit, 0, 100) })).sort((a, b) => b.wahrscheinlichkeit - a.wahrscheinlichkeit),
    massnahmen: arr(r.massnahmen).filter((m) => m && m.titel).map((m) => ({ titel: str(m.titel), details: str(m.details), dringend: !!m.dringend })),
    behandlungsplan: arr(r.behandlungsplan).filter((b) => b && b.titel).map((b) => ({ tag: clamp(b.tag, 0, 60), titel: str(b.titel), details: str(b.details) })).slice(0, 10),
    kontrolle_in_tagen: clamp(r.kontrolle_in_tagen ?? 7, 0, 90),
    kontrolle_foto: str(r.kontrolle_foto),
    rueckfragen: arr(r.rueckfragen).map(str).filter(Boolean),
    fotowuensche: arr(r.fotowuensche).map(str).filter(Boolean),
    giftigkeit: str(r.giftigkeit),
    unsicherheit: str(r.unsicherheit),
    pruefung: pr ? { ergebnis: ['bestaetigt', 'angepasst', 'unsicher'].includes(pr.ergebnis) ? pr.ergebnis : 'unsicher', hinweise: str(pr.hinweise) } : null,
  };
}

function normalizeAnswer(r = {}) {
  const mk = r.markierungen || {};
  const svg = str(r.skizze_svg);
  return {
    antwort: str(r.antwort),
    schritte: arr(r.schritte).filter((s) => s && s.titel).map((s) => ({ titel: str(s.titel), details: str(s.details) })).slice(0, 8),
    markierungen: {
      bild: clamp(mk.bild || 1, 1, 10),
      punkte: arr(mk.punkte).filter((p) => p && Number.isFinite(+p.x) && Number.isFinite(+p.y))
        .map((p) => ({ x: clamp(p.x, 0, 1000), y: clamp(p.y, 0, 1000), label: str(String(p.label ?? '')).slice(0, 3), text: str(p.text) })).slice(0, 6),
    },
    // SVG wird später nur als <img> angezeigt – darin laufen keine Skripte.
    skizze_svg: /^<svg[\s>]/i.test(svg) && svg.length < 30000 && !/<script|foreignObject|href\s*=\s*["']?(?!#)/i.test(svg) ? svg : '',
    aufgaben: arr(r.aufgaben).filter((a) => a && a.titel && isValidISO(a.datum) && a.datum >= today()).map((a) => ({ datum: a.datum, titel: str(a.titel), details: str(a.details) })).slice(0, 4),
    sicherheit: clamp(r.sicherheit, 0, 100),
    pruefung: str(r.pruefung),
    rueckfragen: arr(r.rueckfragen).map(str).filter(Boolean),
  };
}

/* ------------------------------------------------------------------ *
 * Hochrangige Funktionen
 * ------------------------------------------------------------------ */

/** Erstbefund oder Kontrolltermin inkl. Zweitprüfung. onStep(text) meldet Fortschritt. */
export async function diagnose({ contextText, images, previous }, onStep = () => {}) {
  const parts = [];
  if (previous) {
    parts.push(`VORHER – Befund vom ${previous.dateText}: ${previous.summary}`);
    previous.images.forEach((img) => parts.push({ img }));
    parts.push('JETZT – neue Fotos:');
  }
  images.forEach((img) => parts.push({ img }));
  parts.push(contextText);
  const turns = [{ role: 'user', parts }];

  onStep('Ich schaue mir deine Pflanze genau an …');
  const first = await askGemini(turns, DIAGNOSE_PROMPT, 0.3);
  let result = normalizeDiagnosis(first.json);
  let raw = first.raw;

  if (getSettings().verify) {
    onStep('Zweitprüfung: Ich hinterfrage meine Diagnose …');
    try {
      const check = await askGemini([{ role: 'user', parts: [...parts, `ERSTDIAGNOSE DES KOLLEGEN (bitte kritisch prüfen):\n${first.raw}`] }], VERIFY_PROMPT, 0.2);
      result = normalizeDiagnosis(check.json);
      if (!result.pruefung) result.pruefung = { ergebnis: 'bestaetigt', hinweise: '' };
      raw = check.raw;
    } catch (e) {
      result.pruefung = { ergebnis: 'nicht_geprueft', hinweise: 'Die Zweitprüfung war gerade nicht möglich (KI-Kontingent oder Verbindung). Das Ergebnis ist nur einfach geprüft.' };
    }
  }
  turns.push({ role: 'model', parts: [raw] });
  return { result, turns };
}

/** Nachfrage/Hinterfragen innerhalb einer Untersuchung. */
export async function followUp(turns, text, images = []) {
  const t = [...turns, { role: 'user', parts: [...images.map((img) => ({ img })), (text || 'Hier ist das angefragte Foto.') + '\nBitte prüfe deine Einschätzung kritisch neu und gib das vollständige, aktualisierte JSON zurück.'] }];
  const res = await askGemini(t, DIAGNOSE_PROMPT, 0.3);
  const result = normalizeDiagnosis(res.json);
  result.pruefung = { ergebnis: 'angepasst', hinweise: 'Neu geprüft mit deinen Angaben.' };
  return { result, turns: [...t, { role: 'model', parts: [res.raw] }] };
}

/** Frage zur Pflanze. profileText = Steckbrief; images = Fotos (eigene neue zuerst); history = frühere Q&A (Text). */
export async function askQuestion({ profileText, images, history, question }) {
  const turns = [];
  for (const h of history.slice(-6)) {
    turns.push({ role: h.who === 'me' ? 'user' : 'model', parts: [h.text] });
  }
  const parts = [`STECKBRIEF MEINER PFLANZE:\n${profileText}\nHeute ist der ${new Date().toLocaleDateString('de-DE')} (${today()}).`];
  images.forEach((img, i) => { parts.push(`Foto ${i + 1}:`); parts.push({ img }); });
  parts.push(`MEINE FRAGE: ${question}`);
  turns.push({ role: 'user', parts });
  const res = await askGemini(turns, QUESTION_PROMPT, 0.4);
  return normalizeAnswer(res.json);
}
