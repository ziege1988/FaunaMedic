// Flora Medici – sendet fällige Erinnerungen als Web-Push (Apple Push-Dienst für Home-Bildschirm-Apps).
// Gibt keine Erinnerungstexte im Log aus – nur Anzahlen.
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

const { FM_DATA, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, MODE = 'check', STATE_FILE = '.push-state/sent.json', APP_URL = '' } = process.env;
const LOOKBACK_MS = 36 * 3600 * 1000; // ältere, verpasste Erinnerungen nicht mehr senden
const setOutput = (k, v) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };

function fail(msg) { console.log(`ℹ️ ${msg}`); setOutput('changed', 'false'); process.exit(0); }

if (!FM_DATA) fail('Noch keine Erinnerungen hinterlegt (Secret FM_REMINDERS fehlt) – bitte Mitteilungen in der App einrichten.');
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) fail('VAPID-Schlüssel fehlen – bitte Mitteilungen in der App einrichten.');

let data;
try { data = JSON.parse(FM_DATA); } catch { fail('FM_REMINDERS ist kein gültiges JSON.'); }
const subs = (data.subscriptions || []).filter((s) => s && s.endpoint);
if (!subs.length) fail('Kein Gerät angemeldet.');

webpush.setVapidDetails(APP_URL || 'https://github.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

let sent = {};
try { sent = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* erster Lauf */ }
const now = Date.now();
// Alte Einträge aufräumen
for (const [id, t] of Object.entries(sent)) if (now - t > 7 * 24 * 3600 * 1000) delete sent[id];

async function deliver(payload) {
  let ok = 0; let gone = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 24 * 3600, urgency: 'high' });
      ok++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) gone++;
      console.log(`⚠️ Zustellung fehlgeschlagen (HTTP ${e.statusCode || '?'})`);
    }
  }
  if (gone) console.log('⚠️ Die Geräte-Anmeldung ist abgelaufen – bitte in der App „Mitteilungen einrichten“ erneut tippen.');
  return { ok, gone };
}

let changed = false;
if (MODE === 'test') {
  const r = await deliver({ title: '🌿 Flora Medici', body: 'Test erfolgreich! So sehen deine Erinnerungen aus.', url: APP_URL, tag: 'fm-test' });
  console.log(`Test-Mitteilung: ${r.ok} zugestellt.`);
  if (!r.ok) process.exitCode = 1;
} else {
  const due = (data.reminders || []).filter((r) => {
    const at = Date.parse(r.at);
    return r.id && Number.isFinite(at) && at <= now && now - at <= LOOKBACK_MS && !sent[r.id];
  });
  for (const r of due) {
    const res = await deliver({ title: r.title, body: r.body, url: r.url, tag: r.id });
    if (res.ok || res.gone) { sent[r.id] = now; changed = true; }
  }
  const upcoming = (data.reminders || []).filter((r) => Date.parse(r.at) > now).length;
  console.log(`Fällig: ${due.length}, gesendet: ${due.filter((r) => sent[r.id] === now).length}, geplant: ${upcoming}.`);
}

if (changed) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(sent));
}
setOutput('changed', changed ? 'true' : 'false');
