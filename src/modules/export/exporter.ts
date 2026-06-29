/**
 * Exportação do projeto para um único arquivo de áudio.
 *
 * STATUS: parcial. O caminho sem perdas (WAV) já existe em audio/wav.ts.
 * O MP3 de alta qualidade (320 kbps) virá com a biblioteca `@breezystack/lamejs`
 * (fork mantido do lamejs, MIT) — a aprovar em docs/LIBRARIES.md.
 *
 * Nota de fidelidade: MP3 é com perdas e não suporta 24 bits. Por isso o
 * formato de referência é WAV; o MP3 é uma conveniência de tamanho/distribuição.
 */
import type { Project } from '../../core/types';

export type ExportFormat = 'wav' | 'mp3';

export interface ExportOptions {
  format: ExportFormat;
  /** Bitrate do MP3 em kbps (ignorado para WAV). */
  mp3Bitrate?: number;
}

export async function exportProject(_project: Project, _opts: ExportOptions): Promise<Blob> {
  throw new Error('exportProject: pipeline de mixagem/encode ainda não implementado.');
}
