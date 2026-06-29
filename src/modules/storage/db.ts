/**
 * Armazenamento local (IndexedDB) de projetos e clipes de áudio.
 *
 * Usamos IndexedDB nativo (sem dependência externa por enquanto) por ser
 * suficiente e auditável. Se a complexidade crescer, a biblioteca candidata
 * documentada é `idb` (ver docs/LIBRARIES.md).
 *
 * Dois object stores:
 *  - `projects`: metadados do projeto (JSON serializável).
 *  - `clips`: PCM cru por canal, guardado como ArrayBuffer para não perder fidelidade.
 */
import type { AudioClip, Project } from '../../core/types';

const DB_NAME = 'reprogramacao';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_CLIPS = 'clips';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CLIPS)) {
        db.createObjectStore(STORE_CLIPS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const projectStore = {
  save: (p: Project) => tx(STORE_PROJECTS, 'readwrite', (s) => s.put(p)),
  get: (id: string) => tx<Project | undefined>(STORE_PROJECTS, 'readonly', (s) => s.get(id)),
  list: () => tx<Project[]>(STORE_PROJECTS, 'readonly', (s) => s.getAll()),
  delete: (id: string) => tx(STORE_PROJECTS, 'readwrite', (s) => s.delete(id)),
};

/** Serializa um AudioClip para gravação (canais como ArrayBuffers). */
interface StoredClip {
  channels: ArrayBuffer[];
  sampleRate: number;
  durationSec: number;
}

export const clipStore = {
  async save(id: string, clip: AudioClip): Promise<void> {
    const stored: StoredClip = {
      channels: clip.channels.map((c) => c.buffer.slice(0) as ArrayBuffer),
      sampleRate: clip.sampleRate,
      durationSec: clip.durationSec,
    };
    await tx(STORE_CLIPS, 'readwrite', (s) => s.put(stored, id));
  },
  async get(id: string): Promise<AudioClip | undefined> {
    const stored = await tx<StoredClip | undefined>(STORE_CLIPS, 'readonly', (s) => s.get(id));
    if (!stored) return undefined;
    return {
      channels: stored.channels.map((b) => new Float32Array(b)),
      sampleRate: stored.sampleRate,
      durationSec: stored.durationSec,
    };
  },
  delete: (id: string) => tx(STORE_CLIPS, 'readwrite', (s) => s.delete(id)),
};
