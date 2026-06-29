/**
 * Modelo de domínio do Reprogramação.
 *
 * Todos os tipos compartilhados entre os módulos ficam aqui, num único lugar,
 * para evitar duplicação e manter a nomenclatura consistente (ver docs/ARCHITECTURE.md).
 */

/** Um comando de voz: o texto (roteiro) + a gravação associada. */
export interface VoiceCommand {
  id: string;
  /** Posição na sequência de reprodução (0..n). */
  order: number;
  /** Texto exibido no teleprompter; editável antes de gravar. */
  text: string;
  /** Chave da gravação no armazenamento de áudio (IndexedDB). Ausente = ainda não gravado. */
  recordingId?: string;
  /** Duração da gravação em segundos. */
  durationSec?: number;
  recordedAt?: number;
}

/** Música de fundo importada pelo usuário. */
export interface MusicTrack {
  id: string;
  name: string;
  recordingId: string;
  durationSec: number;
  /** Afinação predominante detectada, ex.: "Lá menor". */
  detectedKey?: string;
  /** Frequência de referência detectada (Hz), tipicamente perto de 440. */
  detectedTuningHz?: number;
  /** Se o usuário optou por ajustar a música para 432 Hz na reprodução/exportação. */
  tuneTo432: boolean;
}

/** Configurações que afetam fidelidade e reprodução. */
export interface ProjectSettings {
  /** Taxa de amostragem alvo. Padrão 48000. */
  sampleRate: number;
  /** Profundidade de bits para export sem perdas. Padrão 24. */
  bitDepth: number;
  /** Intervalo (s) entre o fim de um comando e o início do próximo. */
  gapBetweenCommandsSec: number;
  /** Intervalo (s) após o último comando antes de reiniciar a sequência. */
  gapAfterLastCommandSec: number;
  /** Duração alvo da sessão em segundos (padrão 3600 = 1h). */
  targetDurationSec: number;
  /** Volume da música de fundo (0..1). */
  musicVolume: number;
  /** Fade in/out da música em segundos. */
  fadeInSec: number;
  fadeOutSec: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  commands: VoiceCommand[];
  music?: MusicTrack;
  settings: ProjectSettings;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  sampleRate: 48000,
  bitDepth: 24,
  gapBetweenCommandsSec: 2,
  gapAfterLastCommandSec: 5,
  targetDurationSec: 3600,
  musicVolume: 0.5,
  fadeInSec: 3,
  fadeOutSec: 5,
};

/** Áudio em memória, sempre em Float32 (sem perdas) para preservar fidelidade. */
export interface AudioClip {
  /** Canais de PCM Float32 (mono = 1, estéreo = 2). */
  channels: Float32Array[];
  sampleRate: number;
  durationSec: number;
}
