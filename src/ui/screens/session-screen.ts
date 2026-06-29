/**
 * Tela de Sessão: monta a sequência final.
 *
 * - Importa a música de fundo (guardada como Blob, sem decodificar)
 * - Ajusta intervalos entre comandos, intervalo final e duração alvo
 * - Mostra uma timeline simplificada (régua em minutos + trilha de voz + trilha de música)
 * - Toca a sequência montada ao vivo (música em loop + comandos com intervalos)
 *
 * Reverb e detecção de 432 Hz: próximas etapas.
 */
import type { AudioClip, Project } from '../../core/types';
import { clipStore, mediaStore } from '../../modules/storage/db';
import { saveProject } from '../../modules/project/project-service';
import { computeSchedule, SessionPlayer, type SessionSchedule } from '../../modules/audio/session-engine';
import { showRecording } from '../app';
import { uid } from '../../core/id';

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export async function renderSessionScreen(root: HTMLElement, project: Project): Promise<void> {
  root.innerHTML = `<div class="rec-loading">Carregando sessão…</div>`;

  // Carrega clips das gravações
  const clips = new Map<string, AudioClip>();
  for (const cmd of project.commands) {
    if (cmd.recordingId) {
      const clip = await clipStore.get(cmd.recordingId);
      if (clip) clips.set(cmd.recordingId, clip);
    }
  }

  // Carrega música persistida, se houver
  let musicEl: HTMLAudioElement | null = null;
  let musicName = project.music?.name ?? '';
  if (project.music?.recordingId) {
    const blob = await mediaStore.get(project.music.recordingId);
    if (blob) musicEl = makeAudio(blob);
  }

  let player: SessionPlayer | null = null;

  root.innerHTML = `
    <section class="rec">
      <button class="btn-link" id="back">‹ Voltar para gravação</button>
      <h2 class="sess-title">🎚️ Montagem da sessão</h2>

      <div class="sess-music">
        <label class="btn btn-project" for="music-file">🎵 ${musicName ? 'Trocar música' : 'Importar música de fundo'}</label>
        <input type="file" accept="audio/*" hidden id="music-file" />
        <span class="sess-music-name">${musicName || 'Nenhuma música'}</span>
      </div>

      <div class="sess-controls">
        <label>Intervalo entre comandos
          <span class="sess-stepper" data-key="gapBetweenCommandsSec">
            <button data-d="-1">−</button><b>${project.settings.gapBetweenCommandsSec}s</b><button data-d="1">+</button>
          </span>
        </label>
        <label>Intervalo após o último
          <span class="sess-stepper" data-key="gapAfterLastCommandSec">
            <button data-d="-1">−</button><b>${project.settings.gapAfterLastCommandSec}s</b><button data-d="1">+</button>
          </span>
        </label>
        <label>Duração alvo
          <span class="sess-stepper" data-key="targetDurationMin">
            <button data-d="-5">−</button><b>${Math.round(project.settings.targetDurationSec / 60)} min</b><button data-d="5">+</button>
          </span>
        </label>
        <label>Volume da música
          <span class="sess-stepper" data-key="musicVolumePct">
            <button data-d="-10">−</button><b>${Math.round(project.settings.musicVolume * 100)}%</b><button data-d="10">+</button>
          </span>
        </label>
      </div>

      <canvas class="sess-timeline" width="600" height="150"></canvas>
      <div class="sess-info"></div>

      <div class="sess-play">
        <button class="btn btn-rec" id="sess-play">▶ Ouvir sequência</button>
      </div>
    </section>
  `;

  root.querySelector<HTMLButtonElement>('#back')!.onclick = () => {
    player?.stop();
    showRecording(project);
  };

  // --- Import de música ---
  root.querySelector<HTMLInputElement>('#music-file')!.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const id = project.music?.recordingId ?? uid();
    await mediaStore.save(id, file);
    musicEl = makeAudio(file);
    musicName = file.name;
    await waitDuration(musicEl);
    project.music = {
      id,
      name: file.name,
      recordingId: id,
      durationSec: musicEl.duration || 0,
      tuneTo432: false,
    };
    await saveProject(project);
    root.querySelector<HTMLElement>('.sess-music-name')!.textContent = file.name;
    redraw();
  };

  // --- Steppers ---
  root.querySelectorAll<HTMLElement>('.sess-stepper').forEach((stepper) => {
    const key = stepper.dataset.key!;
    stepper.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        const d = Number((b as HTMLButtonElement).dataset.d);
        applyStep(key, d);
        stepper.querySelector('b')!.textContent = stepperLabel(key);
        void saveProject(project);
        redraw();
      };
    });
  });

  function stepperLabel(key: string): string {
    const s = project.settings;
    switch (key) {
      case 'gapBetweenCommandsSec': return `${s.gapBetweenCommandsSec}s`;
      case 'gapAfterLastCommandSec': return `${s.gapAfterLastCommandSec}s`;
      case 'targetDurationMin': return `${Math.round(s.targetDurationSec / 60)} min`;
      case 'musicVolumePct': return `${Math.round(s.musicVolume * 100)}%`;
      default: return '';
    }
  }

  function applyStep(key: string, d: number) {
    const s = project.settings;
    if (key === 'gapBetweenCommandsSec') s.gapBetweenCommandsSec = Math.max(0, s.gapBetweenCommandsSec + d);
    else if (key === 'gapAfterLastCommandSec') s.gapAfterLastCommandSec = Math.max(0, s.gapAfterLastCommandSec + d);
    else if (key === 'targetDurationMin') s.targetDurationSec = Math.max(60, s.targetDurationSec + d * 60);
    else if (key === 'musicVolumePct') s.musicVolume = Math.min(1, Math.max(0, s.musicVolume + d / 100));
  }

  // --- Timeline ---
  const canvas = root.querySelector<HTMLCanvasElement>('.sess-timeline')!;
  const info = root.querySelector<HTMLElement>('.sess-info')!;
  let schedule: SessionSchedule = computeSchedule(project, clips);

  function redraw() {
    schedule = computeSchedule(project, clips);
    drawTimeline(canvas, schedule, musicName, 0);
    if (schedule.recorded.length === 0) {
      info.innerHTML = `<span class="sess-warn">Nenhum comando gravado ainda. Volte e grave para montar a sessão.</span>`;
    } else {
      info.innerHTML = `
        ${schedule.recorded.length} comandos · ciclo de ${fmt(schedule.cycleSec)} ·
        <strong>${schedule.cycles} repetições</strong> ·
        total <strong>${fmt(schedule.totalSec)}</strong>`;
    }
  }

  // --- Play ---
  const btnPlay = root.querySelector<HTMLButtonElement>('#sess-play')!;
  btnPlay.onclick = () => {
    if (player?.isPlaying) {
      player.stop();
      btnPlay.textContent = '▶ Ouvir sequência';
      return;
    }
    if (schedule.recorded.length === 0) return;
    player = new SessionPlayer(schedule, clips, musicEl, project.settings);
    btnPlay.textContent = '■ Parar';
    player.play(
      (sec) => drawTimeline(canvas, schedule, musicName, sec),
      () => { btnPlay.textContent = '▶ Ouvir sequência'; },
    );
  };

  redraw();
}

// ---- Helpers de áudio ----
function makeAudio(blob: Blob): HTMLAudioElement {
  const el = new Audio(URL.createObjectURL(blob));
  el.preload = 'metadata';
  return el;
}

function waitDuration(el: HTMLAudioElement): Promise<void> {
  return new Promise((resolve) => {
    if (el.readyState >= 1 && isFinite(el.duration)) return resolve();
    el.addEventListener('loadedmetadata', () => resolve(), { once: true });
    setTimeout(resolve, 3000); // fallback
  });
}

// ---- Desenho da timeline ----
function drawTimeline(canvas: HTMLCanvasElement, schedule: SessionSchedule, musicName: string, playSec: number) {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const total = schedule.totalSec || 60;
  const pxPerSec = w / total;

  // Régua (a cada minuto)
  ctx.fillStyle = 'rgba(154,163,178,0.6)';
  ctx.strokeStyle = 'rgba(154,163,178,0.2)';
  ctx.font = '10px system-ui';
  ctx.lineWidth = 1;
  const minuteStep = total > 1800 ? 300 : 60; // marca a cada 5min se for longo
  for (let t = 0; t <= total; t += minuteStep) {
    const x = t * pxPerSec;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.fillText(`${Math.round(t / 60)}m`, x + 2, 12);
  }

  // Trilha de voz (lane superior)
  const voiceY = 28, voiceH = 40;
  ctx.fillStyle = 'rgba(108,140,255,0.12)';
  ctx.fillRect(0, voiceY, w, voiceH);
  const palette = ['#6c8cff', '#7a9cff', '#5b7cff'];
  schedule.events.forEach((ev) => {
    const x = ev.startSec * pxPerSec;
    const bw = Math.max(1, ev.durationSec * pxPerSec);
    ctx.fillStyle = palette[ev.commandIndex % palette.length];
    ctx.fillRect(x, voiceY + 4, bw, voiceH - 8);
  });
  ctx.fillStyle = 'rgba(232,234,240,0.7)';
  ctx.fillText('🎙️ Voz (comandos em loop)', 4, voiceY - 4);

  // Trilha de música (lane inferior)
  const musicY = 90, musicH = 40;
  ctx.fillStyle = musicName ? 'rgba(79,208,122,0.18)' : 'rgba(154,163,178,0.08)';
  ctx.fillRect(0, musicY, w, musicH);
  if (musicName) {
    ctx.fillStyle = 'rgba(79,208,122,0.5)';
    ctx.fillRect(0, musicY + 4, w, musicH - 8);
  }
  ctx.fillStyle = 'rgba(232,234,240,0.7)';
  ctx.fillText(musicName ? `🎵 ${musicName} (loop)` : '🎵 Sem música', 4, musicY - 4);

  // Playhead
  if (playSec > 0) {
    const x = playSec * pxPerSec;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
}
