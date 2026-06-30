/**
 * Worker de encode MP3.
 *
 * Roda FORA da thread principal (a tela não trava) e em paralelo com outros
 * workers (usa vários núcleos do processador). Cada mensagem traz o PCM de UM
 * ciclo da sessão e devolve o MP3 daquele ciclo, já completo (encoder próprio +
 * flush). Como os ciclos terminam em silêncio, juntar os pedaços não gera
 * estalos audíveis.
 *
 * Tudo roda no aparelho do usuário — sem servidor, sem custo.
 */
import * as lamejs from '@breezystack/lamejs';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
};

function to16(x: number): number {
  const v = x < -1 ? -1 : x > 1 ? 1 : x;
  return v < 0 ? v * 0x8000 : v * 0x7fff;
}

ctx.onmessage = (e: MessageEvent) => {
  const { cycleIndex, L, R, sampleRate, kbps } = e.data as {
    cycleIndex: number; L: Float32Array; R: Float32Array; sampleRate: number; kbps?: number;
  };
  const enc = new lamejs.Mp3Encoder(2, sampleRate, kbps || 320);
  const n = L.length;
  const l16 = new Int16Array(n);
  const r16 = new Int16Array(n);
  for (let i = 0; i < n; i++) { l16[i] = to16(L[i]); r16[i] = to16(R[i]); }

  const chunks: Uint8Array[] = [];
  const BLOCK = 1152;
  for (let i = 0; i < n; i += BLOCK) {
    const d = enc.encodeBuffer(l16.subarray(i, i + BLOCK), r16.subarray(i, i + BLOCK));
    if (d.length > 0) chunks.push(new Uint8Array(d.buffer, d.byteOffset, d.length).slice());
  }
  const end = enc.flush();
  if (end.length > 0) chunks.push(new Uint8Array(end.buffer, end.byteOffset, end.length).slice());

  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }

  ctx.postMessage({ cycleIndex, mp3: out.buffer }, [out.buffer]);
};
