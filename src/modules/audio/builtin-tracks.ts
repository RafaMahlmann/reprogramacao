/**
 * Trilhas internas em 432 Hz, sintetizadas no próprio navegador.
 *
 * São pads ambientes gerados por osciladores (sem nenhum arquivo de áudio de
 * terceiros — zero problema de direitos autorais / supply-chain). Renderizados
 * uma vez via OfflineAudioContext e guardados como WAV no mediaStore.
 *
 * Loop sem emenda: a duração é inteira (24 s) e todas as frequências são
 * inteiras/meio-inteiras, então cada parcial completa um número exato de ciclos
 * — o fim casa com o início sem clique.
 */
import { encodeWav } from './wav';
import type { AudioClip } from '../../core/types';

interface Partial { freq: number; gain: number; }

interface PadRecipe {
  id: string;
  name: string;
  partials: Partial[];
  cutoffHz: number;
  lfoPeriodSec: number;
  lfoDepth: number;
}

const DURATION = 24;
const SR = 48000;

export const BUILTIN_TRACKS: PadRecipe[] = [
  {
    id: 'builtin:sereno',
    name: '432 Hz · Sereno',
    partials: [
      { freq: 216, gain: 0.5 },
      { freq: 432, gain: 0.45 },
      { freq: 648, gain: 0.22 },
      { freq: 864, gain: 0.12 },
    ],
    cutoffHz: 1800,
    lfoPeriodSec: 8,
    lfoDepth: 0.14,
  },
  {
    id: 'builtin:profundo',
    name: '432 Hz · Profundo',
    partials: [
      { freq: 108, gain: 0.55 },
      { freq: 216, gain: 0.4 },
      { freq: 432, gain: 0.3 },
    ],
    cutoffHz: 1100,
    lfoPeriodSec: 12,
    lfoDepth: 0.18,
  },
  {
    id: 'builtin:luz',
    name: '432 Hz · Luz',
    partials: [
      { freq: 432, gain: 0.45 },
      { freq: 648, gain: 0.3 },
      { freq: 864, gain: 0.2 },
      { freq: 1296, gain: 0.1 },
    ],
    cutoffHz: 3200,
    lfoPeriodSec: 6,
    lfoDepth: 0.12,
  },
];

export function getBuiltinName(id: string): string | undefined {
  return BUILTIN_TRACKS.find((t) => t.id === id)?.name;
}

/** Renderiza um pad para WAV (Blob). Usa cache em memória por id. */
const cache = new Map<string, Blob>();

export async function renderBuiltinTrack(id: string): Promise<Blob> {
  if (cache.has(id)) return cache.get(id)!;
  const recipe = BUILTIN_TRACKS.find((t) => t.id === id);
  if (!recipe) throw new Error(`Trilha interna desconhecida: ${id}`);

  const offline = new OfflineAudioContext(1, SR * DURATION, SR);

  const master = offline.createGain();
  master.gain.value = 0.5;

  const lowpass = offline.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = recipe.cutoffHz;
  lowpass.connect(master).connect(offline.destination);

  // LFO suave de amplitude
  const lfo = offline.createOscillator();
  lfo.frequency.value = 1 / recipe.lfoPeriodSec;
  const lfoGain = offline.createGain();
  lfoGain.gain.value = recipe.lfoDepth;
  lfo.connect(lfoGain).connect(master.gain);
  lfo.start(0);
  lfo.stop(DURATION);

  for (const p of recipe.partials) {
    const osc = offline.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = p.freq;
    const g = offline.createGain();
    g.gain.value = p.gain;
    osc.connect(g).connect(lowpass);
    osc.start(0);
    osc.stop(DURATION);
  }

  const rendered = await offline.startRendering();
  const clip: AudioClip = {
    channels: [rendered.getChannelData(0).slice()],
    sampleRate: rendered.sampleRate,
    durationSec: rendered.duration,
  };
  const blob = encodeWav(clip, 24);
  cache.set(id, blob);
  return blob;
}
