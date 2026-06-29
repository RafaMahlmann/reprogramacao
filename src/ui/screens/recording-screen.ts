/**
 * Tela de gravação: o fluxo principal do app.
 *
 * Recursos:
 * - Teleprompter com controle de velocidade (WPM) em tempo real
 * - Visualizador de forma de onda ao vivo durante a gravação
 * - Animação de barras durante a reprodução
 */
import type { AudioClip, Project } from '../../core/types';
import { VoiceRecorder } from '../../modules/recording/recorder';
import { playClip } from '../../modules/audio/playback';
// import { runTeleprompter, type TeleprompterHandle } from '../../modules/teleprompter/teleprompter';
import type { TeleprompterHandle } from '../../modules/teleprompter/teleprompter';
import { saveProject } from '../../modules/project/project-service';
import { clipStore } from '../../modules/storage/db';
import { uid } from '../../core/id';

const COMMAND_LABELS = [
  'Estado Delta — acalmar a mente',
  'Libertação de traumas e bloqueios',
  'Autocura e equilíbrio',
  'Conhecimento interior e memória',
  'Ativação de funções superiores',
  'Sintonização com frequências elevadas',
  'Fechamento — conclusão de todos os comandos',
];

export function renderRecordingScreen(root: HTMLElement, project: Project): void {
  let index = 0;
  let wpm = 110;
  const clips = new Map<string, AudioClip>();
  const recorder = new VoiceRecorder({ sampleRate: project.settings.sampleRate });
  let teleprompter: TeleprompterHandle | null = null;
  let stopPlayback: (() => void) | null = null;
  let stopWaveform: (() => void) | null = null;
  let micReady = false;
  let isPlaying = false;

  root.innerHTML = `
    <section class="rec">
      <div class="rec-progress"></div>
      <div class="rec-label"></div>
      <div class="rec-name-hint">Substitua <strong>(seu nome)</strong> pelo seu nome antes de gravar.</div>
      <textarea class="rec-text" rows="5" spellcheck="false"></textarea>

      <div class="rec-viz">
        <canvas class="rec-wave" width="600" height="64"></canvas>
        <div class="rec-play-anim" aria-hidden="true" style="display:none">
          <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
        </div>
      </div>

      <div class="rec-prompter" aria-live="polite"></div>
      <div class="rec-status"></div>

      <div class="rec-wpm-panel">
        <button class="btn btn-wpm" id="wpm-down" aria-label="Diminuir velocidade">−</button>
        <span class="rec-wpm-value" id="wpm-display">${wpm} ppm</span>
        <button class="btn btn-wpm" id="wpm-up" aria-label="Aumentar velocidade">+</button>
        <span class="rec-wpm-label">velocidade</span>
      </div>

      <div class="rec-controls"></div>
    </section>
  `;

  const elProgress  = root.querySelector<HTMLElement>('.rec-progress')!;
  const elLabel     = root.querySelector<HTMLElement>('.rec-label')!;
  const elText      = root.querySelector<HTMLTextAreaElement>('.rec-text')!;
  const elPrompter  = root.querySelector<HTMLElement>('.rec-prompter')!;
  const elStatus    = root.querySelector<HTMLElement>('.rec-status')!;
  const elControls  = root.querySelector<HTMLElement>('.rec-controls')!;
  const elWave      = root.querySelector<HTMLCanvasElement>('.rec-wave')!;
  const elPlayAnim  = root.querySelector<HTMLElement>('.rec-play-anim')!;
  const elWpmValue  = root.querySelector<HTMLElement>('#wpm-display')!;
  const btnWpmDown  = root.querySelector<HTMLButtonElement>('#wpm-down')!;
  const btnWpmUp    = root.querySelector<HTMLButtonElement>('#wpm-up')!;

  // --- WPM controls ---
  function updateWpm(delta: number) {
    wpm = Math.max(40, Math.min(300, wpm + delta));
    elWpmValue.textContent = `${wpm} ppm`;
    teleprompter?.setWpm(wpm);
  }
  btnWpmDown.onclick = () => updateWpm(-10);
  btnWpmUp.onclick   = () => updateWpm(+10);

  // --- Waveform (gravação) ---
  function startWaveform(analyser: AnalyserNode) {
    const ctx2d = elWave.getContext('2d')!;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let rafId = 0;

    function draw() {
      rafId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(buf);

      const w = elWave.width;
      const h = elWave.height;
      ctx2d.clearRect(0, 0, w, h);

      // linha central suave
      ctx2d.strokeStyle = 'rgba(108,140,255,0.15)';
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      ctx2d.moveTo(0, h / 2);
      ctx2d.lineTo(w, h / 2);
      ctx2d.stroke();

      // forma de onda
      ctx2d.strokeStyle = '#6c8cff';
      ctx2d.lineWidth = 2;
      ctx2d.lineJoin = 'round';
      ctx2d.beginPath();
      const step = w / buf.length;
      buf.forEach((v, i) => {
        const y = (v / 128) * (h / 2);
        i === 0 ? ctx2d.moveTo(0, y) : ctx2d.lineTo(i * step, y);
      });
      ctx2d.stroke();
    }

    draw();
    elWave.style.display = 'block';
    return () => {
      cancelAnimationFrame(rafId);
      ctx2d.clearRect(0, 0, elWave.width, elWave.height);
    };
  }

  function clearWave() {
    stopWaveform?.();
    stopWaveform = null;
    elWave.style.display = 'none';
  }

  // --- Animação de reprodução ---
  function showPlayAnim(show: boolean) {
    elPlayAnim.style.display = show ? 'flex' : 'none';
    elWave.style.display = show ? 'none' : 'none';
  }

  // --- Helpers de estado ---
  function current() { return project.commands[index]; }

  function render() {
    const cmd = current();
    elProgress.textContent = `Comando ${index + 1} de ${project.commands.length}`;
    elLabel.textContent    = COMMAND_LABELS[index] ?? '';
    elText.value           = cmd.text;
    elPrompter.innerHTML   = '';
    clearWave();
    showPlayAnim(false);

    const hasRec = !!cmd.recordingId && clips.has(cmd.recordingId);
    elStatus.textContent   = hasRec
      ? `✓ Gravado (${cmd.durationSec?.toFixed(1)}s)`
      : 'Ainda não gravado';
    renderControls(hasRec);
  }

  function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = `btn ${cls}`;
    b.onclick = onClick;
    return b;
  }

  function renderControls(hasRec: boolean, recording = false) {
    elControls.replaceChildren();
    if (recording) {
      elControls.append(button('■ Parar', 'btn-stop', stopRecording));
      return;
    }
    elControls.append(button(hasRec ? '● Regravar' : '● Gravar', 'btn-rec', startRecording));
    if (hasRec) {
      elControls.append(button('▶ Ouvir', isPlaying ? 'btn-play btn-playing' : 'btn-play', playCurrent));
      elControls.append(button('🗑 Apagar', 'btn-del', deleteCurrent));
    }
    if (index > 0) elControls.append(button('‹ Anterior', 'btn-nav', () => go(index - 1)));
    elControls.append(
      button(
        index < project.commands.length - 1 ? 'Confirmar ›' : 'Concluir ✓',
        'btn-confirm',
        confirmNext,
      ),
    );
  }

  // --- Gravação ---
  async function ensureMic() {
    if (micReady) return;
    elStatus.textContent = 'Pedindo acesso ao microfone…';
    await recorder.init();
    micReady = true;
  }

  async function startRecording() {
    try {
      await ensureMic();
    } catch {
      elStatus.textContent = '⚠ Não foi possível acessar o microfone.';
      return;
    }
    stopPlayback?.();
    showPlayAnim(false);
    current().text = elText.value;
    recorder.start();

    // waveform ao vivo
    const analyser = recorder.createAnalyser();
    stopWaveform = startWaveform(analyser);
    elWave.style.display = 'block';

    elStatus.textContent = '🔴 Gravando…';
    renderControls(false, true);
    // Realce sincrônico desabilitado — manter para reativar futuramente
    // teleprompter = runTeleprompter(elPrompter, current().text, { wpm });
    elPrompter.textContent = current().text;
  }

  function stopRecording() {
    teleprompter?.stop();
    teleprompter = null;
    clearWave();

    const clip = recorder.stop();
    const cmd  = current();
    const id   = cmd.recordingId ?? uid();
    cmd.recordingId  = id;
    cmd.durationSec  = clip.durationSec;
    cmd.recordedAt   = Date.now();
    clips.set(id, clip);
    void clipStore.save(id, clip);
    void saveProject(project);
    render();
  }

  // --- Reprodução ---
  function playCurrent() {
    const cmd = current();
    if (!cmd.recordingId) return;
    const clip = clips.get(cmd.recordingId);
    if (!clip) return;

    stopPlayback?.();
    isPlaying = true;
    showPlayAnim(true);
    elStatus.textContent = '▶ Reproduzindo…';
    renderControls(true /* hasRec */);

    stopPlayback = playClip(clip, () => {
      isPlaying = false;
      showPlayAnim(false);
      elStatus.textContent = `✓ Gravado (${cmd.durationSec?.toFixed(1)}s)`;
      renderControls(true);
    });
  }

  // --- Outros ---
  function deleteCurrent() {
    stopPlayback?.();
    isPlaying = false;
    const cmd = current();
    if (cmd.recordingId) {
      clips.delete(cmd.recordingId);
      void clipStore.delete(cmd.recordingId);
      cmd.recordingId = undefined;
      cmd.durationSec = undefined;
    }
    void saveProject(project);
    render();
  }

  function confirmNext() {
    current().text = elText.value;
    void saveProject(project);
    if (index < project.commands.length - 1) {
      go(index + 1);
    } else {
      elStatus.textContent = '🎉 Todos os comandos gravados! (música e export: próximas etapas)';
    }
  }

  function go(newIndex: number) {
    stopPlayback?.();
    isPlaying = false;
    index = newIndex;
    render();
  }

  elText.addEventListener('input', () => { current().text = elText.value; });

  render();
}
