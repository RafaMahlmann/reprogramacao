/**
 * Detecção da afinação de referência da música (440? 432? outra).
 *
 * Método: para muitos quadros do áudio, faz a FFT, acha os picos espectrais e
 * mede o quanto cada pico está "fora" do grid temperado padrão (A4 = 440 Hz),
 * em cents. A média circular desses desvios (ponderada pela energia) dá o
 * deslocamento global de afinação → a frequência de referência.
 *
 * Exemplos:
 *  - música em 440 Hz → desvios perto de 0   → referência ≈ 440
 *  - música em 432 Hz → desvios perto de -31.8 cents → referência ≈ 432
 *
 * Tudo nativo (Web Audio + FFT própria), sem dependências. NÃO altera o áudio.
 */
import { fft } from './fft';

export interface TuningResult {
  /** Frequência de referência estimada (Hz). */
  referenceHz: number;
  /** Deslocamento em cents em relação ao padrão 440. */
  offsetCents: number;
  /** Concentração da estimativa (0..1). Acima de ~0.5 é confiável. */
  confidence: number;
}

/** Razão de pitch para levar de uma referência detectada até 432 Hz exato. */
export function ratioTo432(referenceHz: number): number {
  return 432 / referenceHz;
}

/** Decodifica um trecho da música para análise, sem carregar tudo na memória. */
export async function decodeForAnalysis(blob: Blob): Promise<AudioBuffer> {
  const sizes = blob.size <= 40e6 ? [blob.size] : [15e6, 6e6, 3e6];
  let lastErr: unknown;
  for (const size of sizes) {
    try {
      const arr = await blob.slice(0, size).arrayBuffer();
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const buf = await ctx.decodeAudioData(arr);
      return buf;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('Não foi possível decodificar a música para análise.');
}

/** Analisa a afinação de referência de um AudioBuffer. */
export function analyzeTuning(buffer: AudioBuffer): TuningResult {
  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const N = 8192;
  const half = N >> 1;

  // Janela de Hann
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));

  // Faixa de frequências com conteúdo afinado claro
  const minF = 100;
  const maxF = 1600;
  const minBin = Math.floor((minF * N) / sr);
  const maxBin = Math.ceil((maxF * N) / sr);

  // Pula os primeiros ~3 s (fade-in/silêncio) e limita o nº de quadros
  const start0 = Math.min(data.length, Math.floor(sr * 3));
  const maxFrames = 280;
  const usable = data.length - N - start0;
  if (usable <= 0) return { referenceHz: 440, offsetCents: 0, confidence: 0 };
  const hop = Math.max(N, Math.floor(usable / maxFrames));

  let X = 0;
  let Y = 0;
  let totalW = 0;

  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const mag = new Float32Array(half);

  for (let start = start0; start + N <= data.length; start += hop) {
    for (let k = 0; k < N; k++) { re[k] = data[start + k] * win[k]; im[k] = 0; }
    fft(re, im);
    let maxMag = 0;
    for (let k = minBin; k <= maxBin; k++) {
      mag[k] = Math.hypot(re[k], im[k]);
      if (mag[k] > maxMag) maxMag = mag[k];
    }
    if (maxMag <= 0) continue;
    const thr = maxMag * 0.2;

    for (let k = minBin + 1; k < maxBin; k++) {
      const m = mag[k];
      if (m < thr || m <= mag[k - 1] || m < mag[k + 1]) continue; // pico local
      // Interpolação parabólica para frequência sub-bin
      const dk = (0.5 * (mag[k - 1] - mag[k + 1])) / (mag[k - 1] - 2 * m + mag[k + 1] || 1);
      const f = ((k + dk) * sr) / N;
      if (f < minF || f > maxF) continue;
      const p = 12 * Math.log2(f / 440) + 69;
      const dev = p - Math.round(p); // fração de semitom em [-0.5, 0.5]
      const theta = 2 * Math.PI * dev;
      X += m * Math.cos(theta);
      Y += m * Math.sin(theta);
      totalW += m;
    }
  }

  if (totalW === 0) return { referenceHz: 440, offsetCents: 0, confidence: 0 };

  const meanTheta = Math.atan2(Y, X);
  const meanDev = meanTheta / (2 * Math.PI); // semitons
  const offsetCents = meanDev * 100;
  const referenceHz = 440 * Math.pow(2, meanDev / 12);
  const confidence = Math.hypot(X, Y) / totalW; // comprimento resultante médio

  return { referenceHz, offsetCents, confidence };
}

/** Análise completa a partir do Blob da música. */
export async function detectTuning(blob: Blob): Promise<TuningResult> {
  const buffer = await decodeForAnalysis(blob);
  return analyzeTuning(buffer);
}
