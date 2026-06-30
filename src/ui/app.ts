import { createProject, loadMostRecentProject, saveProject } from '../modules/project/project-service';
import type { Project } from '../core/types';
import { requestPersistentStorage, clipStore } from '../modules/storage/db';
import { importProjectFile } from '../modules/project/project-file';
import { renderRecordingScreen } from './screens/recording-screen';
import { renderSavedAudiosScreen } from './screens/saved-audios-screen';
import { renderSessionScreen } from './screens/session-screen';

const NAME_KEY = 'reprogramacao:userName';

let screenEl: HTMLElement | null = null;

/** Navegação entre telas (usada pelos botões "Próxima etapa" / "Voltar"). */
export function showRecording(project: Project): void {
  if (screenEl) renderRecordingScreen(screenEl, project);
}
export function showSession(project: Project): void {
  if (screenEl) void renderSessionScreen(screenEl, project);
}

export function getUserName(): string {
  return localStorage.getItem(NAME_KEY) ?? '';
}

export function setUserName(name: string): void {
  localStorage.setItem(NAME_KEY, name.trim());
}

export function startApp(root: HTMLElement): void {
  root.innerHTML = `
    <header class="app-header">
      <div class="app-header-row">
        <div>
          <h1>Reprogramação</h1>
          <p class="tagline">Sua voz, sua frequência.</p>
        </div>
        <button class="btn btn-saved" id="btn-saved">💾 Áudios salvos</button>
      </div>
    </header>
    <main id="screen"></main>
  `;

  const screen = root.querySelector<HTMLElement>('#screen')!;
  screenEl = screen;
  void requestPersistentStorage();

  function openRecording() {
    loadMostRecentProject().then((existing) => {
      const project: Project = existing ?? createProject('Reprogramação Neural');
      if (!getUserName()) {
        showNameCard(screen, () => renderRecordingScreen(screen, project));
      } else {
        renderRecordingScreen(screen, project);
      }
    });
  }

  // Botão fixo: acessa os áudios salvos a qualquer momento
  root.querySelector<HTMLButtonElement>('#btn-saved')!.onclick = () => {
    void renderSavedAudiosScreen(screen, openRecording);
  };

  openRecording();
}

export function showNameCard(container: HTMLElement, onDone: () => void): void {
  container.innerHTML = `
    <div class="name-card">
      <p class="name-card-tip">
        💡 Recomendação de <strong>Luiz Antônio Valle</strong>: cada comando deve
        começar com o seu próprio nome, falado com voz firme e imperativa.
        Isso direciona a mensagem diretamente ao seu inconsciente.
      </p>
      <label class="name-card-label" for="name-input">
        Como você quer ser chamado nos comandos?
      </label>
      <input
        id="name-input"
        class="name-input"
        type="text"
        placeholder="Ex: Rafael"
        maxlength="40"
        autocomplete="given-name"
        autocorrect="off"
        spellcheck="false"
      />
      <p class="name-card-sub">
        Escreva seu nome como você quer que ele apareça no texto — exatamente
        como vai soar na sua voz.
      </p>
      <button class="btn btn-confirm name-card-btn" id="name-confirm" disabled>
        Continuar →
      </button>
      <div class="name-card-divider"><span>ou continue de onde parou</span></div>
      <label class="btn btn-project name-card-open" for="open-rpn-name">📂 Abrir projeto salvo (.rpn)</label>
      <input type="file" accept=".rpn,application/octet-stream" hidden id="open-rpn-name" />
      <p class="name-card-sub name-card-open-hint">Tem um arquivo <strong>.rpn</strong> que você salvou no computador? Abra aqui para recuperar seus áudios e textos exatamente como estavam.</p>
      <p class="name-card-status rec-status"></p>
    </div>
  `;

  const input = container.querySelector<HTMLInputElement>('#name-input')!;
  const btnOk = container.querySelector<HTMLButtonElement>('#name-confirm')!;

  const openInput = container.querySelector<HTMLInputElement>('#open-rpn-name');
  if (openInput) {
    openInput.onchange = async () => {
      const file = openInput.files?.[0];
      if (!file) return;
      const status = container.querySelector<HTMLElement>('.name-card-status');
      try {
        if (status) status.textContent = 'Abrindo projeto…';
        const imported = await importProjectFile(file);
        for (const [id, clip] of imported.clips) await clipStore.save(id, clip);
        if (imported.userName) setUserName(imported.userName);
        await saveProject(imported.project);
        renderRecordingScreen(container, imported.project);
      } catch (err) {
        if (status) status.textContent = '⚠ Não foi possível abrir este arquivo .rpn.';
        console.error(err);
      } finally {
        openInput.value = '';
      }
    };
  }

  input.addEventListener('input', () => {
    btnOk.disabled = input.value.trim().length === 0;
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) confirm();
  });

  btnOk.onclick = confirm;
  input.focus();

  function confirm() {
    setUserName(input.value);
    onDone();
  }
}
