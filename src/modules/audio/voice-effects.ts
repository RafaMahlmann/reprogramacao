/**
 * Efeitos de voz — presets de um toque, 100% nativos (Web Audio API).
 *
 * Nenhuma dependência externa: EQ (BiquadFilter), compressor
 * (DynamicsCompressor), reverb (Convolver com IR sintetizado), eco (Delay) e
 * calor (WaveShaper). A cadeia é não-destrutiva: vive na trilha de voz e pode
 * ser trocada/desligada ao vivo, sem alterar as gravações originais.
 */

export interface VoicePreset {
  id: string;
  name: string;
  icon: string;
  desc: string;
}

/** Efeitos combináveis (podem ser empilhados). 'none' não entra na lista. */
export const VOICE_PRESETS: VoicePreset[] = [
  { id: 'clean', name: 'Voz limpa', icon: '✨', desc: 'Tira pop e uniformiza' },
  { id: 'warm', name: 'Voz quente', icon: '🔥', desc: 'Grave macio, encorpada' },
  { id: 'room', name: 'Sala ampla', icon: '🏠', desc: 'Reverb sutil' },
  { id: 'cave', name: 'Cavernoso', icon: '🏛️', desc: 'Reverb grande' },
  { id: 'echo', name: 'Eco suave', icon: '🌫️', desc: 'Delay leve' },
  { id: 'mic_clean', name: 'Limpeza de microfone', icon: '🧹', desc: 'High-pass + de-esser' },
];

/** Intensidade padrão ao ativar cada efeito (0..1). */
export const DEFAULT_INTENSITY: Record<string, number> = {
  clean: 0.5,
  warm: 0.5,
  room: 0.4,
  cave: 0.5,
  echo: 0.04, // baixo de propósito — em alto distorce
  mic_clean: 0.6,
};

/** Gera um impulse-response sintético (ruído com decaimento exponencial). */
function makeImpulseResponse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const ir = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return ir;
}

/** Curva de saturação suave (warmth) para o WaveShaper. */
function softCurve(amount: number): Float32Array {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = amount * 8;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

export interface BuiltChain { input: AudioNode; output: AudioNode; }

/** Monta a sub-cadeia de um preset. `intensity` em 0..1. */
export function buildChain(ctx: BaseAudioContext, presetId: string, intensity: number): BuiltChain {
  const input = ctx.createGain();
  const output = ctx.createGain();

  const wetDry = (effect: AudioNode, tail?: AudioNode) => {
    const dry = ctx.createGain(); dry.gain.value = 1 - intensity * 0.5;
    const wet = ctx.createGain(); wet.gain.value = intensity;
    input.connect(dry).connect(output);
    input.connect(effect);
    (tail ?? effect).connect(wet).connect(output);
  };

  switch (presetId) {
    case 'clean': {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -24; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
      input.connect(hp).connect(comp).connect(output);
      break;
    }
    case 'warm': {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 60;
      const shelf = ctx.createBiquadFilter(); shelf.type = 'lowshelf';
      shelf.frequency.value = 220; shelf.gain.value = 3 + intensity * 6;
      const shaper = ctx.createWaveShaper(); shaper.curve = softCurve(intensity * 0.6) as Float32Array<ArrayBuffer>;
      input.connect(hp).connect(shelf).connect(shaper).connect(output);
      break;
    }
    case 'room': {
      const conv = ctx.createConvolver(); conv.buffer = makeImpulseResponse(ctx, 1.2, 3);
      wetDry(conv);
      break;
    }
    case 'cave': {
      const conv = ctx.createConvolver(); conv.buffer = makeImpulseResponse(ctx, 3.5, 2);
      wetDry(conv);
      break;
    }
    case 'echo': {
      const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.28;
      const fb = ctx.createGain(); fb.gain.value = 0.35 + intensity * 0.3;
      delay.connect(fb).connect(delay);
      wetDry(delay);
      break;
    }
    case 'mic_clean': {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 110;
      const deess = ctx.createBiquadFilter(); deess.type = 'peaking';
      deess.frequency.value = 7000; deess.Q.value = 2; deess.gain.value = -(4 + intensity * 8);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -22; comp.ratio.value = 4;
      input.connect(hp).connect(deess).connect(comp).connect(output);
      break;
    }
    case 'none':
    default:
      input.connect(output);
  }

  return { input, output };
}

export interface StackItem { id: string; intensity: number; }

/** Encadeia vários efeitos em série. Pilha vazia = passa direto. */
export function buildStack(ctx: BaseAudioContext, stack: StackItem[]): BuiltChain {
  const input = ctx.createGain();
  if (stack.length === 0) {
    const output = ctx.createGain();
    input.connect(output);
    return { input, output };
  }
  let prev: AudioNode = input;
  let lastOut: AudioNode = input;
  for (const item of stack) {
    const chain = buildChain(ctx, item.id, item.intensity);
    prev.connect(chain.input);
    prev = chain.output;
    lastOut = chain.output;
  }
  return { input, output: lastOut };
}

/** Cadeia de efeitos viva, reconfigurável (pilha), na trilha de voz. */
export class VoiceEffectChain {
  readonly input: GainNode;
  private readonly ctx: BaseAudioContext;
  private readonly destination: AudioNode;
  private inner: BuiltChain | null = null;
  private stack: StackItem[] = [];

  constructor(ctx: BaseAudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.destination = destination;
    this.input = ctx.createGain();
    this.rebuild();
  }

  setStack(stack: StackItem[]) {
    this.stack = stack;
    this.rebuild();
  }

  private rebuild() {
    this.input.disconnect();
    if (this.inner) { try { this.inner.output.disconnect(); } catch { /* noop */ } }
    this.inner = buildStack(this.ctx, this.stack);
    this.input.connect(this.inner.input);
    this.inner.output.connect(this.destination);
  }
}
