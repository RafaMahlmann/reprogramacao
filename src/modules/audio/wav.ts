/**
 * Codificação WAV PCM a partir de Float32, com suporte a 16/24/32 bits.
 *
 * WAV mantém a fidelidade total (sem perdas). É o formato de referência para
 * a prioridade nº1. O export MP3 (com perdas) virá depois, no módulo export,
 * sempre mantendo o WAV como opção de alta qualidade.
 */
import type { AudioClip } from '../../core/types';

export type BitDepth = 16 | 24 | 32;

export function encodeWav(clip: AudioClip, bitDepth: BitDepth = 24): Blob {
  const { channels, sampleRate } = clip;
  const numChannels = channels.length;
  const numFrames = channels[0].length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  // float 32 bits usa formato IEEE float (3); inteiros usam PCM (1).
  const format = bitDepth === 32 ? 3 : 1;

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      offset = writeSample(view, offset, sample, bitDepth);
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Decodifica um WAV (PCM 16/24/32-bit ou float 32) de volta para AudioClip.
 * Percorre os chunks RIFF para localizar 'fmt ' e 'data' com segurança.
 */
export function decodeWav(buffer: ArrayBuffer): AudioClip {
  const view = new DataView(buffer);
  const readStr = (off: number, len: number) =>
    String.fromCharCode(...new Uint8Array(buffer, off, len));

  if (readStr(0, 4) !== 'RIFF' || readStr(8, 4) !== 'WAVE') {
    throw new Error('Arquivo WAV inválido.');
  }

  let format = 1;
  let numChannels = 1;
  let sampleRate = 48000;
  let bitDepth = 24;
  let dataOffset = -1;
  let dataSize = 0;

  let off = 12;
  while (off + 8 <= view.byteLength) {
    const chunkId = readStr(off, 4);
    const chunkSize = view.getUint32(off + 4, true);
    const body = off + 8;
    if (chunkId === 'fmt ') {
      format = view.getUint16(body, true);
      numChannels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitDepth = view.getUint16(body + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = body;
      dataSize = chunkSize;
    }
    off = body + chunkSize + (chunkSize % 2); // chunks são alinhados em 2 bytes
  }

  if (dataOffset < 0) throw new Error('Chunk de dados não encontrado no WAV.');

  const bytesPerSample = bitDepth / 8;
  const numFrames = Math.floor(dataSize / (numChannels * bytesPerSample));
  const channels: Float32Array[] = Array.from({ length: numChannels }, () => new Float32Array(numFrames));

  let p = dataOffset;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      channels[ch][i] = readSample(view, p, bitDepth, format);
      p += bytesPerSample;
    }
  }

  return { channels, sampleRate, durationSec: numFrames / sampleRate };
}

function readSample(view: DataView, offset: number, bitDepth: number, format: number): number {
  if (format === 3) return view.getFloat32(offset, true); // IEEE float
  switch (bitDepth) {
    case 16:
      return view.getInt16(offset, true) / 0x8000;
    case 24: {
      const b0 = view.getUint8(offset);
      const b1 = view.getUint8(offset + 1);
      const b2 = view.getUint8(offset + 2);
      let val = (b2 << 16) | (b1 << 8) | b0;
      if (val & 0x800000) val |= ~0xffffff; // sinal de 24 bits
      return val / 0x800000;
    }
    case 32:
      return view.getInt32(offset, true) / 0x80000000;
    default:
      return 0;
  }
}

function writeSample(view: DataView, offset: number, sample: number, bitDepth: BitDepth): number {
  switch (bitDepth) {
    case 16: {
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      return offset + 2;
    }
    case 24: {
      const val = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
      view.setUint8(offset, val & 0xff);
      view.setUint8(offset + 1, (val >> 8) & 0xff);
      view.setUint8(offset + 2, (val >> 16) & 0xff);
      return offset + 3;
    }
    case 32: {
      view.setFloat32(offset, sample, true);
      return offset + 4;
    }
  }
}
