/**
 * Exportação da sessão para arquivo único (MP3 320k ou WAV 24-bit).
 *
 * Renderiza CICLO A CICLO via OfflineAudioContext (memória baixa) e encoda o
 * MP3 incrementalmente. A música é uma PLAYLIST tocada em sequência (sem loop
 * monótono): as faixas são decodificadas SOB DEMANDA, em ordem de tempo, e
 * liberadas quando não são mais necessárias — então a playlist pode ser longa
 * sem estourar a memória.
 *
 * Aplica voz + efeitos + volumes + música em sequência + ajuste 432 (rate).
 */
import * as lamejs from '@breezystack/lamejs';
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

export interface ExportParams {
  project: Project;
  clips: Map<string, AudioClip>;
  tracks: ExportTrack[];
  format: ExportFormat;
  onProgress?: (frac: number) => void;
}

function floatTo16(x: number): number {
  const v = Math.max(-1, Math.min(1, x));
  return v < 0 ? v * 0x8000 : v * 0x7fff;
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

export async function exportSession(p: ExportParams): Promise<Blob> {
  const { project, clips, tracks, format, onProgress } = p;
  const s = project.settings;
  const sr = s.sampleRate;
  const channels = 2;
  const schedule = computeSchedule(project, clips);
  if (schedule.recorded.length === 0) throw new Error('Nenhum comando gravado.');

  const cycleSamples = Math.round(schedule.cycleSec * sr);
  const cycles = schedule.cycles;
  const stack = s.voiceStack.map((id) => ({ id, intensity: s.voiceIntensities[id] ?? 0.5 }));
  const segments = buildSegments(tracks, schedule.totalSec);

  // cache de buffers decodificados (um por faixa); liberado quando não usado mais
  const bufCache = new Map<number, AudioBuffer>();
  async function getTrackBuffer(idx: number): Promise<AudioBuffer> {
    let b = bufCache.get(idx);
    if (!b) { b = await tracks[idx].decode(); bufCache.set(idx, b); }
    return b;
  }

  const mp3enc = format === 'mp3' ? new lamejs.Mp3Encoder(channels, sr, 320) : null;
  const parts: BlobPart[] = [];

  for (let c = 0; c < cycles; c++) {
    const A = c * schedule.cycleSec;
    const B = A + schedule.cycleSec;
    const buf = await renderCycle(c, A, B);
    const L = buf.getChannelData(0);
    const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;

    if (mp3enc) {
      const l16 = new Int16Array(L.length);
      const r16 = new Int16Array(R.length);
      for (let i = 0; i < L.length; i++) { l16[i] = floatTo16(L[i]); r16[i] = floatTo16(R[i]); }
      const BLOCK = 1152;
      for (let i = 0; i < l16.length; i += BLOCK) {
        const data = mp3enc.encodeBuffer(l16.subarray(i, i + BLOCK), r16.subarray(i, i + BLOCK));
        if (data.length > 0) parts.push(new Uint8Array(data) as unknown as BlobPart);
      }
    } else {
      parts.push(pcm24Interleaved(L, R) as unknown as BlobPart);
    }

    // libera buffers de faixas que já passaram
    for (const [idx] of bufCache) {
      const lastEnd = Math.max(0, ...segments.filter((sg) => sg.trackIndex === idx).map((sg) => sg.endSession));
      if (lastEnd < A) bufCache.delete(idx);
    }

    onProgress?.((c + 1) / cycles);
    await new Promise((r) => setTimeout(r, 0));
  }

  if (mp3enc) {
    const end = mp3enc.flush();
    if (end.length > 0) parts.push(new Uint8Array(end) as unknown as BlobPart);
    return new Blob(parts, { type: 'audio/mpeg' });
  }
  return buildWav24(parts, sr, channels, cycles * cycleSamples);

  async function renderCycle(_c: number, A: number, B: number): Promise<AudioBuffer> {
    const ctx = new OfflineAudioContext(channels, cycleSamples, sr);

    // voz
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

    // música: segmentos que cruzam [A, B)
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

function buildWav24(parts: BlobPart[], sampleRate: number, channels: number, totalFrames: number): Blob {
  const bytesPerSample = 3;
  const dataSize = totalFrames * channels * bytesPerSample;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const wstr = (off: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  const blockAlign = channels * bytesPerSample;
  wstr(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true);
  view.setUint16(34, 24, true); wstr(36, 'data'); view.setUint32(40, dataSize, true);
  return new Blob([header, ...parts], { type: 'audio/wav' });
}
