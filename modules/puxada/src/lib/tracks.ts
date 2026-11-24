import { api } from './api';
import type { Location } from './core';
type SavedPoint = Location & { id: string; userId: string; tripId: string };
let connection: Promise<IDBDatabase> | undefined;
let owner: string | null = null, generation = 0;
const running = new Set<string>();
function db() { return connection ??= new Promise((resolve, reject) => {
  const request = indexedDB.open('disbgestao-puxada-tracks-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('points', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
}); }
async function transaction<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await db(); return new Promise<T>((resolve, reject) => {
    const tx = database.transaction('points', mode), req = fn(tx.objectStore('points')); let value: T;
    req.onsuccess = () => { value = req.result; }; tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
export const trackQueue = {
  configure(userId: string | null) { if (owner !== userId) { owner = userId; generation++; } },
  async add(userId: string, tripId: string, location: Location) {
    if (owner !== userId) return;
    await transaction('readwrite', store => store.put({ ...location, id: crypto.randomUUID(), userId, tripId }));
    void this.sync(userId);
  },
  async sync(userId: string) {
    if (!navigator.onLine || userId !== owner || running.has(userId)) return;
    const epoch = generation; running.add(userId);
    try {
      const all = (await transaction<SavedPoint[]>('readonly', store => store.getAll())).filter(p => p.userId === userId);
      for (const tripId of new Set(all.map(p => p.tripId))) {
        const points = all.filter(p => p.tripId === tripId);
        for (let i = 0; i < points.length; i += 250) {
          if (owner !== userId || epoch !== generation) return;
          const batch = points.slice(i, i + 250);
          try {
            await api.post(`/trips/${tripId}/tracks`, { points: batch.map(({ tripId: _, ...p }) => p) });
            for (const p of batch) await transaction('readwrite', store => store.delete(p.id));
          } catch { break; } // One route cannot block a different trip, media or a stage.
        }
      }
    } finally { running.delete(userId); }
  },
};
