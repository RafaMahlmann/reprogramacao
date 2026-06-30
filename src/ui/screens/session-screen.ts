/**
 * Tela de Sessão: monta e reproduz a sequência final.
 *
 * Música: PLAYLIST de fundo — várias faixas tocadas em sequência (sem loop
 * monótono), preenchendo a duração. Cada faixa pode ser detectada/afinada em
 * 432. Importar do dispositivo/nuvem, arrastar, colar URL.
 *
 * Controles: volumes independentes (música/voz), efeitos de voz empilháveis,
 * transporte (play/pause/parar), busca na timeline, exportação MP3/WAV.
 */
import type { AudioClip, Project } from '../../core/types';
import { clipStore, mediaStore } from '../../modules/storage/db';
import { saveProject } from '../../modules/project/project-service';
import { computeSchedule, SessionPlayer, type SessionSchedule, type PlaylistTrack } from '../../modules/audio/session-engine';
import { VOICE_PRESETS, VoiceEffectChain, DEFAULT_INTENSITY, type StackItem } from '../../modules/audio/voice-effects';
import { bufferFromClip } from '../../modules/audio/playback';
import { detectTuning } from '../../modules/pitch/pitch-detector';
import { exportSession, type ExportFormat } from '../../modules/export/exporter';
import { downloadBlob } from '../../modules/export/download';
import { showRecording, getUserName } from '../app';
import { uid } from '../../core/id';

interface TrackUI {
  id: string;
  name: string;
  blob: Blob;
  url: string;
  durationSec: number;
  detectedTuningHz?: number;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
function tuningText(hz: number): string {
  const cents = Math.round(1200 * Math.log2(hz / 432));
  if (cents === 0) return `432 Hz ✓`;
  return `~${hz.toFixed(1)} Hz (${cents > 0 ? '+' : ''}${cents} cents de 432)`;
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
  const playlist: TrackUI[] = [];
  let tune432 = (project.musicList ?? []).some((t) => t.tuneTo432);
  const detecting = new Set<string>();
  let schedule: SessionSchedule = computeSchedule(project, clips);
  let player!: SessionPlayer;
  let seeking = false;

  function rateOf(t: TrackUI): number {
    return tune432 && t.detectedTuningHz ? 432 / t.detectedTuningHz : 1;
  }
  function playlistForPlayer(): PlaylistTrack[] {
    return playlist.map((t) => ({ url: t.url, durationSec: t.durationSec, rate: rateOf(t) }));
  }
  function musicTotalSec(): number {
    return playlist.reduce((sum, t) => sum + t.durationSec / rateOf(t), 0);
  }

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
        <label>Duração alvo (min)
          <input class="sess-num" type="number" id="target-min" min="1" max="720" step="0.1" value="${(s.targetDurationSec / 60).toFixed(1)}">
        </label>
      </div>

      <canvas class="sess-timeline" width="600" height="150"></canvas>

      <div class="sess-transport">
        <button class="btn btn-rec" id="play">▶</button>
        <button class="btn btn-nav" id="stop">⏹</button>
        <span class="sess-time"><b id="cur">0:00</b> / <span id="tot">0:00</span></span>
      </div>

      <div class="sess-info"></div>
      <div id="export-section"></div>
    </section>
  `;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const canvas = $<HTMLCanvasElement>('.sess-timeline');
  const info = $('.sess-info');
  const btnPlay = $<HTMLButtonElement>('#play');
  const elCur = $('#cur');
  const elTot = $('#tot');

  function makePlayer() {
    player?.dispose();
    player = new SessionPlayer(schedule, clips, playlistForPlayer(), s);
    player.setCallbacks((sec) => { if (!seeking) redraw(sec); }, () => { btnPlay.textContent = '▶'; });
  }
  makePlayer();

  $('#back').onclick = () => { player.dispose(); playlist.forEach((t) => URL.revokeObjectURL(t.url)); showRecording(project); };

  // ---- Volumes ----
  const mv = $<HTMLInputElement>('#mv');
  const vv = $<HTMLInputElement>('#vv');
  mv.oninput = () => { s.musicVolume = +mv.value / 100; $('#mv-out').textContent = `${mv.value}%`; player.setMusicVolume(s.musicVolume); };
  mv.onchange = () => void saveProject(project);
  vv.oninput = () => { s.voiceVolume = +vv.value / 100; $('#vv-out').textContent = `${vv.value}%`; player.setVoiceVolume(s.voiceVolume); };
  vv.onchange = () => void saveProject(project);

  // ---- Steppers + duração ----
  root.querySelectorAll<HTMLElement>('.sess-stepper').forEach((stepper) => {
    const key = stepper.dataset.key!;
    stepper.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        const d = +(b as HTMLButtonElement).dataset.d!;
        if (key === 'gapBetweenCommandsSec') s.gapBetweenCommandsSec = Math.max(0, s.gapBetweenCommandsSec + d);
        else if (key === 'gapAfterLastCommandSec') s.gapAfterLastCommandSec = Math.max(0, s.gapAfterLastCommandSec + d);
        stepper.querySelector('b')!.textContent = key === 'gapBetweenCommandsSec' ? `${s.gapBetweenCommandsSec}s` : `${s.gapAfterLastCommandSec}s`;
        rebuildSchedule();
      };
    });
  });
  const targetIn = $<HTMLInputElement>('#target-min');
  targetIn.onchange = () => {
    const mins = Math.max(1, Math.min(720, Number(targetIn.value) || 1));
    s.targetDurationSec = mins * 60;
    targetIn.value = mins.toFixed(1);
    rebuildSchedule();
  };
  function rebuildSchedule() {
    player.reset();
    schedule = computeSchedule(project, clips);
    player.updateSchedule(schedule);
    btnPlay.textContent = '▶';
    void saveProject(project);
    redraw(0);
    renderExportSection();
  }

  // ---- Voz: efeitos (empilháveis) ----
  function stackItems(): StackItem[] {
    return s.voiceStack.map((id) => ({ id, intensity: s.voiceIntensities[id] ?? DEFAULT_INTENSITY[id] ?? 0.5 }));
  }
  function intensityOf(id: string): number { return s.voiceIntensities[id] ?? DEFAULT_INTENSITY[id] ?? 0.5; }

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
          return `<button class="fx-card ${on ? 'is-sel' : ''}" data-fx="${p.id}">
            ${on ? `<span class="fx-badge">${order}</span>` : ''}
            <span class="fx-icon">${p.icon}</span><span class="fx-name">${p.name}</span><span class="fx-desc">${p.desc}</span>
          </button>`;
        }).join('')}
      </div>
      <div class="fx-sliders">
        ${s.voiceStack.map((id) => {
          const p = VOICE_PRESETS.find((x) => x.id === id)!;
          const val = Math.round(intensityOf(id) * 100);
          return `<label class="fx-slider-row"><span>${p.icon} ${p.name} <output>${val}%</output></span>
            <input type="range" min="0" max="100" value="${val}" data-int="${id}"></label>`;
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
        if (id === 'none') s.voiceStack = [];
        else if (s.voiceStack.includes(id)) s.voiceStack = s.voiceStack.filter((x) => x !== id);
        else { s.voiceStack = [...s.voiceStack, id]; if (s.voiceIntensities[id] === undefined) s.voiceIntensities[id] = DEFAULT_INTENSITY[id] ?? 0.5; }
        player.setVoiceStack(stackItems());
        void saveProject(project);
        renderFxSection();
      };
    });
    fx.querySelectorAll<HTMLInputElement>('[data-int]').forEach((sl) => {
      const id = sl.dataset.int!;
      const out = sl.parentElement!.querySelector('output');
      sl.oninput = () => { s.voiceIntensities[id] = +sl.value / 100; if (out) out.textContent = `${sl.value}%`; };
      sl.onchange = () => { player.setVoiceStack(stackItems()); void saveProject(project); };
    });
    fx.querySelector<HTMLButtonElement>('#ab-on')!.onclick = () => previewTrecho(true);
    fx.querySelector<HTMLButtonElement>('#ab-off')!.onclick = () => previewTrecho(false);
  }

  let previewStop: (() => void) | null = null;
  function previewTrecho(withEffect: boolean) {
    previewStop?.();
    if (player.isPlaying) { player.pause(); btnPlay.textContent = '▶'; }
    const pos = player.position;
    const ev = schedule.events.find((e) => e.startSec <= pos && pos < e.startSec + e.durationSec) ?? schedule.events[0];
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
    } else { src.connect(ctx.destination); }
    src.start();
    src.onended = () => { void ctx.close(); previewStop = null; };
    previewStop = () => { try { src.stop(); } catch { /* noop */ } void ctx.close(); previewStop = null; };
  }

  // ---- Playlist de música ----
  function probeDuration(url: string): Promise<number> {
    return new Promise((resolve) => {
      const a = new Audio(url);
      a.preload = 'metadata';
      const done = () => resolve(isFinite(a.duration) ? a.duration : 0);
      a.addEventListener('loadedmetadata', done, { once: true });
      a.addEventListener('error', () => resolve(0), { once: true });
      setTimeout(() => resolve(isFinite(a.duration) ? a.duration : 0), 20000);
    });
  }

  function persistPlaylist() {
    project.musicList = playlist.map((t) => ({
      id: t.id, name: t.name, recordingId: t.id, durationSec: t.durationSec,
      detectedTuningHz: t.detectedTuningHz, tuneTo432: tune432,
    }));
    project.music = undefined;
    void saveProject(project);
  }

  async function addTrack(blob: Blob, name: string) {
    const id = uid();
    const url = URL.createObjectURL(blob);
    const tr: TrackUI = { id, name, blob, url, durationSec: 0 };
    playlist.push(tr);
    renderMusicSection();
    tr.durationSec = await probeDuration(url);
    persistPlaylist();
    makePlayer();
    renderMusicSection();
    redraw(0);
    renderExportSection();
    void mediaStore.save(id, blob).catch(() => {});
    void detectTrack(tr);
  }

  async function detectTrack(tr: TrackUI) {
    detecting.add(tr.id);
    renderMusicSection();
    try {
      const res = await detectTuning(tr.blob);
      tr.detectedTuningHz = res.referenceHz;
      persistPlaylist();
      if (tune432) makePlayer();
    } catch { /* ignora */ }
    detecting.delete(tr.id);
    renderMusicSection();
  }

  function removeTrack(id: string) {
    const i = playlist.findIndex((t) => t.id === id);
    if (i < 0) return;
    URL.revokeObjectURL(playlist[i].url);
    void mediaStore.delete(id);
    playlist.splice(i, 1);
    persistPlaylist();
    makePlayer();
    renderMusicSection();
    redraw(0);
    renderExportSection();
  }

  function moveTrack(id: string, dir: -1 | 1) {
    const i = playlist.findIndex((t) => t.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= playlist.length) return;
    [playlist[i], playlist[j]] = [playlist[j], playlist[i]];
    persistPlaylist();
    makePlayer();
    renderMusicSection();
    redraw(0);
  }

  function renderMusicSection() {
    const sec = $('#music-section');
    const musTotal = musicTotalSec();
    sec.innerHTML = `
      <div class="music-drop" id="drop">
        <strong>🎵 Músicas de fundo (playlist)</strong>
        <span>Arraste arquivos aqui, ou <u>busque no dispositivo / nuvem</u></span>
        <input type="file" accept="audio/*" multiple hidden id="music-file" />
      </div>
      <div class="music-url">
        <input type="url" id="url-in" placeholder="Cole um link (URL) de áudio…" />
        <button class="btn btn-project" id="url-go">Importar</button>
      </div>

      ${playlist.length ? `
      <div class="playlist">
        ${playlist.map((t, i) => `
          <div class="pl-row">
            <span class="pl-idx">${i + 1}</span>
            <div class="pl-info">
              <span class="pl-name">${t.name}</span>
              <span class="pl-meta">${t.durationSec ? fmt(t.durationSec) : '…'}${detecting.has(t.id) ? ' · 🔎 analisando…' : t.detectedTuningHz ? ' · ' + tuningText(t.detectedTuningHz) : ''}</span>
            </div>
            <div class="pl-actions">
              <button class="pl-btn" data-up="${t.id}" ${i === 0 ? 'disabled' : ''}>▲</button>
              <button class="pl-btn" data-down="${t.id}" ${i === playlist.length - 1 ? 'disabled' : ''}>▼</button>
              <button class="pl-btn pl-del" data-del="${t.id}">✕</button>
            </div>
          </div>`).join('')}
      </div>
      <label class="tune432 ${tune432 ? 'is-on' : ''}">
        <input type="checkbox" id="tune432" ${tune432 ? 'checked' : ''}>
        <span class="tune432-track"><span class="tune432-knob"></span></span>
        <span class="tune432-label">${tune432 ? '✓ Tudo em 432 Hz' : 'Afinar tudo para 432 Hz'}</span>
      </label>
      <p class="music-note">Total de música: ${fmt(musTotal)} ${musTotal < schedule.totalSec ? `(menor que a sessão de ${fmt(schedule.totalSec)} — a playlist repete para preencher; adicione mais músicas para variar até o fim)` : '(cobre a sessão toda com variação)'}</p>
      ` : '<p class="music-none">Nenhuma música ainda. Adicione uma ou várias para o fundo.</p>'}
    `;

    const drop = $('#drop');
    const fileInput = $<HTMLInputElement>('#music-file');
    drop.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files) for (const f of Array.from(files)) void addTrack(f, f.name);
    };
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('drag');
      const files = e.dataTransfer?.files;
      if (files) for (const f of Array.from(files)) if (f.type.startsWith('audio')) void addTrack(f, f.name);
    });

    const urlIn = $<HTMLInputElement>('#url-in');
    $('#url-go').onclick = async () => {
      const url = urlIn.value.trim();
      if (!url) return;
      const btn = $('#url-go'); btn.textContent = 'Importando…';
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const blob = await resp.blob();
        const name = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'musica');
        await addTrack(blob, name);
        urlIn.value = '';
      } catch {
        alert('Não foi possível baixar desse link (o site pode bloquear por CORS). Baixe o arquivo e importe do dispositivo.');
      } finally { btn.textContent = 'Importar'; }
    };

    sec.querySelectorAll<HTMLButtonElement>('[data-up]').forEach((b) => b.onclick = () => moveTrack(b.dataset.up!, -1));
    sec.querySelectorAll<HTMLButtonElement>('[data-down]').forEach((b) => b.onclick = () => moveTrack(b.dataset.down!, 1));
    sec.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => b.onclick = () => removeTrack(b.dataset.del!));
    const tn = sec.querySelector<HTMLInputElement>('#tune432');
    if (tn) tn.onchange = () => {
      tune432 = tn.checked;
      persistPlaylist();
      makePlayer();
      renderMusicSection();
      redraw(0);
    };
  }

  // ---- Exportação ----
  async function decodeTrackCapped(t: TrackUI): Promise<AudioBuffer> {
    const CAP = 720;
    const sizes: number[] = [];
    if (isFinite(t.durationSec) && t.durationSec > CAP && t.durationSec > 0) {
      sizes.push(Math.ceil(t.blob.size * Math.min(1, (CAP + 20) / t.durationSec)), Math.ceil(t.blob.size * Math.min(1, (CAP / 2) / t.durationSec)));
    } else { sizes.push(t.blob.size, Math.ceil(t.blob.size * 0.5)); }
    let lastErr: unknown;
    for (const sz of sizes) {
      try {
        const arr = await t.blob.slice(0, sz).arrayBuffer();
        const dctx = new OfflineAudioContext(2, 1, s.sampleRate);
        return await dctx.decodeAudioData(arr);
      } catch (e) { lastErr = e; }
    }
    throw lastErr ?? new Error('decode falhou');
  }

  function renderExportSection() {
    const ex = $('#export-section');
    const ready = schedule.recorded.length > 0;
    ex.innerHTML = `
      <div class="export-title2">📤 Exportar sessão</div>
      ${ready ? `
        <p class="export-sub">Arquivo único: voz + efeitos + playlist + 432 + intervalos. Duração: <strong>${fmt(schedule.totalSec)}</strong>.</p>
        <div class="export-buttons">
          <button class="btn btn-export" id="exp-mp3">⬇ MP3 320k</button>
          <button class="btn btn-export-2" id="exp-wav">⬇ WAV 24-bit</button>
        </div>
        <div class="export-progress" id="exp-progress" style="display:none">
          <div class="export-bar"><div class="export-bar-fill" id="exp-fill"></div></div>
          <span id="exp-status"></span>
        </div>
      ` : `<p class="fx-none">Grave os comandos antes de exportar.</p>`}
    `;
    if (!ready) return;
    ex.querySelector<HTMLButtonElement>('#exp-mp3')!.onclick = () => runExport('mp3');
    ex.querySelector<HTMLButtonElement>('#exp-wav')!.onclick = () => runExport('wav');
  }

  async function runExport(format: ExportFormat) {
    const safe = (getUserName() ? `Reprogramação - ${getUserName()}` : 'Reprogramação').replace(/[\\/:*?"<>|]/g, '');
    const fileName = `${safe}.${format}`;

    // Grava direto no disco quando o navegador suporta (memória baixa, qualquer tamanho)
    let writable: { write: (b: BufferSource) => Promise<void>; close: () => Promise<void> } | null = null;
    const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable: () => Promise<typeof writable> }> }).showSaveFilePicker;
    if (picker) {
      try {
        const handle = await picker({
          suggestedName: fileName,
          types: [{ description: format.toUpperCase(), accept: { [format === 'mp3' ? 'audio/mpeg' : 'audio/wav']: ['.' + format] } }],
        });
        writable = await handle.createWritable();
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return; // usuário cancelou
        writable = null; // sem permissão → cai para download
      }
    }

    player.pause();
    const fill = $('#exp-fill');
    const status = $('#exp-status');
    $('#exp-progress').style.display = 'flex';
    const m3 = $<HTMLButtonElement>('#exp-mp3');
    const wv = $<HTMLButtonElement>('#exp-wav');
    const active = format === 'mp3' ? m3 : wv;
    m3.disabled = true; wv.disabled = true;
    active.classList.add('exporting');
    const label = active.textContent;
    active.textContent = '⏳ Exportando…';
    status.textContent = writable ? 'Gravando no disco…' : 'Renderizando…';
    try {
      const tracks = playlist.map((t) => ({ decode: () => decodeTrackCapped(t), durationSec: t.durationSec, rate: rateOf(t) }));
      const blob = await exportSession({
        project, clips, tracks, format, writable,
        onProgress: (f) => { fill.style.width = `${Math.round(f * 100)}%`; status.textContent = `${writable ? 'Gravando' : 'Renderizando'}… ${Math.round(f * 100)}%`; },
      });
      if (blob) { downloadBlob(blob, fileName); status.textContent = '✓ Pronto! Baixando…'; }
      else { status.textContent = '✓ Salvo no disco!'; }
      setTimeout(() => { $('#exp-progress').style.display = 'none'; fill.style.width = '0%'; }, 2500);
    } catch (err) {
      console.error(err);
      try { await writable?.close(); } catch { /* noop */ }
      status.textContent = '⚠ Falha na exportação. Tente uma duração menor ou faixas menores.';
    } finally {
      m3.disabled = false; wv.disabled = false;
      active.classList.remove('exporting');
      if (label) active.textContent = label;
    }
  }

  // ---- Transporte ----
  btnPlay.onclick = () => {
    if (schedule.recorded.length === 0) return;
    if (player.isPlaying) { player.pause(); btnPlay.textContent = '▶'; }
    else { player.play(); btnPlay.textContent = '⏸'; }
  };
  $('#stop').onclick = () => { player.reset(); btnPlay.textContent = '▶'; redraw(0); };

  // ---- Busca na timeline ----
  let dragPos = 0;
  const posFromX = (clientX: number) => {
    const rect = canvas.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * schedule.totalSec;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (schedule.recorded.length === 0) return;
    seeking = true; canvas.setPointerCapture(e.pointerId); dragPos = posFromX(e.clientX); redraw(dragPos);
  });
  canvas.addEventListener('pointermove', (e) => { if (seeking) { dragPos = posFromX(e.clientX); redraw(dragPos); } });
  canvas.addEventListener('pointerup', () => {
    if (!seeking) return;
    seeking = false;
    player.seek(dragPos);
    if (!player.isPlaying) { player.play(); btnPlay.textContent = '⏸'; }
  });

  function musicSegmentsForDraw(): { start: number; end: number; trackIndex: number }[] {
    const segs: { start: number; end: number; trackIndex: number }[] = [];
    const total = schedule.totalSec;
    if (playlist.length === 0 || total <= 0) return segs;
    let t = 0, i = 0, guard = 0;
    while (t < total && guard < 100000) {
      const tr = playlist[i % playlist.length];
      const len = tr.durationSec / rateOf(tr);
      if (!isFinite(len) || len <= 0) break;
      segs.push({ start: t, end: t + len, trackIndex: i % playlist.length });
      t += len; i++; guard++;
    }
    return segs;
  }

  function redraw(pos: number) {
    drawTimeline(canvas, schedule, musicSegmentsForDraw(), playlist.map((t) => t.name), pos);
    elCur.textContent = fmt(pos);
    elTot.textContent = fmt(schedule.totalSec);
    if (schedule.recorded.length === 0) info.innerHTML = `<span class="sess-warn">Nenhum comando gravado ainda. Volte e grave.</span>`;
    else info.innerHTML = `${schedule.recorded.length} comandos · ciclo de ${fmt(schedule.cycleSec)} · <strong>${schedule.cycles} repetições</strong> · total <strong>${fmt(schedule.totalSec)}</strong>`;
  }

  renderFxSection();
  renderMusicSection();
  renderExportSection();
  redraw(0);

  // Carrega a playlist salva (em segundo plano)
  void (async () => {
    for (const mt of project.musicList ?? []) {
      const blob = await mediaStore.get(mt.recordingId);
      if (blob && blob.size > 0) {
        playlist.push({ id: mt.recordingId, name: mt.name, blob, url: URL.createObjectURL(blob), durationSec: mt.durationSec, detectedTuningHz: mt.detectedTuningHz });
      }
    }
    makePlayer();
    renderMusicSection();
    redraw(0);
    renderExportSection();
  })();
}

function drawTimeline(
  canvas: HTMLCanvasElement,
  schedule: SessionSchedule,
  musicSegs: { start: number; end: number; trackIndex: number }[],
  names: string[],
  playSec: number,
) {
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

  // voz
  const vy = 28, vh = 40;
  ctx.fillStyle = 'rgba(108,140,255,0.12)';
  ctx.fillRect(0, vy, w, vh);
  const vpal = ['#6c8cff', '#7a9cff', '#5b7cff'];
  schedule.events.forEach((ev) => {
    ctx.fillStyle = vpal[ev.commandIndex % vpal.length];
    ctx.fillRect(ev.startSec * pxPerSec, vy + 4, Math.max(1, ev.durationSec * pxPerSec), vh - 8);
  });
  ctx.fillStyle = 'rgba(232,234,240,0.7)';
  ctx.fillText('🎙️ Voz (comandos em loop)', 4, vy - 4);

  // música (segmentos)
  const my = 90, mh = 40;
  ctx.fillStyle = musicSegs.length ? 'rgba(79,208,122,0.12)' : 'rgba(154,163,178,0.08)';
  ctx.fillRect(0, my, w, mh);
  const mpal = ['rgba(79,208,122,0.55)', 'rgba(120,200,140,0.55)', 'rgba(90,180,170,0.55)', 'rgba(150,200,110,0.55)'];
  musicSegs.forEach((sg) => {
    const x = sg.start * pxPerSec;
    const bw = Math.max(1, (sg.end - sg.start) * pxPerSec);
    ctx.fillStyle = mpal[sg.trackIndex % mpal.length];
    ctx.fillRect(x, my + 4, bw, mh - 8);
    ctx.strokeStyle = 'rgba(14,16,20,0.6)';
    ctx.beginPath(); ctx.moveTo(x, my + 4); ctx.lineTo(x, my + mh - 4); ctx.stroke();
  });
  ctx.fillStyle = 'rgba(232,234,240,0.7)';
  ctx.fillText(musicSegs.length ? `🎵 Playlist (${names.length} música${names.length > 1 ? 's' : ''}, em sequência)` : '🎵 Sem música', 4, my - 4);

  const x = playSec * pxPerSec;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
}
