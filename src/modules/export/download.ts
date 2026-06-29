/**
 * Utilitários de download de áudio sem perdas (WAV 24-bit).
 *
 * Não depende de bibliotecas externas — usa o encoder wav.ts já existente.
 * WAV 24-bit é o formato de referência de alta fidelidade do projeto.
 * FLAC fica registrado como próxima opção (precisaria de libflac.js/WASM).
 */
import { encodeWav } from '../audio/wav';
import type { AudioClip } from '../../core/types';

/** Dispara o download de um Blob com o nome de arquivo dado. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const triggerDownload = downloadBlob;

/** Baixa um AudioClip como WAV 24-bit. */
export function downloadClipWav(clip: AudioClip, filename: string): void {
  const blob = encodeWav(clip, 24);
  triggerDownload(blob, filename);
}

/**
 * Baixa vários clips em sequência com intervalo entre cada um.
 * O navegador bloqueia múltiplos downloads simultâneos; o intervalo evita isso.
 */
export function downloadClipsSequential(
  items: { clip: AudioClip; filename: string }[],
  intervalMs = 400,
): void {
  items.forEach(({ clip, filename }, i) => {
    setTimeout(() => downloadClipWav(clip, filename), i * intervalMs);
  });
}
