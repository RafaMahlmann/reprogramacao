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
import { VoiceEffectChain, DEFAULT_INTENSITY, type StackItem } from './voice-effects';
import { bufferFromClip } from './playback';

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

/** Uma faixa da playlist de fundo. `rate` aplica o ajuste 432 (resample). */
export interface PlaylistTrack {
  url: string;
  durationSec: number;
  rate: number;
}

interface MusicSegment {
  trackIndex: number;
  startSession: number;
  endSession: number;
  rate: number;
}

/**
 * Player de sessão com transporte (play/pause/seek), volumes independentes e
 * PLAYLIST de fundo: as músicas tocam em SEQUÊNCIA (sem loop monótono),
 * preenchendo a duração; se a playlist acabar antes, repete a lista inteira.
 *
 * Cada faixa é um <audio> próprio (streaming, seguro p/ arquivos grandes) com
 * sua própria MediaElementSource. Um "mapa de segmentos" diz qual faixa toca em
 * cada instante da sessão; o avanço entre faixas é feito no evento 'ended'.
 */
export class SessionPlayer {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private voiceGain: GainNode | null = null;
  private voiceFx: VoiceEffectChain | null = null;
  private active = new Set<AudioBufferSourceNode>();

  private musicEls: HTMLAudioElement[] = [];
  private segments: MusicSegment[] = [];
  private curSeg = -1;
  private activeEl: HTMLAudioElement | null = null;

  private schedulerId = 0;
  private rafId = 0;
  private startCtxTime = 0;
  private startPos = 0;
  private positionSec = 0;
  private nextEventIdx = 0;
  private playing = false;

  private schedule: SessionSchedule;
  private readonly clips: Map<string, AudioClip>;
  private readonly tracks: PlaylistTrack[];
  private readonly settings: Project['settings'];

  private onTime?: (sec: number) => void;
  private onEnd?: () => void;

  constructor(
    schedule: SessionSchedule,
    clips: Map<string, AudioClip>,
    tracks: PlaylistTrack[],
    settings: Project['settings'],
  ) {
    this.schedule = schedule;
    this.clips = clips;
    this.tracks = tracks;
    this.settings = settings;
    this.buildSegments();
  }

  get isPlaying(): boolean { return this.playing; }
  get position(): number { return this.playing ? this.elapsed() : this.positionSec; }

  setCallbacks(onTime?: (sec: number) => void, onEnd?: () => void) {
    this.onTime = onTime; this.onEnd = onEnd;
  }

  updateSchedule(s: SessionSchedule) {
    this.schedule = s;
    if (this.positionSec > s.totalSec) this.positionSec = 0;
    this.buildSegments();
  }

  setMusicVolume(v: number) { if (this.musicGain) this.musicGain.gain.value = v; }
  setVoiceVolume(v: number) { if (this.voiceGain) this.voiceGain.gain.value = v; }
  setVoiceStack(stack: StackItem[]) { this.voiceFx?.setStack(stack); }

  private buildSegments() {
    this.segments = [];
    const total = this.schedule.totalSec || 0;
    if (this.tracks.length === 0 || total <= 0) return;
    let t = 0; let i = 0; let guard = 0;
    while (t < total && guard < 100000) {
      const track = this.tracks[i % this.tracks.length];
      const rate = track.rate || 1;
      const segLen = track.durationSec / rate;
      if (!isFinite(segLen) || segLen <= 0) break;
      this.segments.push({ trackIndex: i % this.tracks.length, startSession: t, endSession: t + segLen, rate });
      t += segLen; i++; guard++;
    }
  }

  private ensureGraph() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.voiceGain = ctx.createGain();
    this.voiceGain.gain.value = this.settings.voiceVolume;
    this.voiceFx = new VoiceEffectChain(ctx, ctx.destination);
    this.voiceFx.setStack(this.stackFromSettings());
    this.voiceGain.connect(this.voiceFx.input);

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.settings.musicVolume;
    this.musicGain.connect(ctx.destination);

    this.musicEls = this.tracks.map((t) => {
      const el = new Audio(t.url);
      el.preload = 'auto';
      el.preservesPitch = false;
      (el as unknown as { webkitPreservesPitch?: boolean }).webkitPreservesPitch = false;
      el.playbackRate = t.rate || 1;
      ctx.createMediaElementSource(el).connect(this.musicGain!);
      return el;
    });
  }

  // ---- Sequenciamento da música ----
  private placeMusic(pos: number) {
    if (!this.ctx) return;
    const segIdx = this.segments.findIndex((s) => pos >= s.startSession && pos < s.endSession);
    if (segIdx < 0) { this.activeEl?.pause(); this.activeEl = null; this.curSeg = -1; return; }
    const seg = this.segments[segIdx];
    const el = this.musicEls[seg.trackIndex];
    if (!el) return;
    if (this.activeEl && this.activeEl !== el) this.activeEl.pause();
    this.curSeg = segIdx;
    this.activeEl = el;
    el.playbackRate = seg.rate;
    const off = (pos - seg.startSession) * seg.rate;
    const max = this.tracks[seg.trackIndex].durationSec - 0.05;
    try { el.currentTime = Math.max(0, Math.min(off, max)); } catch { /* metadados ainda carregando */ }
    el.onended = () => this.advanceMusic();
  }

  private startMusic() { if (this.activeEl) void this.activeEl.play().catch(() => {}); }

  private advanceMusic() {
    const next = this.curSeg + 1;
    const seg = this.segments[next];
    if (this.activeEl) this.activeEl.pause();
    if (!seg) { this.activeEl = null; return; }
    this.curSeg = next;
    const el = this.musicEls[seg.trackIndex];
    this.activeEl = el;
    el.playbackRate = seg.rate;
    try { el.currentTime = 0; } catch { /* noop */ }
    el.onended = () => this.advanceMusic();
    if (this.playing) void el.play().catch(() => {});
  }

  private stackFromSettings(): StackItem[] {
    return this.settings.voiceStack.map((id) => ({
      id,
      intensity: this.settings.voiceIntensities[id] ?? DEFAULT_INTENSITY[id] ?? 0.5,
    }));
  }

  private elapsed(): number {
    if (!this.ctx) return this.positionSec;
    return this.startPos + (this.ctx.currentTime - this.startCtxTime);
  }

  /** Toca a partir da posição atual (positionSec). */
  play(): void {
    if (this.playing) return;
    this.ensureGraph();
    const ctx = this.ctx!;
    void ctx.resume();

    this.startPos = this.positionSec;
    this.startCtxTime = ctx.currentTime;

    this.placeMusic(this.startPos);
    this.primeFrom(this.startPos);
    this.playing = true;
    this.startMusic();
    this.startScheduler();
    this.startPlayhead();
  }

  pause(): void {
    if (!this.playing) return;
    this.positionSec = this.elapsed();
    this.haltPlayback();
  }

  /** Move a posição para `sec`. Continua tocando se já estava tocando. */
  seek(sec: number): void {
    const clamped = Math.max(0, Math.min(sec, this.schedule.totalSec));
    this.positionSec = clamped;
    if (this.playing) {
      this.stopActiveSources();
      this.startPos = clamped;
      this.startCtxTime = this.ctx!.currentTime;
      this.primeFrom(clamped);
      this.placeMusic(clamped);
      this.startMusic();
    } else {
      this.placeMusic(clamped);
      this.onTime?.(clamped);
    }
  }

  /** Para e volta para o início. */
  reset(): void {
    this.haltPlayback();
    this.positionSec = 0;
    this.placeMusic(0);
    this.onTime?.(0);
  }

  /** Para tudo e libera o contexto (ao sair da tela). */
  dispose(): void {
    this.haltPlayback();
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close();
    this.ctx = null;
  }

  private haltPlayback() {
    this.playing = false;
    if (this.schedulerId) { clearInterval(this.schedulerId); this.schedulerId = 0; }
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
    this.stopActiveSources();
    this.activeEl?.pause();
  }

  private stopActiveSources() {
    this.active.forEach((s) => { try { s.stop(); } catch { /* já parado */ } s.disconnect(); });
    this.active.clear();
  }

  private startScheduler() {
    const ctx = this.ctx!;
    const LOOKAHEAD = 0.2;
    this.schedulerId = window.setInterval(() => {
      const elapsed = this.elapsed();
      while (
        this.nextEventIdx < this.schedule.events.length &&
        this.schedule.events[this.nextEventIdx].startSec <= elapsed + LOOKAHEAD
      ) {
        this.scheduleEvent(this.schedule.events[this.nextEventIdx], ctx);
        this.nextEventIdx++;
      }
      if (elapsed >= this.schedule.totalSec) {
        this.reset();
        this.onEnd?.();
      }
    }, 25);
  }

  private startPlayhead() {
    const tick = () => {
      if (!this.playing) return;
      this.onTime?.(this.elapsed());
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /**
   * Posiciona o ponteiro de eventos em `pos`. Se `pos` cair NO MEIO de um
   * comando, toca esse comando a partir do offset correto imediatamente, para
   * não haver silêncio até o próximo evento.
   */
  private primeFrom(pos: number) {
    const ctx = this.ctx!;
    const events = this.schedule.events;
    let active = -1;
    for (let i = 0; i < events.length; i++) {
      if (events[i].startSec > pos) break;
      if (pos < events[i].startSec + events[i].durationSec) { active = i; break; }
    }
    if (active >= 0) {
      const ev = events[active];
      const offset = Math.max(0, pos - ev.startSec);
      this.scheduleEvent(ev, ctx, ctx.currentTime, offset);
      this.nextEventIdx = active + 1;
    } else {
      this.nextEventIdx = events.findIndex((e) => e.startSec >= pos);
      if (this.nextEventIdx < 0) this.nextEventIdx = events.length;
    }
  }

  private scheduleEvent(ev: SessionEvent, ctx: AudioContext, atTime?: number, offset = 0) {
    const clip = this.clips.get(ev.recordingId);
    if (!clip) return;
    const buffer = bufferFromClip(ctx, clip);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.voiceGain!);
    const when = atTime ?? this.startCtxTime + (ev.startSec - this.startPos);
    src.start(Math.max(when, ctx.currentTime), offset);
    this.active.add(src);
    src.onended = () => { this.active.delete(src); src.disconnect(); };
  }
}
