/**
 * Reprodução de AudioClip (PCM Float32) via Web Audio, sem perdas.
 *
 * Mantém um único AudioContext compartilhado para evitar estourar o limite
 * de contextos do navegador.
 */
import type { AudioClip } from '../../core/types';

let sharedCtx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') sharedCtx = new AudioContext();
  return sharedCtx;
}

export function clipToAudioBuffer(clip: AudioClip): AudioBuffer {
  return bufferFromClip(ctx(), clip);
}

/** Cria um AudioBuffer de um clip num contexto específico. */
export function bufferFromClip(audioCtx: BaseAudioContext, clip: AudioClip): AudioBuffer {
  const buffer = audioCtx.createBuffer(clip.channels.length, clip.channels[0].length, clip.sampleRate);
  clip.channels.forEach((data, ch) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, ch));
  return buffer;
}

/** Toca o clip e devolve uma função para parar. */
export function playClip(clip: AudioClip, onEnded?: () => void): () => void {
  const audioCtx = ctx();
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  const source = audioCtx.createBufferSource();
  source.buffer = clipToAudioBuffer(clip);
  source.connect(audioCtx.destination);
  if (onEnded) source.onended = onEnded;
  source.start();
  return () => {
    try {
      source.stop();
    } catch {
      /* já parado */
    }
  };
}
