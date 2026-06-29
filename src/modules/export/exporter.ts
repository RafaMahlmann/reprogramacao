/**
 * Exportação da sessão para arquivo único (MP3 320k ou WAV 24-bit).
 *
 * Renderiza a sessão CICLO A CICLO via OfflineAudioContext (cada ciclo = a
 * sequência 1→N + intervalos + intervalo final). Como os ciclos terminam em
 * silêncio (o intervalo final), as caudas de reverb/eco já decaíram nas bordas
 * — sem emendas audíveis. Isso mantém a memória baixa mesmo em sessões longas.
 *
 * MP3: encodado de forma incremental (lamejs), some os bytes em pedaços.
 * WAV: PCM 24-bit (só prático em sessões curtas — grande demais para 1h+).
 *
 * Aplica voz + efeitos + volumes + música em loop + ajuste 432 (via playbackRate
 * = resample), igual ao preview.
 */
import * as lamejs from '@breezystack/lamejs';
import type { AudioClip, Project } from '../../core/types';
import { computeSchedule } from '../audio/session-engine';
import { buildStack } from '../audio/voice-effects';
import { bufferFromClip } from '../audio/playback';

export type ExportFormat = 'mp3' | 'wav';

export interface ExportParams {
  project: Project;
  clips: Map<string, AudioClip>;
  musicBuffer: AudioBuffer | null;
  musicRate: number;
  format: ExportFormat;
  onProgress?: (frac: number) => void;
}

function floatTo16(x: number): number {
  const v = Math.max(-1, Math.min(1, x));
  return v < 0 ? v * 0x8000 : v * 0x7fff;
}

export async function exportSession(p: ExportParams): Promise<Blob> {
  const { project, clips, musicBuffer, musicRate, format, onProgress } = p;
  const s = project.settings;
  const sr = s.sampleRate;
  const channels = 2;
  const schedule = computeSchedule(project, clips);
  if (schedule.recorded.length === 0) throw new Error('Nenhum comando gravado.');

  const cycleSamples = Math.round(schedule.cycleSec * sr);
  const cycles = schedule.cycles;
  const stack = s.voiceStack.map((id) => ({ id, intensity: s.voiceIntensities[id] ?? 0.5 }));

  const mp3enc = format === 'mp3' ? new lamejs.Mp3Encoder(channels, sr, 320) : null;
  const parts: BlobPart[] = [];

  for (let c = 0; c < cycles; c++) {
    const buf = await renderCycle(c);
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

    onProgress?.((c + 1) / cycles);
    await new Promise((r) => setTimeout(r, 0)); // cede o controle à UI
  }

  if (mp3enc) {
    const end = mp3enc.flush();
    if (end.length > 0) parts.push(new Uint8Array(end));
    return new Blob(parts, { type: 'audio/mpeg' });
  }
  return buildWav24(parts, sr, channels, cycles * cycleSamples);

  async function renderCycle(c: number): Promise<AudioBuffer> {
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

    if (musicBuffer) {
      const m = ctx.createBufferSource();
      m.buffer = musicBuffer;
      m.loop = true;
      m.playbackRate.value = musicRate;
      const mg = ctx.createGain();
      mg.gain.value = s.musicVolume;
      m.connect(mg).connect(ctx.destination);
      const musicOffset = ((c * schedule.cycleSec * musicRate) % musicBuffer.duration + musicBuffer.duration) % musicBuffer.duration;
      m.start(0, musicOffset);
    }

    return ctx.startRendering();
  }
}

/** Interleava L/R em PCM 24-bit little-endian. */
function pcm24Interleaved(L: Float32Array, R: Float32Array): Uint8Array {
  const frames = L.length;
  const out = new Uint8Array(frames * 2 * 3);
  let o = 0;
  const write = (x: number) => {
    const s = Math.max(-1, Math.min(1, x));
    const val = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
    out[o++] = val & 0xff;
    out[o++] = (val >> 8) & 0xff;
    out[o++] = (val >> 16) & 0xff;
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
