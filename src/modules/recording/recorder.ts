/**
 * Módulo de gravação de voz em alta fidelidade.
 *
 * Responsabilidade: capturar a voz do microfone como PCM Float32 cru, a 48 kHz,
 * sem compressão. Devolve um AudioClip pronto para reprodução/edição/export.
 *
 * Mantém a prioridade nº1: máxima fidelidade da voz. Por isso desativamos
 * processamentos do navegador que coloririam o som (echoCancellation,
 * noiseSuppression, autoGainControl) — queremos o sinal o mais limpo possível.
 */
import type { AudioClip } from '../../core/types';
import workletUrl from './pcm-recorder-worklet.js?url';

export interface RecorderOptions {
  sampleRate?: number;
}

export class VoiceRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[][] = [];
  private numChannels = 1;
  private readonly targetSampleRate: number;

  constructor(opts: RecorderOptions = {}) {
    this.targetSampleRate = opts.sampleRate ?? 48000;
  }

  get isRecording(): boolean {
    return this.node !== null;
  }

  /** Pede acesso ao microfone e prepara o grafo de áudio. Chame uma vez. */
  async init(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: this.targetSampleRate,
      },
    });

    this.ctx = new AudioContext({ sampleRate: this.targetSampleRate });
    await this.ctx.audioWorklet.addModule(workletUrl);
    this.source = this.ctx.createMediaStreamSource(this.stream);
  }

  /** Começa a acumular amostras. */
  start(): void {
    if (!this.ctx || !this.source) {
      throw new Error('Recorder não inicializado — chame init() antes.');
    }
    this.chunks = [];
    this.node = new AudioWorkletNode(this.ctx, 'pcm-recorder');
    this.node.port.onmessage = (e: MessageEvent) => {
      const channels = e.data.channels as Float32Array[];
      this.numChannels = channels.length;
      this.chunks.push(channels);
    };
    this.source.connect(this.node);
    // Conecta a um ganho mudo só para manter o nó ativo no grafo.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(this.ctx.destination);
    this.node.port.postMessage('start');
  }

  /** Para a captura e devolve o áudio gravado como AudioClip. */
  stop(): AudioClip {
    if (!this.node || !this.ctx) {
      throw new Error('Nenhuma gravação em andamento.');
    }
    this.node.port.postMessage('stop');
    this.node.disconnect();
    this.source?.disconnect();
    this.node = null;

    const channels = this.mergeChunks();
    const durationSec = channels[0].length / this.ctx.sampleRate;
    return { channels, sampleRate: this.ctx.sampleRate, durationSec };
  }

  /** Libera microfone e contexto de áudio. */
  async dispose(): Promise<void> {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    if (this.ctx && this.ctx.state !== 'closed') await this.ctx.close();
    this.ctx = null;
  }

  private mergeChunks(): Float32Array[] {
    const totalLength = this.chunks.reduce((sum, c) => sum + (c[0]?.length ?? 0), 0);
    const out: Float32Array[] = [];
    for (let ch = 0; ch < this.numChannels; ch++) {
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of this.chunks) {
        merged.set(chunk[ch], offset);
        offset += chunk[ch].length;
      }
      out.push(merged);
    }
    return out;
  }
}
