/* Flora Medici – Lokale Datenbank (IndexedDB)
 * Store "plants": jede Pflanze mit Untersuchungen (visits), Behandlungsplan und Fragen (chat).
 * Pflanzen bleiben gespeichert, bis sie aktiv gelöscht werden.
 */
import { toast, uid, store } from './util.js';

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB nicht verfügbar'));
    const req = indexedDB.open('floramedici', 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('plants')) d.createObjectStore('plants', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('analyses')) d.createObjectStore('analyses', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(storeName, mode);
    const r = fn(t.objectStore(storeName));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = () => reject(t.error);
  });
}

export const db = {
  async putPlant(p) {
    p.updated = Date.now();
    try { await tx('plants', 'readwrite', (s) => s.put(p)); } catch { toast('Speichern nicht möglich – ist der Gerätespeicher voll?'); }
  },
  getPlant: (id) => tx('plants', 'readonly', (s) => s.get(id)).catch(() => null),
  allPlants: () => tx('plants', 'readonly', (s) => s.getAll()).catch(() => []),
  removePlant: (id) => tx('plants', 'readwrite', (s) => s.delete(id)).catch(() => null),
  async clearAll() {
    await tx('plants', 'readwrite', (s) => s.clear()).catch(() => null);
    await tx('analyses', 'readwrite', (s) => s.clear()).catch(() => null);
  },

  /** Einmalige Übernahme der Analysen aus Version 1.x als eigene Pflanzen. */
  async migrate() {
    if (store.get('fm.migrated2')) return;
    try {
      const old = await tx('analyses', 'readonly', (s) => s.getAll());
      for (const a of old || []) {
        if (!a.result) continue;
        await this.putPlant({
          id: uid(),
          created: a.date,
          name: a.result.pflanze?.name || 'Meine Pflanze',
          botanisch: a.result.pflanze?.botanisch || '',
          customName: false,
          location: '',
          cover: a.images?.[0] || '',
          status: { status: a.result.zustand?.status || 'leicht', titel: a.result.zustand?.titel || '' },
          visits: [{ id: uid(), date: a.date, kind: 'erstbefund', images: a.images || [], note: '', result: a.result, check: null, turns: a.turns || [], thread: a.thread || [] }],
          plan: null,
          chat: [],
        });
      }
      await tx('analyses', 'readwrite', (s) => s.clear());
      store.set('fm.migrated2', true);
    } catch { /* nichts zu übernehmen */ }
  },
};
