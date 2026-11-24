import { api } from '../lib/api';

export interface MediaItem {
  id: string; userId: string; tripId: string; name: string; blob: Blob;
  kind: 'attachment' | 'invoice'; number?: string; createdAt: string;
  status: 'PENDING' | 'SENDING' | 'FAILED'; error?: string;
}
let database: Promise<IDBDatabase> | undefined;
const listeners = new Set<() => void>();
const running = new Set<string>();
let activeOwner: string | null = null;
let generation = 0;
function db() {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('disbgestao-puxada-media-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('media', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('media', mode);
    const request = action(tx.objectStore('media'));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result!);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Não foi possível salvar o arquivo neste aparelho.'));
  });
}
const changed = () => listeners.forEach(listener => listener());
export const mediaQueue = {
  configure(userId: string | null) { if (activeOwner !== userId) { activeOwner = userId; generation++; } },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  async list(userId: string, tripId?: string): Promise<MediaItem[]> {
    const items = await transact<MediaItem[]>('readonly', store => store.getAll());
    return items.filter(item => item.userId === userId && (!tripId || item.tripId === tripId));
  },
  async add(userId: string, tripId: string, files: File[], kind: MediaItem['kind'] = 'attachment', number?: string) {
    for (const file of files) {
      const item: MediaItem = { id: crypto.randomUUID(), userId, tripId, name: file.name, blob: file, kind, number, createdAt: new Date().toISOString(), status: 'PENDING' };
      await transact('readwrite', store => store.put(item));
    }
    changed();
    void mediaQueue.sync(userId);
  },
  async remove(id: string) { await transact('readwrite', store => store.delete(id)); changed(); },
  async sync(userId: string) {
    if (!navigator.onLine || running.has(userId) || activeOwner !== userId) return;
    const epoch = generation;
    running.add(userId);
    try {
      for (const item of await mediaQueue.list(userId)) {
        if (activeOwner !== userId || epoch !== generation) break;
        try {
          const form = new FormData();
          form.append('file', item.blob, item.name);
          form.append('clientId', item.id);
          if (item.number) form.append('number', item.number);
          await transact('readwrite', store => store.put({ ...item, status: 'SENDING', error: undefined }));
          changed();
          if (activeOwner !== userId || epoch !== generation) break;
          await api.request(`/trips/${item.tripId}/${item.kind === 'invoice' ? 'invoices' : 'attachments'}`, { method: 'POST', body: form, timeoutMs: 90000 });
          await transact('readwrite', store => store.delete(item.id));
        } catch (error) {
          await transact('readwrite', store => store.put({ ...item, status: 'FAILED', error: error instanceof Error ? error.message : 'Falha no envio. Tente novamente.' }));
        }
        changed();
      }
    } finally { running.delete(userId); }
  },
};
