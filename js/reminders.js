/* Flora Medici – Behandlungsplan, fällige Aufgaben und iPhone-Mitteilungen
 *
 * Mitteilungen (kostenlos, ohne eigenen Server):
 *   App  ──(verschlüsselt, GitHub-Secret FM_REMINDERS)──▶  GitHub
 *   cron-job.org ──alle 15 Min.──▶ GitHub Actions "Flora Medici Push" ──Web Push──▶ Apple Push-Dienst ──▶ iPhone
 * Die App erzeugt die VAPID-Schlüssel selbst und legt sie als Secrets im Repository ab.
 */
import { store, uid, today, addDays, parseISO, daysUntil } from './util.js';

/* ------------------------------------------------------------------ *
 * Behandlungsplan
 * ------------------------------------------------------------------ */
export function buildPlan(result, visitId, oldPlan) {
  const keep = (oldPlan?.tasks || []).filter((t) => t.source === 'frage' && !t.done);
  const tasks = result.behandlungsplan.map((b) => ({
    id: uid(), date: addDays(today(), b.tag), titel: b.titel, details: b.details, done: false, source: 'plan',
  }));
  const checkup = result.kontrolle_in_tagen > 0
    ? { date: addDays(today(), result.kontrolle_in_tagen), foto: result.kontrolle_foto, done: false }
    : null;
  return { visitId, created: Date.now(), tasks: [...tasks, ...keep].sort((a, b) => a.date.localeCompare(b.date)), checkup };
}

export function addQuestionTasks(plant, aufgaben) {
  plant.plan = plant.plan || { visitId: null, created: Date.now(), tasks: [], checkup: null };
  for (const a of aufgaben) {
    if (plant.plan.tasks.some((t) => t.date === a.datum && t.titel === a.titel)) continue;
    plant.plan.tasks.push({ id: uid(), date: a.datum, titel: a.titel, details: a.details, done: false, source: 'frage' });
  }
  plant.plan.tasks.sort((a, b) => a.date.localeCompare(b.date));
}

/** Alles, was heute (oder überfällig) ansteht – über alle Pflanzen. */
export function dueItems(plants) {
  const out = [];
  for (const p of plants) {
    if (!p.plan) continue;
    for (const t of p.plan.tasks) if (!t.done && daysUntil(t.date) <= 0) out.push({ plant: p, kind: 'task', date: t.date, task: t });
    const c = p.plan.checkup;
    if (c && !c.done && daysUntil(c.date) <= 0) out.push({ plant: p, kind: 'checkup', date: c.date });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function updateBadge(plants) {
  const n = dueItems(plants).length;
  try { if (n) navigator.setAppBadge?.(n); else navigator.clearAppBadge?.(); } catch { /* nicht unterstützt */ }
}

/* ------------------------------------------------------------------ *
 * Mitteilungen – Einstellungen
 * ------------------------------------------------------------------ */
export function pushSettings() {
  const def = (() => {
    const h = location.hostname;
    if (h.endsWith('.github.io')) return { owner: h.split('.')[0], repo: location.pathname.split('/').filter(Boolean)[0] || '' };
    return { owner: 'ziege1988', repo: 'FaunaMedic' };
  })();
  return { owner: def.owner, repo: def.repo, token: '', enabled: false, vapidPublic: '', endpoint: '', lastHash: '', pending: false, time: '09:00', ...store.get('fm.push', {}) };
}
const savePush = (patch) => store.set('fm.push', { ...pushSettings(), ...patch });

export const isStandalone = () => window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/* ------------------------------------------------------------------ *
 * GitHub-API
 * ------------------------------------------------------------------ */
async function gh(path, opts = {}, s = pushSettings()) {
  const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}${path}`, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${s.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).message || ''; } catch { /* egal */ }
    let accepted = '';
    try { accepted = res.headers.get('x-accepted-github-permissions') || ''; } catch { /* egal */ }
    const need = opts.need ? ` Benötigt: ${opts.need}.` : '';
    const hint = res.status === 401 ? 'GitHub-Zugangsschlüssel ungültig oder abgelaufen.'
      : res.status === 403 ? `Dem GitHub-Zugangsschlüssel fehlt ein Recht.${need}`
        : res.status === 404 ? `Nicht gefunden – stimmt Konto/Repository, und hat der Schlüssel Zugriff auf genau dieses Repository?${need}`
          : `GitHub-Fehler ${res.status}.`;
    const detail = [msg && `GitHub: „${msg}“`, accepted && `(${accepted})`].filter(Boolean).join(' ');
    throw Object.assign(new Error(`${hint}${detail ? ` ${detail}` : ''}`), { status: res.status });
  }
  return res.status === 204 || res.status === 201 ? null : res.json().catch(() => null);
}

/* libsodium-kompatible "sealed box" (so verlangt GitHub verschlüsselte Secrets) */
let cryptoLibs = null;
async function loadCrypto() {
  if (!cryptoLibs) {
    const [nacl, blake] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/tweetnacl@1.0.3/+esm'),
      import('https://cdn.jsdelivr.net/npm/blakejs@1.2.1/+esm'),
    ]);
    cryptoLibs = { nacl: nacl.default || nacl, blake2b: blake.blake2b || blake.default.blake2b };
  }
  return cryptoLibs;
}
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));

export async function sealedBox(message, publicKeyB64) {
  const { nacl, blake2b } = await loadCrypto();
  const pk = unb64(publicKeyB64);
  const eph = nacl.box.keyPair();
  const nonceInput = new Uint8Array(64);
  nonceInput.set(eph.publicKey, 0);
  nonceInput.set(pk, 32);
  const nonce = blake2b(nonceInput, undefined, 24);
  const boxed = nacl.box(new TextEncoder().encode(message), nonce, pk, eph.secretKey);
  const out = new Uint8Array(32 + boxed.length);
  out.set(eph.publicKey, 0);
  out.set(boxed, 32);
  return b64(out);
}

let repoKey = null;
async function setSecret(name, value, s) {
  if (!repoKey) repoKey = await gh('/actions/secrets/public-key', { need: 'Secrets → Read and write' }, s);
  const encrypted_value = await sealedBox(value, repoKey.key);
  await gh(`/actions/secrets/${name}`, { method: 'PUT', need: 'Secrets → Read and write', body: JSON.stringify({ encrypted_value, key_id: repoKey.key_id }) }, s);
}

async function dispatch(mode, s = pushSettings()) {
  const info = await gh('', { need: 'Zugriff auf das Repository' }, s);
  await gh('/actions/workflows/push.yml/dispatches', { method: 'POST', need: 'Actions → Read and write', body: JSON.stringify({ ref: info.default_branch, inputs: { mode } }) }, s);
}

/* ------------------------------------------------------------------ *
 * Einrichtung (muss direkt aus einem Fingertipp heraus gestartet werden)
 * ------------------------------------------------------------------ */
export async function setupPush({ token, time }, plants, onStepRaw = () => {}) {
  let step = 'Start';
  const onStep = (t) => { step = t.replace(/ …$/, ''); onStepRaw(t); };
  try {
    return await setupPushInner({ token, time }, plants, onStep);
  } catch (e) {
    throw Object.assign(new Error(`Schritt „${step}“: ${e.message}`), { status: e.status });
  }
}

async function setupPushInner({ token, time }, plants, onStep) {
  if (!pushSupported()) throw new Error('Dieses Gerät/dieser Browser unterstützt keine Web-Mitteilungen.');
  if (!isStandalone()) throw new Error('Bitte öffne Flora Medici über das Symbol auf deinem Home-Bildschirm – nur dort sind Mitteilungen auf dem iPhone möglich.');

  // Zuerst die Erlaubnis abfragen (iOS verlangt, dass das direkt nach dem Fingertipp passiert)
  onStep('Erlaubnis für Mitteilungen …');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Mitteilungen wurden nicht erlaubt. Du kannst das in den iPhone-Einstellungen → Mitteilungen → Flora Medici ändern.');

  savePush({ token: token.trim(), time: time || '09:00' });
  let s = pushSettings();

  onStep('Verbindung zu GitHub prüfen …');
  await gh('', { need: 'Zugriff auf das Repository (beim Schlüssel „Only select repositories“ → FaunaMedic)' }, s);

  if (!s.vapidPublic) {
    onStep('Sichere Schlüssel erzeugen …');
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    const pub = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
    const priv = (await crypto.subtle.exportKey('jwk', kp.privateKey)).d;
    await setSecret('VAPID_PUBLIC_KEY', pub, s);
    await setSecret('VAPID_PRIVATE_KEY', priv, s);
    savePush({ vapidPublic: pub });
    s = pushSettings();
  }

  onStep('iPhone für Mitteilungen anmelden …');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const cur = sub.options?.applicationServerKey ? b64url(new Uint8Array(sub.options.applicationServerKey)) : '';
    if (cur !== s.vapidPublic) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64url(s.vapidPublic) });

  savePush({ enabled: true, endpoint: sub.endpoint, lastHash: '' });

  onStep('Erinnerungen übertragen …');
  await syncReminders(plants, { force: true });

  onStep('Test-Mitteilung anfordern …');
  try { await dispatch('test'); return { testOk: true }; } catch (e) { return { testOk: false, testError: e.message }; }
}

export async function sendTest() { await dispatch('test'); }

export function disablePush() {
  savePush({ enabled: false, lastHash: '' });
  navigator.serviceWorker?.ready.then((r) => r.pushManager.getSubscription()).then((s) => s?.unsubscribe()).catch(() => {});
}

/* ------------------------------------------------------------------ *
 * Erinnerungen synchronisieren
 * ------------------------------------------------------------------ */
function atISO(date, time) {
  const [hh, mm] = String(time || '09:00').split(':').map(Number);
  const d = parseISO(date);
  d.setHours(hh || 9, mm || 0, 0, 0);
  return d.toISOString();
}

export function buildReminders(plants, time) {
  const list = [];
  const base = location.href.split('#')[0];
  for (const p of plants) {
    if (!p.plan) continue;
    const byDate = {};
    for (const t of p.plan.tasks) if (!t.done && daysUntil(t.date) >= -1) (byDate[t.date] = byDate[t.date] || []).push(t.titel);
    for (const [date, titles] of Object.entries(byDate)) {
      list.push({
        id: `${p.id}-t-${date}`, at: atISO(date, time),
        title: `🌿 ${p.name}`,
        body: titles.length === 1 ? `Heute dran: ${titles[0]}` : `Heute dran: ${titles.join(' · ')}`,
        url: `${base}#plant/${p.id}`,
      });
    }
    const c = p.plan.checkup;
    if (c && !c.done && daysUntil(c.date) >= -1) {
      list.push({
        id: `${p.id}-c-${c.date}`, at: atISO(c.date, time),
        title: `📸 Kontrolltermin: ${p.name}`,
        body: c.foto ? `Zeit für ein neues Foto – ${c.foto}` : 'Zeit für ein neues Kontrollfoto. Wie geht es deiner Pflanze?',
        url: `${base}#plant/${p.id}/checkup`,
      });
    }
  }
  return list.sort((a, b) => a.at.localeCompare(b.at)).slice(0, 150);
}

const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };

export async function syncReminders(plants, { force = false } = {}) {
  const s = pushSettings();
  if (!s.enabled || !s.token) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) { savePush({ enabled: false }); return false; }
    const payload = JSON.stringify({ v: 1, subscriptions: [sub.toJSON()], reminders: buildReminders(plants, s.time) });
    const h = hash(payload);
    if (!force && h === s.lastHash && !s.pending) return true;
    await setSecret('FM_REMINDERS', payload, s);
    savePush({ lastHash: h, pending: false, endpoint: sub.endpoint, lastSync: Date.now() });
    return true;
  } catch (e) {
    savePush({ pending: true });
    if (force) throw e;
    return false;
  }
}

let syncTimer = null;
export function scheduleSync(getPlants) {
  if (!pushSettings().enabled) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => syncReminders(await getPlants()), 1500);
}
