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
