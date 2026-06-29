/**
 * AudioWorkletProcessor que captura PCM bruto (Float32) sem nenhuma compressão.
 *
 * Por que AudioWorklet e não MediaRecorder: MediaRecorder entrega áudio
 * comprimido (Opus/AAC), com perdas. Para a prioridade nº1 do projeto
 * (máxima fidelidade da voz), capturamos as amostras Float32 cruas direto
 * do grafo de áudio e só codificamos na hora de exportar.
 *
 * Cada bloco de 128 amostras é repassado ao thread principal via port.
 */
class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.port.onmessage = (e) => {
      if (e.data === 'start') this.recording = true;
      else if (e.data === 'stop') this.recording = false;
    };
  }

  process(inputs) {
    if (!this.recording) return true;
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // Copia cada canal (o buffer é reutilizado pelo motor, então clonamos).
    const channels = input.map((channel) => channel.slice(0));
    this.port.postMessage({ channels }, channels.map((c) => c.buffer));
    return true;
  }
}

registerProcessor('pcm-recorder', PcmRecorderProcessor);
