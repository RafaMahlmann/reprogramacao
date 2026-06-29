/**
 * Motor da sessão: monta e reproduz a sequência completa.
 *
 * Regras (definidas com o usuário):
 *  - A sequência INTEIRA repete: comando 1..N com intervalos entre eles,
 *    intervalo final, e recomeça do 1 — ciclos inteiros até fechar a duração alvo.
 *  - A música de fundo toca em LOOP contínuo até o fim da sessão.
 *
 * Reprodução ao vivo:
 *  - Música via <audio loop> + MediaElementSource (streaming, seguro p/ 1h+).
 *  - Voz via AudioBufferSourceNode agendada com um lookahead scheduler
 *    (relógio do AudioContext — nada de setTimeout para o áudio em si).
 */
import type { AudioClip, Project } from '../../core/types';

export interface SessionEvent {
  startSec: number;
  recordingId: string;
  commandIndex: number;
  durationSec: number;
}

export interface SessionSchedule {
  /** Duração de um ciclo completo (todos os comandos + intervalos + intervalo final). */
  cycleSec: number;
  /** Número de ciclos inteiros que cabem na duração alvo. */
  cycles: number;
  /** Duração total da sessão (ciclos inteiros). */
  totalSec: number;
  /** Todos os disparos de voz, em ordem. */
  events: SessionEvent[];
  /** Comandos efetivamente gravados (na ordem do projeto). */
  recorded: { index: number; recordingId: string; durationSec: number }[];
}

export function computeSchedule(project: Project, clips: Map<string, AudioClip>): SessionSchedule {
  const { gapBetweenCommandsSec, gapAfterLastCommandSec, targetDurationSec } = project.settings;

  const recorded = project.commands
    .map((cmd, index) => ({
      index,
      recordingId: cmd.recordingId ?? '',
      durationSec: cmd.recordingId ? clips.get(cmd.recordingId)?.durationSec ?? 0 : 0,
    }))
    .filter((r) => r.recordingId && clips.has(r.recordingId) && r.durationSec > 0);

  if (recorded.length === 0) {
    return { cycleSec: 0, cycles: 0, totalSec: 0, events: [], recorded: [] };
  }

  const sumDur = recorded.reduce((s, r) => s + r.durationSec, 0);
  const cycleSec =
    sumDur + gapBetweenCommandsSec * (recorded.length - 1) + gapAfterLastCommandSec;

  const cycles = Math.max(1, Math.floor(targetDurationSec / cycleSec));
  const totalSec = cycles * cycleSec;

  const events: SessionEvent[] = [];
  for (let c = 0; c < cycles; c++) {
    let offset = c * cycleSec;
    recorded.forEach((r, i) => {
      events.push({
        startSec: offset,
        recordingId: r.recordingId,
        commandIndex: r.index,
        durationSec: r.durationSec,
      });
      offset += r.durationSec + (i < recorded.length - 1 ? gapBetweenCommandsSec : 0);
    });
  }

  return { cycleSec, cycles, totalSec, events, recorded };
}

export class SessionPlayer {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private musicSource: MediaElementAudioSourceNode | null = null;
  private schedulerId = 0;
  private startTime = 0;
  private nextEventIdx = 0;
  private rafId = 0;

  private readonly schedule: SessionSchedule;
  private readonly clips: Map<string, AudioClip>;
  private readonly musicEl: HTMLAudioElement | null;
  private readonly settings: Project['settings'];

  constructor(
    schedule: SessionSchedule,
    clips: Map<string, AudioClip>,
    musicEl: HTMLAudioElement | null,
    settings: Project['settings'],
  ) {
    this.schedule = schedule;
    this.clips = clips;
    this.musicEl = musicEl;
    this.settings = settings;
  }

  get isPlaying(): boolean {
    return this.ctx !== null;
  }

  /** Inicia a reprodução. onTime recebe o segundo atual; onEnd ao terminar. */
  play(onTime?: (sec: number) => void, onEnd?: () => void): void {
    this.ctx = new AudioContext();
    const ctx = this.ctx;

    // Música em loop com fade in/out
    if (this.musicEl) {
      this.musicEl.loop = true;
      this.musicEl.currentTime = 0;
      this.musicSource = ctx.createMediaElementSource(this.musicEl);
      this.musicGain = ctx.createGain();
      this.musicSource.connect(this.musicGain).connect(ctx.destination);

      const vol = this.settings.musicVolume;
      const fadeIn = this.settings.fadeInSec;
      const fadeOut = this.settings.fadeOutSec;
      const total = this.schedule.totalSec;
      const now = ctx.currentTime;
      this.musicGain.gain.setValueAtTime(0.0001, now);
      this.musicGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), now + Math.max(0.1, fadeIn));
      this.musicGain.gain.setValueAtTime(vol, now + Math.max(0, total - fadeOut));
      this.musicGain.gain.exponentialRampToValueAtTime(0.0001, now + total);
      void this.musicEl.play();
    }

    this.startTime = ctx.currentTime;
    this.nextEventIdx = 0;

    // Lookahead scheduler (25ms tick, 200ms de antecipação)
    const LOOKAHEAD = 0.2;
    this.schedulerId = window.setInterval(() => {
      const elapsed = ctx.currentTime - this.startTime;
      while (
        this.nextEventIdx < this.schedule.events.length &&
        this.schedule.events[this.nextEventIdx].startSec <= elapsed + LOOKAHEAD
      ) {
        this.scheduleEvent(this.schedule.events[this.nextEventIdx], ctx);
        this.nextEventIdx++;
      }
      if (elapsed >= this.schedule.totalSec) {
        this.stop();
        onEnd?.();
      }
    }, 25);

    // Playhead (para a UI)
    const tick = () => {
      if (!this.ctx) return;
      onTime?.(this.ctx.currentTime - this.startTime);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private scheduleEvent(ev: SessionEvent, ctx: AudioContext) {
    const clip = this.clips.get(ev.recordingId);
    if (!clip) return;
    const buffer = ctx.createBuffer(clip.channels.length, clip.channels[0].length, clip.sampleRate);
    clip.channels.forEach((data, ch) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, ch));
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const when = this.startTime + ev.startSec;
    src.start(Math.max(when, ctx.currentTime));
  }

  stop(): void {
    if (this.schedulerId) { clearInterval(this.schedulerId); this.schedulerId = 0; }
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
    if (this.musicEl) { this.musicEl.pause(); }
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close();
    this.ctx = null;
    this.musicGain = null;
    this.musicSource = null;
  }
}
