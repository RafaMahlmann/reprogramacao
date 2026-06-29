/**
 * Tela de Sessão: monta e reproduz a sequência final.
 *
 * Música: importar do dispositivo/nuvem (seletor do SO), arrastar e soltar,
 * colar URL, biblioteca interna de trilhas 432 Hz, e recentes. Mostra duração/
 * tamanho e avisa se o formato não for suportado.
 *
 * Controles: volumes independentes (música/voz), transporte (play/pause/parar)
 * e busca clicando/arrastando na timeline. Reverb e detecção 432Hz: próximas etapas.
 */
import type { AudioClip, Project } from '../../core/types';
import { clipStore, mediaStore } from '../../modules/storage/db';
import { saveProject } from '../../modules/project/project-service';
import { computeSchedule, SessionPlayer, type SessionSchedule } from '../../modules/audio/session-engine';
import { getRecents, addRecent } from '../../modules/audio/music-recents';
import { VOICE_PRESETS, VoiceEffectChain, DEFAULT_INTENSITY, type StackItem } from '../../modules/audio/voice-effects';
import { bufferFromClip } from '../../modules/audio/playback';
import { detectTuning } from '../../modules/pitch/pitch-detector';
import { showRecording } from '../app';
import { uid } from '../../core/id';

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
function fmtBytes(n: number): string {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`;
}

/** Texto do resultado da detecção de afinação. */
function tuningText(referenceHz: number): string {
  const ref = referenceHz.toFixed(1);
  const cents = 1200 * Math.log2(referenceHz / 432);
  const rounded = Math.round(cents);
  if (rounded === 0) return `🎯 Afinação: ~${ref} Hz — já está em 432 Hz.`;
  const dir = cents > 0 ? 'acima' : 'abaixo';
  return `🎯 Afinação: ~${ref} Hz · ${Math.abs(rounded)} cents ${dir} de 432 Hz. (ajuste para 432: próxima etapa)`;
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

  const s = project.settings;
  let musicEl: HTMLAudioElement | null = null;
  let musicBlob: Blob | null = null;
  let musicName = project.music?.name ?? '';
  let musicSize = 0;
  let musicNote = project.music?.recordingId ? 'Carregando música…' : '';
  let tuningAnalyzing = false;
  let schedule: SessionSchedule = computeSchedule(project, clips);
  let player: SessionPlayer;

  // A música é carregada em SEGUNDO PLANO (pode ser grande) — a tela aparece já.

  root.innerHTML = `
    <section class="rec">
      <button class="btn-link" id="back">‹ Voltar para gravação</button>
      <h2 class="sess-title">🎚️ Montagem da sessão</h2>

      <div id="music-section"></div>

      <div class="sess-volumes">
        <label>🎵 Volume da música <output id="mv-out">${Math.round(s.musicVolume * 100)}%</output>
          <input type="range" id="mv" min="0" max="100" value="${Math.round(s.musicVolume * 100)}">
        </label>
        <label>🎙️ Volume da voz <output id="vv-out">${Math.round(s.voiceVolume * 100)}%</output>
          <input type="range" id="vv" min="0" max="100" value="${Math.round(s.voiceVolume * 100)}">
        </label>
      </div>

      <div id="fx-section"></div>

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

  function currentTuningRate(): number {
    if (project.music?.tuneTo432 && project.music.detectedTuningHz) {
      return 432 / project.music.detectedTuningHz;
    }
    return 1;
  }

  function makePlayer() {
    player = new SessionPlayer(schedule, clips, musicEl, s);
    player.setCallbacks((sec) => { if (!seeking) redraw(sec); }, () => { btnPlay.textContent = '▶'; });
    player.setMusicRate(currentTuningRate());
  }
  makePlayer();

  $('#back').onclick = () => { previewStop?.(); player.dispose(); showRecording(project); };

  // ---- Volumes ----
  const mv = $<HTMLInputElement>('#mv');
  const vv = $<HTMLInputElement>('#vv');
  mv.oninput = () => { s.musicVolume = +mv.value / 100; $('#mv-out').textContent = `${mv.value}%`; player.setMusicVolume(s.musicVolume); };
  mv.onchange = () => void saveProject(project);
  vv.oninput = () => { s.voiceVolume = +vv.value / 100; $('#vv-out').textContent = `${vv.value}%`; player.setVoiceVolume(s.voiceVolume); };
  vv.onchange = () => void saveProject(project);

  // ---- Steppers ----
  root.querySelectorAll<HTMLElement>('.sess-stepper').forEach((stepper) => {
    const key = stepper.dataset.key!;
    stepper.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        applyStep(key, +(b as HTMLButtonElement).dataset.d!);
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
    if (key === 'gapBetweenCommandsSec') return `${s.gapBetweenCommandsSec}s`;
    if (key === 'gapAfterLastCommandSec') return `${s.gapAfterLastCommandSec}s`;
    if (key === 'targetDurationMin') return `${Math.round(s.targetDurationSec / 60)} min`;
    return '';
  }
  function applyStep(key: string, d: number) {
    if (key === 'gapBetweenCommandsSec') s.gapBetweenCommandsSec = Math.max(0, s.gapBetweenCommandsSec + d);
    else if (key === 'gapAfterLastCommandSec') s.gapAfterLastCommandSec = Math.max(0, s.gapAfterLastCommandSec + d);
    else if (key === 'targetDurationMin') s.targetDurationSec = Math.max(60, s.targetDurationSec + d * 60);
  }

  // ---- Efeitos na voz (empilháveis) ----
  function stackItems(): StackItem[] {
    return s.voiceStack.map((id) => ({
      id,
      intensity: s.voiceIntensities[id] ?? DEFAULT_INTENSITY[id] ?? 0.5,
    }));
  }
  function intensityOf(id: string): number {
    return s.voiceIntensities[id] ?? DEFAULT_INTENSITY[id] ?? 0.5;
  }

  function renderFxSection() {
    const fx = $('#fx-section');
    fx.innerHTML = `
      <div class="fx-title">🎛️ Efeitos na voz <span class="fx-hint">(toque para somar; toque de novo para tirar)</span></div>
      <div class="fx-cards">
        <button class="fx-card ${s.voiceStack.length === 0 ? 'is-sel' : ''}" data-fx="none">
          <span class="fx-icon">🎙️</span><span class="fx-name">Natural</span><span class="fx-desc">Sem efeito</span>
        </button>
        ${VOICE_PRESETS.map((p) => {
          const on = s.voiceStack.includes(p.id);
          const order = on ? s.voiceStack.indexOf(p.id) + 1 : 0;
          return `
          <button class="fx-card ${on ? 'is-sel' : ''}" data-fx="${p.id}">
            ${on ? `<span class="fx-badge">${order}</span>` : ''}
            <span class="fx-icon">${p.icon}</span>
            <span class="fx-name">${p.name}</span>
            <span class="fx-desc">${p.desc}</span>
          </button>`;
        }).join('')}
      </div>

      <div class="fx-sliders">
        ${s.voiceStack.map((id) => {
          const p = VOICE_PRESETS.find((x) => x.id === id)!;
          const val = Math.round(intensityOf(id) * 100);
          return `
          <label class="fx-slider-row">
            <span>${p.icon} ${p.name} <output>${val}%</output></span>
            <input type="range" min="0" max="100" value="${val}" data-int="${id}">
          </label>`;
        }).join('') || '<p class="fx-none">Nenhum efeito ativo — voz natural.</p>'}
      </div>

      <div class="fx-ab">
        <span>Comparar no trecho atual:</span>
        <button class="btn fx-ab-btn" id="ab-on">▶ Com efeitos</button>
        <button class="btn fx-ab-btn" id="ab-off">▶ Sem efeitos</button>
      </div>
    `;

    fx.querySelectorAll<HTMLButtonElement>('[data-fx]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.fx!;
        if (id === 'none') {
          s.voiceStack = [];
        } else if (s.voiceStack.includes(id)) {
          s.voiceStack = s.voiceStack.filter((x) => x !== id);
        } else {
          s.voiceStack = [...s.voiceStack, id];
          if (s.voiceIntensities[id] === undefined) s.voiceIntensities[id] = DEFAULT_INTENSITY[id] ?? 0.5;
        }
        player.setVoiceStack(stackItems());
        void saveProject(project);
        renderFxSection();
      };
    });

    fx.querySelectorAll<HTMLInputElement>('[data-int]').forEach((sl) => {
      const id = sl.dataset.int!;
      const out = sl.previousElementSibling?.querySelector('output')
        ?? sl.parentElement!.querySelector('output');
      sl.oninput = () => { s.voiceIntensities[id] = +sl.value / 100; if (out) out.textContent = `${sl.value}%`; };
      sl.onchange = () => { player.setVoiceStack(stackItems()); void saveProject(project); };
    });

    fx.querySelector<HTMLButtonElement>('#ab-on')!.onclick = () => previewTrecho(true);
    fx.querySelector<HTMLButtonElement>('#ab-off')!.onclick = () => previewTrecho(false);
  }

  // A/B: toca o comando no ponto atual da régua, com ou sem efeito
  let previewStop: (() => void) | null = null;
  function previewTrecho(withEffect: boolean) {
    previewStop?.();
    if (player.isPlaying) { player.pause(); btnPlay.textContent = '▶'; }
    const pos = player.position;
    const ev = schedule.events.find((e) => e.startSec <= pos && pos < e.startSec + e.durationSec)
      ?? schedule.events[0];
    if (!ev) return;
    const clip = clips.get(ev.recordingId);
    if (!clip) return;
    const ctx = new AudioContext();
    const src = ctx.createBufferSource();
    src.buffer = bufferFromClip(ctx, clip);
    if (withEffect && s.voiceStack.length > 0) {
      const chain = new VoiceEffectChain(ctx, ctx.destination);
      chain.setStack(stackItems());
      src.connect(chain.input);
    } else {
      src.connect(ctx.destination);
    }
    src.start();
    src.onended = () => { void ctx.close(); previewStop = null; };
    previewStop = () => { try { src.stop(); } catch { /* noop */ } void ctx.close(); previewStop = null; };
  }

  // ---- Aplicar uma música (de qualquer fonte) ----
  // Estratégia para arquivos grandes (até centenas de MB): preparar a
  // reprodução IMEDIATAMENTE (streaming via object URL, sem carregar tudo na
  // memória) e guardar no banco em SEGUNDO PLANO, com aviso se falhar.
  async function applyMusic(blob: Blob, name: string, id: string, isBuiltin = false) {
    player.dispose();
    musicEl = makeAudio(blob);
    musicBlob = blob;
    musicName = name;
    musicSize = blob.size;
    musicNote = 'Lendo duração…';
    renderMusicSection(); // mostra nome + tamanho na hora

    await waitDuration(musicEl);
    const dur = isFinite(musicEl.duration) ? musicEl.duration : 0;
    project.music = { id, name, recordingId: id, durationSec: dur, tuneTo432: false };
    makePlayer();
    btnPlay.textContent = '▶';
    musicNote = blob.size > 80e6 ? 'Guardando no navegador… (pode levar alguns segundos)' : '';
    renderMusicSection();
    redraw(0);

    // Persiste em segundo plano (não trava a UI nem a reprodução)
    void persistMusic(id, blob, name, isBuiltin);
  }

  async function removeMusic() {
    player.dispose();
    const id = project.music?.recordingId;
    if (id) { try { await mediaStore.delete(id); } catch { /* ignore */ } }
    project.music = undefined;
    musicEl = null;
    musicBlob = null;
    musicName = '';
    musicSize = 0;
    musicNote = '';
    makePlayer();
    btnPlay.textContent = '▶';
    await saveProject(project);
    renderMusicSection();
    redraw(0);
  }

  async function persistMusic(id: string, blob: Blob, name: string, isBuiltin: boolean) {
    try {
      if (blob.size > 0) await mediaStore.save(id, blob);
      if (!isBuiltin) addRecent({ id, name });
      musicNote = '';
    } catch (err) {
      console.error('Falha ao guardar música:', err);
      musicNote = '⚠ Música grande demais para guardar permanentemente. Ela funciona agora, mas talvez não reabra depois — considere um arquivo menor ou mais curto.';
    }
    try { await saveProject(project); } catch { /* ignore */ }
    renderMusicSection();
  }

  // ---- Seção de música (reconstruída a cada mudança) ----
  function renderMusicSection() {
    const sec = $('#music-section');
    const dur = musicEl && isFinite(musicEl.duration) ? musicEl.duration : 0;

    sec.innerHTML = `
      <div class="music-drop" id="drop">
        <strong>🎵 Música de fundo</strong>
        <span>Arraste um arquivo aqui, ou <u>busque no dispositivo / nuvem</u></span>
        <input type="file" accept="audio/*" hidden id="music-file" />
      </div>

      <div class="music-url">
        <input type="url" id="url-in" placeholder="Cole um link (URL) de áudio…" />
        <button class="btn btn-project" id="url-go">Importar</button>
      </div>

      ${getRecents().length ? `
      <div class="music-lib">
        <span class="music-lib-title">Recentes</span>
        <div class="music-chips">
          ${getRecents().map((r) =>
            `<button class="music-chip ${project.music?.recordingId === r.id ? 'is-sel' : ''}" data-recent="${r.id}" title="${r.name}">${r.name.length > 22 ? r.name.slice(0, 20) + '…' : r.name}</button>`,
          ).join('')}
        </div>
      </div>` : ''}

      <div class="music-current">
        ${musicName ? `
          <div class="music-current-row">
            <span>🎵 <strong>${musicName}</strong>${dur ? ' · ' + fmt(dur) : ''}${musicSize ? ' · ' + fmtBytes(musicSize) : ''}</span>
            <button class="btn-link" id="music-remove">✕ Remover</button>
          </div>
          ${musicNote ? `<div class="${musicNote.startsWith('⚠') ? 'sess-warn' : 'music-note'}">${musicNote}</div>` : ''}
          ${!musicNote && dur === 0 ? `<div class="sess-warn">⚠ Formato pode não ser suportado pelo navegador. Tente MP3, M4A, WAV ou OGG.</div>` : ''}
          ${musicBlob ? `<div class="tuning-box">
            ${tuningAnalyzing
              ? `<div class="tuning-analyzing">
                   <div class="tuning-eq"><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
                   <span class="tuning-analyzing-label">Analisando afinação…</span>
                 </div>`
              : project.music?.detectedTuningHz
                ? `<div class="music-tuning reveal">${tuningText(project.music.detectedTuningHz)}</div>
                   <label class="tune432 ${project.music.tuneTo432 ? 'is-on' : ''}">
                     <input type="checkbox" id="tune432" ${project.music.tuneTo432 ? 'checked' : ''}>
                     <span class="tune432-track"><span class="tune432-knob"></span></span>
                     <span class="tune432-label">${project.music.tuneTo432 ? '✓ Tocando em 432 Hz' : 'Afinar para 432 Hz'}</span>
                   </label>
                   <button class="btn-link" id="music-redetect">↻ detectar de novo</button>`
                : `<button class="btn btn-detect" id="music-detect">
                     <span class="btn-detect-pulse"></span>🔎 Detectar afinação <span class="btn-detect-432">432?</span>
                   </button>`
            }
          </div>` : ''}
        ` : '<span class="music-none">Nenhuma música escolhida</span>'}
      </div>
    `;

    // Drop zone + clique abre seletor
    const removeBtn = sec.querySelector<HTMLButtonElement>('#music-remove');
    if (removeBtn) removeBtn.onclick = removeMusic;

    async function runDetection() {
      if (!musicBlob || !project.music) return;
      tuningAnalyzing = true;
      renderMusicSection();
      // pequeno atraso para a animação aparecer antes do trabalho pesado
      await new Promise((r) => setTimeout(r, 350));
      try {
        const res = await detectTuning(musicBlob);
        project.music.detectedTuningHz = res.referenceHz;
        await saveProject(project);
        musicNote = res.confidence < 0.25
          ? '⚠ Análise incerta (música muito complexa/percussiva) — resultado aproximado.'
          : '';
      } catch {
        musicNote = '⚠ Não foi possível analisar esta música.';
      }
      tuningAnalyzing = false;
      renderMusicSection();
    }
    const detectBtn = sec.querySelector<HTMLButtonElement>('#music-detect');
    if (detectBtn) detectBtn.onclick = runDetection;
    const redetectBtn = sec.querySelector<HTMLButtonElement>('#music-redetect');
    if (redetectBtn) redetectBtn.onclick = runDetection;

    const tune432 = sec.querySelector<HTMLInputElement>('#tune432');
    if (tune432) tune432.onchange = () => {
      if (!project.music) return;
      project.music.tuneTo432 = tune432.checked;
      player.setMusicRate(currentTuningRate());
      void saveProject(project);
      renderMusicSection();
    };

    const drop = $('#drop');
    const fileInput = $<HTMLInputElement>('#music-file');
    drop.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) void applyMusic(f, f.name, project.music?.recordingId && !project.music.recordingId.startsWith('builtin:') ? project.music.recordingId : uid());
    };
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('drag');
      const f = e.dataTransfer?.files?.[0];
      if (f && f.type.startsWith('audio')) void applyMusic(f, f.name, uid());
      else if (f) alert('Esse arquivo não parece ser áudio.');
    });

    // URL
    const urlIn = $<HTMLInputElement>('#url-in');
    $('#url-go').onclick = async () => {
      const url = urlIn.value.trim();
      if (!url) return;
      const current = $('.music-current');
      current.innerHTML = 'Importando do link…';
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const blob = await resp.blob();
        const name = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'musica');
        await applyMusic(blob, name, uid());
      } catch {
        current.innerHTML = '<span class="sess-warn">⚠ Não foi possível baixar desse link (o site pode bloquear download por CORS). Tente baixar o arquivo e importar do dispositivo.</span>';
      }
    };

    // Recentes
    sec.querySelectorAll<HTMLButtonElement>('[data-recent]').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.recent!;
        const blob = await mediaStore.get(id);
        if (!blob) { alert('Esta música recente não está mais na memória.'); return; }
        await applyMusic(blob, b.title, id, true); // já está em recents, não readiciona
      };
    });
  }

  // ---- Transporte ----
  btnPlay.onclick = () => {
    if (schedule.recorded.length === 0) return;
    if (player.isPlaying) { player.pause(); btnPlay.textContent = '▶'; }
    else { player.play(); btnPlay.textContent = '⏸'; }
  };
  $('#stop').onclick = () => { player.reset(); btnPlay.textContent = '▶'; redraw(0); };

  // ---- Busca na timeline (durante o arraste move só o marcador; busca ao soltar) ----
  let seeking = false;
  let dragPos = 0;
  const posFromX = (clientX: number) => {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * schedule.totalSec;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (schedule.recorded.length === 0) return;
    seeking = true; canvas.setPointerCapture(e.pointerId);
    dragPos = posFromX(e.clientX); redraw(dragPos);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!seeking) return;
    dragPos = posFromX(e.clientX); redraw(dragPos);
  });
  canvas.addEventListener('pointerup', () => {
    if (!seeking) return;
    seeking = false;
    player.seek(dragPos);
    if (!player.isPlaying) { player.play(); btnPlay.textContent = '⏸'; }
  });

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

  renderFxSection();
  renderMusicSection();
  redraw(0);

  // Carrega a música existente em segundo plano (não bloqueia a tela)
  void loadMusicFromStorage();

  async function loadMusicFromStorage() {
    const id = project.music?.recordingId;
    if (!id) return;
    let blob: Blob | undefined;
    try { blob = await mediaStore.get(id); } catch { /* ignore */ }
    if (!blob || blob.size === 0) {
      musicNote = '⚠ A música não está no armazenamento (a importação anterior não foi salva). Importe o arquivo novamente.';
      renderMusicSection();
      return;
    }
    musicEl = makeAudio(blob);
    musicBlob = blob;
    musicName = project.music?.name ?? '';
    musicSize = blob.size;
    renderMusicSection();
    await waitDuration(musicEl);
    musicNote = '';
    makePlayer();
    renderMusicSection();
    redraw(0);
  }
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
    el.addEventListener('error', () => resolve(), { once: true });
    setTimeout(resolve, 20000);
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
