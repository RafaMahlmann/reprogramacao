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
const DB_VERSION = 2;
const STORE_PROJECTS = 'projects';
const STORE_CLIPS = 'clips';
const STORE_MEDIA = 'media';

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
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA);
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

  /** Lê TODOS os clips guardados, com suas chaves. Usado na recuperação. */
  async listAll(): Promise<{ id: string; clip: AudioClip }[]> {
    const keys = await tx<IDBValidKey[]>(STORE_CLIPS, 'readonly', (s) => s.getAllKeys());
    const values = await tx<StoredClip[]>(STORE_CLIPS, 'readonly', (s) => s.getAll());
    return keys.map((k, i) => ({
      id: String(k),
      clip: {
        channels: values[i].channels.map((b) => new Float32Array(b)),
        sampleRate: values[i].sampleRate,
        durationSec: values[i].durationSec,
      },
    }));
  },
};

/**
 * Armazena mídia bruta (Blob), como a música de fundo.
 *
 * Arquivos grandes (centenas de MB) estouram o IndexedDB em muitos navegadores.
 * Por isso usamos preferencialmente o OPFS (Origin Private File System), feito
 * para arquivos grandes — grava direto no disco, com cota muito maior. Se o OPFS
 * não estiver disponível, caímos para o IndexedDB.
 */
function opfsAvailable(): boolean {
  return typeof navigator !== 'undefined'
    && !!navigator.storage
    && 'getDirectory' in navigator.storage;
}

async function mediaDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('media', { create: true });
}

/** Pede armazenamento durável (reduz risco de o navegador apagar os dados). */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch { /* ignore */ }
}

export const mediaStore = {
  async save(id: string, blob: Blob): Promise<void> {
    if (opfsAvailable()) {
      try {
        const dir = await mediaDir();
        const fh = await dir.getFileHandle(id, { create: true });
        const ws = await fh.createWritable();
        await ws.write(blob);
        await ws.close();
        return;
      } catch { /* cai para IndexedDB */ }
    }
    await tx(STORE_MEDIA, 'readwrite', (s) => s.put(blob, id));
  },

  async get(id: string): Promise<Blob | undefined> {
    if (opfsAvailable()) {
      try {
        const dir = await mediaDir();
        const fh = await dir.getFileHandle(id);
        return await fh.getFile();
      } catch { /* não está no OPFS; tenta IndexedDB */ }
    }
    return tx<Blob | undefined>(STORE_MEDIA, 'readonly', (s) => s.get(id));
  },

  async delete(id: string): Promise<void> {
    if (opfsAvailable()) {
      try { const dir = await mediaDir(); await dir.removeEntry(id); } catch { /* ignore */ }
    }
    try { await tx(STORE_MEDIA, 'readwrite', (s) => s.delete(id)); } catch { /* ignore */ }
  },
};
