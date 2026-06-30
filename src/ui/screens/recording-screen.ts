/**
 * Tela de gravação.
 *
 * Ao abrir, carrega TODOS os clips do IndexedDB antes de renderizar qualquer coisa.
 * Depois posiciona no primeiro comando não gravado (ou no último se todos prontos).
 * Mostra indicadores clicáveis de status de todos os comandos para navegação direta.
 */
import type { AudioClip, Project } from '../../core/types';
import { VoiceRecorder } from '../../modules/recording/recorder';
import { playClip } from '../../modules/audio/playback';
// import { runTeleprompter, type TeleprompterHandle } from '../../modules/teleprompter/teleprompter';
import type { TeleprompterHandle } from '../../modules/teleprompter/teleprompter';
import { saveProject } from '../../modules/project/project-service';
import { clipStore } from '../../modules/storage/db';
import { uid } from '../../core/id';
import { getUserName, setUserName, showNameCard, showSession } from '../app';
import { downloadClipsSequential, downloadBlob } from '../../modules/export/download';
import { buildProjectFile, importProjectFile } from '../../modules/project/project-file';

const COMMAND_LABELS = [
  'Estado Delta — acalmar a mente',
  'Libertação de traumas e bloqueios',
  'Autocura e equilíbrio',
  'Conhecimento interior e memória',
  'Ativação de funções superiores',
  'Sintonização com frequências elevadas',
  'Fechamento — conclusão de todos os comandos',
];

const EXPORT_LABELS = [
  '01 - Estado Delta',
  '02 - Libertação de Traumas',
  '03 - Autocura e Equilíbrio',
  '04 - Conhecimento Interior',
  '05 - Ativação de Funções Superiores',
  '06 - Frequências Elevadas',
  '07 - Fechamento',
];

function applyName(text: string): string {
  const name = getUserName();
  return name ? text.replace(/\(seu nome\)/gi, name) : text;
}

export function renderRecordingScreen(root: HTMLElement, project: Project): void {
  let index = 0;
  let wpm = 110;
  const clips = new Map<string, AudioClip>();
  const recorder = new VoiceRecorder({ sampleRate: project.settings.sampleRate });
  let teleprompter: TeleprompterHandle | null = null;
  let stopPlayback: (() => void) | null = null;
  let stopWaveform: (() => void) | null = null;
  let micReady = false;

  // Mostra loading enquanto carrega do IndexedDB
  root.innerHTML = `<div class="rec-loading">Carregando gravações salvas…</div>`;

  // Carrega TODOS os clips antes de qualquer render
  async function loadAndStart() {
    for (const cmd of project.commands) {
      if (cmd.recordingId) {
        const clip = await clipStore.get(cmd.recordingId);
        if (clip) clips.set(cmd.recordingId, clip);
      }
    }

    // Posiciona no primeiro não gravado; se todos prontos, vai para o último
    const firstPending = project.commands.findIndex(
      (cmd) => !(cmd.recordingId && clips.has(cmd.recordingId)),
    );
    index = firstPending === -1 ? project.commands.length - 1 : firstPending;

    buildUI();
    render();
  }

  void loadAndStart();

  // ---- Construção do HTML (só após carregar os clips) ----
  function buildUI() {
    root.innerHTML = `
      <section class="rec">
        <div class="rec-top-bar">
          <div class="rec-progress"></div>
          <button class="btn-link" id="btn-change-name">Trocar nome</button>
        </div>

        <div class="rec-dots"></div>

        <div class="rec-label"></div>
        <textarea class="rec-text" rows="5" spellcheck="false"></textarea>

        <div class="rec-viz">
          <canvas class="rec-wave" width="600" height="96"></canvas>
          <div class="rec-play-anim" aria-hidden="true" style="display:none">
            <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
          </div>
        </div>

        <div class="rec-prompter" aria-live="polite"></div>
        <div class="rec-status"></div>

        <!-- Painel de velocidade oculto — reativar junto com o realce sincrônico -->
        <div class="rec-wpm-panel" style="display:none">
          <button class="btn btn-wpm" id="wpm-down">−</button>
          <span class="rec-wpm-value" id="wpm-display">${wpm} ppm</span>
          <button class="btn btn-wpm" id="wpm-up">+</button>
        </div>

        <div class="rec-controls"></div>
        <div class="rec-export" style="display:none"></div>

        <button class="btn btn-next-step" id="btn-next-step">🎚️ Próxima etapa: Música e sequência →</button>

        <div class="rec-project-actions">
          <button class="btn btn-project" id="btn-save-project">💾 Salvar projeto (.rpn)</button>
          <label class="btn btn-project" for="open-file">📂 Abrir projeto (.rpn)</label>
          <input type="file" accept=".rpn,application/octet-stream" hidden id="open-file" />
        </div>
        <p class="rec-project-hint">O arquivo .rpn guarda todos os áudios + textos num só arquivo, para você baixar no PC e reabrir depois.</p>
      </section>
    `;

    root.querySelector<HTMLButtonElement>('#btn-next-step')!.onclick = () => showSession(project);
    root.querySelector<HTMLButtonElement>('#btn-save-project')!.onclick = saveProjectFile;
    root.querySelector<HTMLInputElement>('#open-file')!.onchange = openProjectFile;

    root.querySelector<HTMLButtonElement>('#btn-change-name')!.onclick = () =>
      showNameCard(root, () => renderRecordingScreen(root, project));

    const btnDown = root.querySelector<HTMLButtonElement>('#wpm-down');
    const btnUp   = root.querySelector<HTMLButtonElement>('#wpm-up');
    const elVal   = root.querySelector<HTMLElement>('#wpm-display');
    if (btnDown && btnUp && elVal) {
      btnDown.onclick = () => { wpm = Math.max(40, wpm - 10); elVal.textContent = `${wpm} ppm`; teleprompter?.setWpm(wpm); };
      btnUp.onclick   = () => { wpm = Math.min(300, wpm + 10); elVal.textContent = `${wpm} ppm`; teleprompter?.setWpm(wpm); };
    }

    root.querySelector<HTMLTextAreaElement>('.rec-text')!
      .addEventListener('input', (e) => { current().text = (e.target as HTMLTextAreaElement).value; });
  }

  // ---- Helpers ----
  function current() { return project.commands[index]; }
  function el<T extends HTMLElement>(sel: string) { return root.querySelector<T>(sel)!; }

  // ---- Dots de navegação ----
  function renderDots() {
    const container = el('.rec-dots');
    container.innerHTML = '';
    project.commands.forEach((cmd, i) => {
      const done = !!(cmd.recordingId && clips.has(cmd.recordingId));
      const dot = document.createElement('button');
      dot.className = `rec-dot ${done ? 'rec-dot--done' : ''} ${i === index ? 'rec-dot--active' : ''}`;
      dot.title = `Comando ${i + 1}: ${COMMAND_LABELS[i]}`;
      dot.setAttribute('aria-label', `Ir para comando ${i + 1}`);
      dot.onclick = () => go(i);
      container.append(dot);
    });
  }

  // ---- Render principal ----
  function render() {
    const cmd = current();
    el('.rec-progress').textContent = `Comando ${index + 1} de ${project.commands.length}`;
    el('.rec-label').textContent    = COMMAND_LABELS[index] ?? '';
    el<HTMLTextAreaElement>('.rec-text').value = applyName(cmd.text);
    el('.rec-prompter').innerHTML   = '';
    clearWave();
    showPlayAnim(false);

    const hasRec = !!(cmd.recordingId && clips.has(cmd.recordingId));
    el('.rec-status').textContent   = hasRec
      ? `✓ Gravado (${cmd.durationSec?.toFixed(1)}s)`
      : 'Ainda não gravado';

    renderDots();
    renderControls(hasRec);
    renderExportPanel();
  }

  // ---- Botões de controle ----
  function btn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = `btn ${cls}`;
    b.onclick = onClick;
    return b;
  }

  function renderControls(hasRec: boolean, recording = false) {
    const c = el('.rec-controls');
    c.replaceChildren();
    if (recording) { c.append(btn('■ Parar', 'btn-stop', stopRecording)); return; }
    c.append(btn(hasRec ? '● Regravar' : '● Gravar', 'btn-rec', startRecording));
    if (hasRec) {
      c.append(btn('▶ Ouvir', 'btn-play', playCurrent));
      c.append(btn('🗑 Apagar', 'btn-del', deleteCurrent));
    }
    if (index > 0) c.append(btn('‹ Anterior', 'btn-nav', () => go(index - 1)));
    c.append(btn(
      index < project.commands.length - 1 ? 'Confirmar ›' : 'Concluir ✓',
      'btn-confirm',
      confirmNext,
    ));
  }

  // ---- Painel de export ----
  function renderExportPanel() {
    const panel = el('.rec-export');
    const done = project.commands.filter(
      (cmd) => cmd.recordingId && clips.has(cmd.recordingId),
    );
    if (done.length === 0) { panel.style.display = 'none'; return; }

    const suffix = getUserName() ? ` - ${getUserName()}` : '';
    panel.style.display = 'block';
    panel.innerHTML = `
      <div class="export-panel">
        <p class="export-title">💾 Salvar gravações (WAV 24-bit, sem perdas)</p>
        <div class="export-list">
          ${done.map((cmd) => {
            const i = project.commands.indexOf(cmd);
            return `<button class="btn btn-dl" data-idx="${i}">⬇ ${EXPORT_LABELS[i] ?? `Comando ${i + 1}`}</button>`;
          }).join('')}
        </div>
        ${done.length === project.commands.length
          ? `<button class="btn btn-dl-all">⬇ Baixar todos (${done.length} arquivos)</button>`
          : ''}
      </div>
    `;

    panel.querySelectorAll<HTMLButtonElement>('.btn-dl[data-idx]').forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.idx);
        const clip = clips.get(project.commands[i].recordingId ?? '');
        if (!clip) return;
        import('../../modules/export/download').then(({ downloadClipWav }) =>
          downloadClipWav(clip, `${EXPORT_LABELS[i] ?? `Comando ${i + 1}`}${suffix}.wav`),
        );
      };
    });

    const btnAll = panel.querySelector<HTMLButtonElement>('.btn-dl-all');
    if (btnAll) {
      btnAll.onclick = () => {
        const items = project.commands.flatMap((cmd, i) => {
          const clip = clips.get(cmd.recordingId ?? '');
          return clip ? [{ clip, filename: `${EXPORT_LABELS[i]}${suffix}.wav` }] : [];
        });
        downloadClipsSequential(items);
        btnAll.textContent = '⏳ Baixando…';
        setTimeout(() => { btnAll.textContent = `⬇ Baixar todos (${items.length} arquivos)`; },
          items.length * 400 + 600);
      };
    }
  }

  // ---- Waveform ----
  function startWaveform(analyser: AnalyserNode) {
    const canvas = el<HTMLCanvasElement>('.rec-wave');
    const ctx2d  = canvas.getContext('2d')!;
    const buf    = new Uint8Array(analyser.frequencyBinCount);
    let rafId    = 0;
    const AMP = 3.4; // amplifica o desenho (a voz costuma desviar pouco de 128)
    function draw() {
      rafId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(buf);
      const w = canvas.width, h = canvas.height, mid = h / 2;
      const step = w / buf.length;
      ctx2d.clearRect(0, 0, w, h);

      // linha central
      ctx2d.strokeStyle = 'rgba(108,140,255,0.15)';
      ctx2d.lineWidth = 1;
      ctx2d.beginPath(); ctx2d.moveTo(0, mid); ctx2d.lineTo(w, mid); ctx2d.stroke();

      const yAt = (v: number) => {
        let y = mid + ((v - 128) / 128) * mid * AMP;
        return Math.max(1, Math.min(h - 1, y));
      };

      // área preenchida suave
      ctx2d.beginPath();
      ctx2d.moveTo(0, mid);
      buf.forEach((v, i) => ctx2d.lineTo(i * step, yAt(v)));
      ctx2d.lineTo(w, mid);
      ctx2d.closePath();
      ctx2d.fillStyle = 'rgba(108,140,255,0.18)';
      ctx2d.fill();

      // linha com brilho
      ctx2d.shadowColor = 'rgba(108,140,255,0.8)';
      ctx2d.shadowBlur = 6;
      ctx2d.strokeStyle = '#8aa6ff';
      ctx2d.lineWidth = 2.5;
      ctx2d.lineJoin = 'round';
      ctx2d.beginPath();
      buf.forEach((v, i) => {
        const y = yAt(v);
        i === 0 ? ctx2d.moveTo(0, y) : ctx2d.lineTo(i * step, y);
      });
      ctx2d.stroke();
      ctx2d.shadowBlur = 0;
    }
    draw();
    canvas.style.display = 'block';
    return () => { cancelAnimationFrame(rafId); ctx2d.clearRect(0, 0, canvas.width, canvas.height); };
  }

  function clearWave() {
    stopWaveform?.(); stopWaveform = null;
    const c = root.querySelector<HTMLCanvasElement>('.rec-wave');
    if (c) c.style.display = 'none';
  }

  function showPlayAnim(show: boolean) {
    const a = root.querySelector<HTMLElement>('.rec-play-anim');
    if (a) a.style.display = show ? 'flex' : 'none';
  }

  // ---- Gravação ----
  async function ensureMic() {
    if (micReady) return;
    el('.rec-status').textContent = 'Pedindo acesso ao microfone…';
    await recorder.init();
    micReady = true;
  }

  async function startRecording() {
    try { await ensureMic(); }
    catch { el('.rec-status').textContent = '⚠ Não foi possível acessar o microfone.'; return; }
    stopPlayback?.();
    showPlayAnim(false);
    current().text = el<HTMLTextAreaElement>('.rec-text').value;
    recorder.start();
    stopWaveform = startWaveform(recorder.createAnalyser());
    el('.rec-wave').style.display = 'block';
    el('.rec-status').textContent = '🔴 Gravando…';
    renderControls(false, true);
    // Realce sincrônico desabilitado — reativar junto com o painel de velocidade
    // teleprompter = runTeleprompter(el('.rec-prompter'), applyName(current().text), { wpm });
    el('.rec-prompter').textContent = applyName(current().text);
    // Abre como "nova aba": waveform no topo e o texto a ser lido logo abaixo,
    // independente de onde estava o botão antes de gravar.
    setTimeout(() => el('.rec-viz').scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  function stopRecording() {
    teleprompter?.stop(); teleprompter = null;
    clearWave();
    const clip = recorder.stop();
    const cmd  = current();
    const id   = cmd.recordingId ?? uid();
    cmd.recordingId = id; cmd.durationSec = clip.durationSec; cmd.recordedAt = Date.now();
    clips.set(id, clip);
    void clipStore.save(id, clip);
    void saveProject(project);
    render();
  }

  // ---- Reprodução ----
  function playCurrent() {
    const cmd  = current();
    const clip = clips.get(cmd.recordingId ?? '');
    if (!clip) return;
    stopPlayback?.();
    showPlayAnim(true);
    el('.rec-status').textContent = '▶ Reproduzindo…';
    renderControls(true);
    stopPlayback = playClip(clip, () => {
      showPlayAnim(false);
      el('.rec-status').textContent = `✓ Gravado (${cmd.durationSec?.toFixed(1)}s)`;
      renderControls(true);
    });
  }

  function deleteCurrent() {
    stopPlayback?.();
    const cmd = current();
    if (cmd.recordingId) {
      clips.delete(cmd.recordingId);
      void clipStore.delete(cmd.recordingId);
      cmd.recordingId = undefined; cmd.durationSec = undefined;
    }
    void saveProject(project);
    render();
  }

  function confirmNext() {
    current().text = el<HTMLTextAreaElement>('.rec-text').value;
    void saveProject(project);
    if (index < project.commands.length - 1) go(index + 1);
    else el('.rec-status').textContent = '🎉 Todos os comandos gravados!';
  }

  function go(newIndex: number) {
    stopPlayback?.();
    index = newIndex;
    render();
  }

  // ---- Projeto .rpn ----
  async function saveProjectFile() {
    const name = getUserName();
    const blob = await buildProjectFile(project, clips, name);
    const safe = (name ? `Reprogramação - ${name}` : 'Reprogramação').replace(/[\\/:*?"<>|]/g, '');
    downloadBlob(blob, `${safe}.rpn`);
  }

  async function openProjectFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      el('.rec-status').textContent = 'Abrindo projeto…';
      const imported = await importProjectFile(file);
      // Persiste clips e projeto no IndexedDB
      for (const [id, clip] of imported.clips) await clipStore.save(id, clip);
      if (imported.userName) setUserName(imported.userName);
      await saveProject(imported.project);
      // Re-renderiza com o projeto importado
      renderRecordingScreen(root, imported.project);
    } catch (err) {
      el('.rec-status').textContent = '⚠ Não foi possível abrir este arquivo .rpn.';
      console.error(err);
    } finally {
      input.value = '';
    }
  }
}
