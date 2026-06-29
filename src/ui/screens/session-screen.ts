/**
 * Tela de Sessão: monta e reproduz a sequência final.
 *
 * Controles: importar música, ajustar intervalos/duração, volumes independentes
 * (música e voz), transporte (play/pause/parar) e busca clicando/arrastando na
 * timeline. Reverb e detecção 432Hz: próximas etapas.
 */
import type { AudioClip, Project } from '../../core/types';
import { clipStore, mediaStore } from '../../modules/storage/db';
import { saveProject } from '../../modules/project/project-service';
import { computeSchedule, SessionPlayer, type SessionSchedule } from '../../modules/audio/session-engine';
import { showRecording } from '../app';
import { uid } from '../../core/id';

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export async function renderSessionScreen(root: HTMLElement, project: Project): Promise<void> {
  root.innerHTML = `<div class="rec-loading">Carregando sessão…</div>`;

  const clips = new Map<string, AudioClip>();
  for (const cmd of project.commands) {
    if (cmd.recordingId) {
      const clip = await clipStore.get(cmd.recordingId);
      if (clip) clips.set(cmd.recordingId, clip);
    }
  }

  let musicEl: HTMLAudioElement | null = null;
  let musicName = project.music?.name ?? '';
  if (project.music?.recordingId) {
    const blob = await mediaStore.get(project.music.recordingId);
    if (blob) { musicEl = makeAudio(blob); await waitDuration(musicEl); }
  }

  const s = project.settings;
  let schedule: SessionSchedule = computeSchedule(project, clips);
  let player = new SessionPlayer(schedule, clips, musicEl, s);

  root.innerHTML = `
    <section class="rec">
      <button class="btn-link" id="back">‹ Voltar para gravação</button>
      <h2 class="sess-title">🎚️ Montagem da sessão</h2>

      <div class="sess-music">
        <label class="btn btn-project" for="music-file">🎵 ${musicName ? 'Trocar música' : 'Importar música de fundo'}</label>
        <input type="file" accept="audio/*" hidden id="music-file" />
        <span class="sess-music-name">${musicName || 'Nenhuma música'}</span>
      </div>

      <div class="sess-volumes">
        <label>🎵 Volume da música <output id="mv-out">${Math.round(s.musicVolume * 100)}%</output>
          <input type="range" id="mv" min="0" max="100" value="${Math.round(s.musicVolume * 100)}">
        </label>
        <label>🎙️ Volume da voz <output id="vv-out">${Math.round(s.voiceVolume * 100)}%</output>
          <input type="range" id="vv" min="0" max="100" value="${Math.round(s.voiceVolume * 100)}">
        </label>
      </div>

      <div class="sess-controls">
        <label>Intervalo entre comandos
          <span class="sess-stepper" data-key="gapBetweenCommandsSec">
            <button data-d="-1">−</button><b>${s.gapBetweenCommandsSec}s</b><button data-d="1">+</button>
          </span>
        </label>
        <label>Intervalo após o último
          <span class="sess-stepper" data-key="gapAfterLastCommandSec">
            <button data-d="-1">−</button><b>${s.gapAfterLastCommandSec}s</b><button data-d="1">+</button>
          </span>
        </label>
        <label>Duração alvo
          <span class="sess-stepper" data-key="targetDurationMin">
            <button data-d="-5">−</button><b>${Math.round(s.targetDurationSec / 60)} min</b><button data-d="5">+</button>
          </span>
        </label>
      </div>

      <canvas class="sess-timeline" width="600" height="150"></canvas>

      <div class="sess-transport">
        <button class="btn btn-rec" id="play">▶</button>
        <button class="btn btn-nav" id="stop">⏹</button>
        <span class="sess-time"><b id="cur">0:00</b> / <span id="tot">0:00</span></span>
      </div>

      <div class="sess-info"></div>
    </section>
  `;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const canvas = $<HTMLCanvasElement>('.sess-timeline');
  const info = $('.sess-info');
  const btnPlay = $<HTMLButtonElement>('#play');
  const elCur = $('#cur');
  const elTot = $('#tot');

  // --- Navegação ---
  $('#back').onclick = () => { player.dispose(); showRecording(project); };

  // --- Volumes ---
  const mv = $<HTMLInputElement>('#mv');
  const vv = $<HTMLInputElement>('#vv');
  mv.oninput = () => {
    s.musicVolume = Number(mv.value) / 100;
    $('#mv-out').textContent = `${mv.value}%`;
    player.setMusicVolume(s.musicVolume);
  };
  mv.onchange = () => void saveProject(project);
  vv.oninput = () => {
    s.voiceVolume = Number(vv.value) / 100;
    $('#vv-out').textContent = `${vv.value}%`;
    player.setVoiceVolume(s.voiceVolume);
  };
  vv.onchange = () => void saveProject(project);

  // --- Steppers ---
  root.querySelectorAll<HTMLElement>('.sess-stepper').forEach((stepper) => {
    const key = stepper.dataset.key!;
    stepper.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        applyStep(key, Number((b as HTMLButtonElement).dataset.d));
        stepper.querySelector('b')!.textContent = stepperLabel(key);
        player.reset();
        schedule = computeSchedule(project, clips);
        player.updateSchedule(schedule);
        btnPlay.textContent = '▶';
        void saveProject(project);
        redraw(0);
      };
    });
  });

  function stepperLabel(key: string): string {
    switch (key) {
      case 'gapBetweenCommandsSec': return `${s.gapBetweenCommandsSec}s`;
      case 'gapAfterLastCommandSec': return `${s.gapAfterLastCommandSec}s`;
      case 'targetDurationMin': return `${Math.round(s.targetDurationSec / 60)} min`;
      default: return '';
    }
  }
  function applyStep(key: string, d: number) {
    if (key === 'gapBetweenCommandsSec') s.gapBetweenCommandsSec = Math.max(0, s.gapBetweenCommandsSec + d);
    else if (key === 'gapAfterLastCommandSec') s.gapAfterLastCommandSec = Math.max(0, s.gapAfterLastCommandSec + d);
    else if (key === 'targetDurationMin') s.targetDurationSec = Math.max(60, s.targetDurationSec + d * 60);
  }

  // --- Import de música ---
  $<HTMLInputElement>('#music-file').onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    player.dispose();
    const id = project.music?.recordingId ?? uid();
    await mediaStore.save(id, file);
    musicEl = makeAudio(file);
    musicName = file.name;
    await waitDuration(musicEl);
    project.music = { id, name: file.name, recordingId: id, durationSec: musicEl.duration || 0, tuneTo432: false };
    await saveProject(project);
    $('.sess-music-name').textContent = file.name;
    player = new SessionPlayer(schedule, clips, musicEl, s);
    btnPlay.textContent = '▶';
    redraw(0);
  };

  // --- Transporte ---
  player.setCallbacks(
    (sec) => redraw(sec),
    () => { btnPlay.textContent = '▶'; },
  );
  btnPlay.onclick = () => {
    if (schedule.recorded.length === 0) return;
    if (player.isPlaying) { player.pause(); btnPlay.textContent = '▶'; }
    else { player.play(); btnPlay.textContent = '⏸'; }
  };
  $('#stop').onclick = () => { player.reset(); btnPlay.textContent = '▶'; redraw(0); };

  // --- Busca (clicar/arrastar na timeline) ---
  let seeking = false;
  const seekFromEvent = (clientX: number) => {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    player.seek(ratio * schedule.totalSec);
    redraw(ratio * schedule.totalSec);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (schedule.recorded.length === 0) return;
    seeking = true; canvas.setPointerCapture(e.pointerId); seekFromEvent(e.clientX);
  });
  canvas.addEventListener('pointermove', (e) => { if (seeking) seekFromEvent(e.clientX); });
  canvas.addEventListener('pointerup', () => { seeking = false; });

  function redraw(pos: number) {
    drawTimeline(canvas, schedule, musicName, pos);
    elCur.textContent = fmt(pos);
    elTot.textContent = fmt(schedule.totalSec);
    if (schedule.recorded.length === 0) {
      info.innerHTML = `<span class="sess-warn">Nenhum comando gravado ainda. Volte e grave para montar a sessão.</span>`;
    } else {
      info.innerHTML = `${schedule.recorded.length} comandos · ciclo de ${fmt(schedule.cycleSec)} · <strong>${schedule.cycles} repetições</strong> · total <strong>${fmt(schedule.totalSec)}</strong>`;
    }
  }

  redraw(0);
}

function makeAudio(blob: Blob): HTMLAudioElement {
  const el = new Audio(URL.createObjectURL(blob));
  el.preload = 'metadata';
  return el;
}

function waitDuration(el: HTMLAudioElement): Promise<void> {
  return new Promise((resolve) => {
    if (el.readyState >= 1 && isFinite(el.duration)) return resolve();
    el.addEventListener('loadedmetadata', () => resolve(), { once: true });
    setTimeout(resolve, 3000);
  });
}

function drawTimeline(canvas: HTMLCanvasElement, schedule: SessionSchedule, musicName: string, playSec: number) {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const total = schedule.totalSec || 60;
  const pxPerSec = w / total;

  ctx.fillStyle = 'rgba(154,163,178,0.6)';
  ctx.strokeStyle = 'rgba(154,163,178,0.2)';
  ctx.font = '10px system-ui';
  ctx.lineWidth = 1;
  const minuteStep = total > 1800 ? 300 : 60;
  for (let t = 0; t <= total; t += minuteStep) {
    const x = t * pxPerSec;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.fillText(`${Math.round(t / 60)}m`, x + 2, 12);
  }

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

  const musicY = 90, musicH = 40;
  ctx.fillStyle = musicName ? 'rgba(79,208,122,0.18)' : 'rgba(154,163,178,0.08)';
  ctx.fillRect(0, musicY, w, musicH);
  if (musicName) {
    ctx.fillStyle = 'rgba(79,208,122,0.5)';
    ctx.fillRect(0, musicY + 4, w, musicH - 8);
  }
  ctx.fillStyle = 'rgba(232,234,240,0.7)';
  ctx.fillText(musicName ? `🎵 ${musicName} (loop)` : '🎵 Sem música', 4, musicY - 4);

  const x = playSec * pxPerSec;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
}
