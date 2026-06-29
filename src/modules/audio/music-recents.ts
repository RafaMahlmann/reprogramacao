/**
 * Lista de músicas recentes (metadados em localStorage; os Blobs ficam no
 * mediaStore, indexados por id). Permite reusar uma música já importada sem
 * importar de novo.
 */
export interface RecentTrack {
  id: string;
  name: string;
  addedAt: number;
}

const KEY = 'reprogramacao:recentMusic';
const MAX = 8;

export function getRecents(): RecentTrack[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as RecentTrack[];
  } catch {
    return [];
  }
}

export function addRecent(track: { id: string; name: string }): void {
  const list = getRecents().filter((t) => t.id !== track.id);
  list.unshift({ id: track.id, name: track.name, addedAt: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
}

export function removeRecent(id: string): void {
  localStorage.setItem(KEY, JSON.stringify(getRecents().filter((t) => t.id !== id)));
}
