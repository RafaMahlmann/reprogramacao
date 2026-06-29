/**
 * Tela de gravação: o fluxo principal do app.
 *
 * Mostra o comando atual, permite editar o texto, gravar com auxílio de
 * teleprompter, ouvir, regravar e confirmar para avançar ao próximo comando.
 */
import type { AudioClip, Project } from '../../core/types';
import { VoiceRecorder } from '../../modules/recording/recorder';
import { playClip } from '../../modules/audio/playback';
import { runTeleprompter } from '../../modules/teleprompter/teleprompter';
import { saveProject } from '../../modules/project/project-service';
import { clipStore } from '../../modules/storage/db';
import { uid } from '../../core/id';

export function renderRecordingScreen(root: HTMLElement, project: Project): void {
  let index = 0;
  const clips = new Map<string, AudioClip>(); // recordingId -> clip (sessão atual)
  const recorder = new VoiceRecorder({ sampleRate: project.settings.sampleRate });
  let stopTeleprompter: (() => void) | null = null;
  let stopPlayback: (() => void) | null = null;
  let micReady = false;

  const COMMAND_LABELS = [
    'Estado Delta — acalmar a mente',
    'Libertação de traumas e bloqueios',
    'Autocura e equilíbrio',
    'Conhecimento interior e memória',
    'Ativação de funções superiores',
    'Sintonização com frequências elevadas',
    'Fechamento — conclusão de todos os comandos',
  ];

  root.innerHTML = `
    <section class="rec">
      <div class="rec-progress"></div>
      <div class="rec-label"></div>
      <div class="rec-name-hint">Substitua <strong>(seu nome)</strong> pelo seu nome antes de gravar.</div>
      <textarea class="rec-text" rows="5" spellcheck="false"></textarea>
      <div class="rec-prompter" aria-live="polite"></div>
      <div class="rec-status"></div>
      <div class="rec-controls"></div>
    </section>
  `;

  const elProgress = root.querySelector<HTMLElement>('.rec-progress')!;
  const elLabel = root.querySelector<HTMLElement>('.rec-label')!;
  const elText = root.querySelector<HTMLTextAreaElement>('.rec-text')!;
  const elPrompter = root.querySelector<HTMLElement>('.rec-prompter')!;
  const elStatus = root.querySelector<HTMLElement>('.rec-status')!;
  const elControls = root.querySelector<HTMLElement>('.rec-controls')!;

  function current() {
    return project.commands[index];
  }

  function render() {
    const cmd = current();
    elProgress.textContent = `Comando ${index + 1} de ${project.commands.length}`;
    elLabel.textContent = COMMAND_LABELS[index] ?? '';
    elText.value = cmd.text;
    elPrompter.textContent = '';
    const hasRec = !!cmd.recordingId && clips.has(cmd.recordingId);
    elStatus.textContent = hasRec
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
      elControls.append(button('▶ Ouvir', 'btn-play', playCurrent));
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
    current().text = elText.value;
    recorder.start();
    elStatus.textContent = '🔴 Gravando…';
    renderControls(false, true);
    stopTeleprompter = runTeleprompter(elPrompter, current().text);
  }

  function stopRecording() {
    stopTeleprompter?.();
    stopTeleprompter = null;
    const clip = recorder.stop();
    const cmd = current();
    const id = cmd.recordingId ?? uid();
    cmd.recordingId = id;
    cmd.durationSec = clip.durationSec;
    cmd.recordedAt = Date.now();
    clips.set(id, clip);
    void clipStore.save(id, clip);
    void saveProject(project);
    render();
  }

  function playCurrent() {
    const cmd = current();
    if (!cmd.recordingId) return;
    const clip = clips.get(cmd.recordingId);
    if (!clip) return;
    stopPlayback?.();
    elStatus.textContent = '▶ Reproduzindo…';
    stopPlayback = playClip(clip, () => {
      elStatus.textContent = `✓ Gravado (${cmd.durationSec?.toFixed(1)}s)`;
    });
  }

  function deleteCurrent() {
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
    if (index < project.commands.length - 1) go(index + 1);
    else elStatus.textContent = '🎉 Todos os comandos gravados! (música e export: próximas etapas)';
  }

  function go(newIndex: number) {
    stopPlayback?.();
    index = newIndex;
    render();
  }

  elText.addEventListener('input', () => {
    current().text = elText.value;
  });

  render();
}
