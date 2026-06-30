/**
 * Exportação da sessão para arquivo único (MP3 320k ou WAV 24-bit).
 *
 * - Renderiza CICLO A CICLO (OfflineAudioContext) → memória baixa.
 * - MP3 é encodado em POOL DE WEB WORKERS (vários núcleos, em paralelo, fora da
 *   thread da tela). Cada ciclo vira um MP3 independente; as junções caem no
 *   silêncio do intervalo final, então não há estalos.
 * - A saída pode ir DIRETO PRO DISCO (File System Access API) — assim dá para
 *   exportar horas de áudio sem acumular tudo na memória. Sem isso, cai para um
 *   Blob em memória (fallback).
 * - A música é uma PLAYLIST decodificada sob demanda (faixas longas com cap).
 *
 * Tudo roda no aparelho do usuário — sem servidor, sem custo.
 */
import type { AudioClip, Project } from '../../core/types';
import { computeSchedule } from '../audio/session-engine';
import { buildStack } from '../audio/voice-effects';
import { bufferFromClip } from '../audio/playback';

export type ExportFormat = 'mp3' | 'wav';

export interface ExportTrack {
  decode: () => Promise<AudioBuffer>;
  durationSec: number;
  rate: number;
}

interface Seg { trackIndex: number; startSession: number; endSession: number; rate: number; }

interface Sink {
  write: (b: Uint8Array) => Promise<void> | void;
  close: () => Promise<Blob | null>;
}

export interface ExportParams {
  project: Project;
  clips: Map<string, AudioClip>;
  tracks: ExportTrack[];
  format: ExportFormat;
  /** Bitrate do MP3 em kbps (256 padrão recomendado, 320 máximo). */
  bitrate?: number;
  /** FileSystemWritableFileStream para gravar no disco; ausente = Blob em memória. */
  writable?: { write: (b: BufferSource) => Promise<void>; close: () => Promise<void> } | null;
  onProgress?: (frac: number) => void;
}

function makeSink(writable: ExportParams['writable'], mime: string): Sink {
  if (writable) {
    return { write: (b) => writable.write(b as unknown as BufferSource), close: async () => { await writable.close(); return null; } };
  }
  const parts: BlobPart[] = [];
  return {
    write: (b) => { parts.push(b as unknown as BlobPart); },
    close: async () => new Blob(parts, { type: mime }),
  };
}

function buildSegments(tracks: ExportTrack[], totalSec: number): Seg[] {
  const segs: Seg[] = [];
  if (tracks.length === 0 || totalSec <= 0) return segs;
  let t = 0; let i = 0; let guard = 0;
  while (t < totalSec && guard < 100000) {
    const tr = tracks[i % tracks.length];
    const rate = tr.rate || 1;
    const len = tr.durationSec / rate;
    if (!isFinite(len) || len <= 0) break;
    segs.push({ trackIndex: i % tracks.length, startSession: t, endSession: t + len, rate });
    t += len; i++; guard++;
  }
  return segs;
}

function makeMp3Pool(n: number, kbps: number) {
  const workers = Array.from({ length: n }, () =>
    new Worker(new URL('./mp3-worker.ts', import.meta.url), { type: 'module' }),
  );
  const idle = [...workers];
  const waiters: (() => void)[] = [];
  const cbs = new Map<Worker, (ci: number, b: Uint8Array) => void>();
  let active = 0;
  let drainResolve: (() => void) | null = null;

  for (const w of workers) {
    w.onmessage = (e: MessageEvent) => {
      const { cycleIndex, mp3 } = e.data as { cycleIndex: number; mp3: ArrayBuffer };
      const cb = cbs.get(w); cbs.delete(w);
      idle.push(w); active--;
      waiters.shift()?.();
      cb?.(cycleIndex, new Uint8Array(mp3));
      if (active === 0 && drainResolve) { drainResolve(); drainResolve = null; }
    };
  }
  async function acquire(): Promise<Worker> {
    if (idle.length) return idle.pop()!;
    await new Promise<void>((r) => waiters.push(r));
    return idle.pop()!;
  }
  return {
    async dispatch(ci: number, L: Float32Array, R: Float32Array, sr: number, onResult: (ci: number, b: Uint8Array) => void) {
      const w = await acquire();
      active++;
      cbs.set(w, onResult);
      w.postMessage({ cycleIndex: ci, L, R, sampleRate: sr, kbps }, [L.buffer as ArrayBuffer, R.buffer as ArrayBuffer]);
    },
    drain(): Promise<void> { return active === 0 ? Promise.resolve() : new Promise<void>((r) => { drainResolve = r; }); },
    destroy() { for (const w of workers) w.terminate(); },
  };
}

export async function exportSession(p: ExportParams): Promise<Blob | null> {
  const { project, clips, tracks, format, writable, onProgress } = p;
  const kbps = p.bitrate || 320;
  const s = project.settings;
  const sr = s.sampleRate;
  const channels = 2;
  const schedule = computeSchedule(project, clips);
  if (schedule.recorded.length === 0) throw new Error('Nenhum comando gravado.');

  const cycleSamples = Math.round(schedule.cycleSec * sr);
  const cycles = schedule.cycles;
  const stack = s.voiceStack.map((id) => ({ id, intensity: s.voiceIntensities[id] ?? 0.5 }));
  const segments = buildSegments(tracks, schedule.totalSec);

  const bufCache = new Map<number, AudioBuffer>();
  async function getTrackBuffer(idx: number): Promise<AudioBuffer> {
    let b = bufCache.get(idx);
    if (!b) { b = await tracks[idx].decode(); bufCache.set(idx, b); }
    return b;
  }

  const sink = makeSink(writable, format === 'mp3' ? 'audio/mpeg' : 'audio/wav');

  if (format === 'wav') {
    await sink.write(wavHeader(sr, channels, cycles * cycleSamples));
  }

  // Pool de workers (MP3). Usa vários núcleos, sem exagerar.
  const N = Math.max(1, Math.min(navigator.hardwareConcurrency || 2, 4));
  const pool = format === 'mp3' ? makeMp3Pool(N, kbps) : null;

  // Escrita em ordem (os ciclos podem voltar dos workers fora de ordem)
  let nextWrite = 0;
  const buffered = new Map<number, Uint8Array>();
  let writeChain: Promise<void> = Promise.resolve();
  function writeInOrder(ci: number, bytes: Uint8Array) {
    buffered.set(ci, bytes);
    writeChain = writeChain.then(async () => {
      while (buffered.has(nextWrite)) {
        const b = buffered.get(nextWrite)!;
        buffered.delete(nextWrite);
        await sink.write(b);
        nextWrite++;
      }
    });
  }

  for (let c = 0; c < cycles; c++) {
    const A = c * schedule.cycleSec;
    const B = A + schedule.cycleSec;
    const buf = await renderCycle(A, B);
    const L = buf.getChannelData(0).slice();
    const R = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice();

    if (pool) {
      await pool.dispatch(c, L, R, sr, writeInOrder);
    } else {
      await sink.write(pcm24Interleaved(L, R));
    }

    // libera buffers de faixas já tocadas
    for (const [idx] of bufCache) {
      const lastEnd = Math.max(0, ...segments.filter((sg) => sg.trackIndex === idx).map((sg) => sg.endSession));
      if (lastEnd < A) bufCache.delete(idx);
    }
    onProgress?.((c + 1) / cycles);
  }

  if (pool) { await pool.drain(); await writeChain; pool.destroy(); }
  return sink.close();

  async function renderCycle(A: number, B: number): Promise<AudioBuffer> {
    const ctx = new OfflineAudioContext(channels, cycleSamples, sr);

    const voiceGain = ctx.createGain();
    voiceGain.gain.value = s.voiceVolume;
    const chain = buildStack(ctx, stack);
    voiceGain.connect(chain.input);
    chain.output.connect(ctx.destination);

    let offset = 0;
    schedule.recorded.forEach((r, i) => {
      const clip = clips.get(r.recordingId);
      if (clip) {
        const src = ctx.createBufferSource();
        src.buffer = bufferFromClip(ctx, clip);
        src.connect(voiceGain);
        src.start(offset);
      }
      offset += r.durationSec + (i < schedule.recorded.length - 1 ? s.gapBetweenCommandsSec : 0);
    });

    const overlapping = segments.filter((sg) => sg.endSession > A && sg.startSession < B);
    if (overlapping.length > 0) {
      const mg = ctx.createGain();
      mg.gain.value = s.musicVolume;
      mg.connect(ctx.destination);
      for (const sg of overlapping) {
        const buffer = await getTrackBuffer(sg.trackIndex);
        const m = ctx.createBufferSource();
        m.buffer = buffer;
        m.playbackRate.value = sg.rate;
        m.connect(mg);
        const whenInCycle = Math.max(0, sg.startSession - A);
        const bufOffset = Math.max(0, (A - sg.startSession) * sg.rate);
        if (bufOffset < buffer.duration) m.start(whenInCycle, bufOffset);
      }
    }
    return ctx.startRendering();
  }
}

function pcm24Interleaved(L: Float32Array, R: Float32Array): Uint8Array {
  const frames = L.length;
  const out = new Uint8Array(frames * 2 * 3);
  let o = 0;
  const write = (x: number) => {
    const v = Math.max(-1, Math.min(1, x));
    const val = Math.round(v < 0 ? v * 0x800000 : v * 0x7fffff);
    out[o++] = val & 0xff; out[o++] = (val >> 8) & 0xff; out[o++] = (val >> 16) & 0xff;
  };
  for (let i = 0; i < frames; i++) { write(L[i]); write(R[i]); }
  return out;
}

function wavHeader(sampleRate: number, channels: number, totalFrames: number): Uint8Array {
  const bytesPerSample = 3;
  const dataSize = totalFrames * channels * bytesPerSample;
  const buf = new ArrayBuffer(44);
  const view = new DataView(buf);
  const wstr = (off: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  const blockAlign = channels * bytesPerSample;
  wstr(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true);
  view.setUint16(34, 24, true); wstr(36, 'data'); view.setUint32(40, dataSize, true);
  return new Uint8Array(buf);
}
