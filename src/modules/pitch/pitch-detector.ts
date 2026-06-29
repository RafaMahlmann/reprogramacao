/**
 * Detecção de afinação da música de fundo + ajuste para 432 Hz.
 *
 * STATUS: stub. Interface definida; implementação na próxima etapa.
 *
 * Biblioteca candidata (a aprovar em docs/LIBRARIES.md): `pitchfinder`
 * (algoritmos YIN/AMDF, MIT) para estimar a frequência de referência, e
 * análise de cromagrama para a tonalidade predominante.
 *
 * O ajuste para 432 Hz é uma mudança de afinação de ~ -31.8 cents
 * (razão 432/440 = 0.98182), aplicada na reprodução/exportação sem alterar
 * a duração da música (pitch shift sem time-stretch).
 */
import type { AudioClip } from '../../core/types';

export interface PitchAnalysis {
  /** Tonalidade predominante, ex.: "Lá menor". */
  key: string;
  /** Frequência de referência estimada (Hz). */
  referenceHz: number;
}

export async function analyzePitch(_clip: AudioClip): Promise<PitchAnalysis> {
  throw new Error('analyzePitch: não implementado ainda (ver módulo pitch).');
}

/** Razão de pitch para levar de uma referência detectada até 432 Hz. */
export function ratioTo432(referenceHz: number): number {
  return 432 / referenceHz;
}
