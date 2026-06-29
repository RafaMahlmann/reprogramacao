import { createProject, loadMostRecentProject } from '../modules/project/project-service';
import type { Project } from '../core/types';
import { requestPersistentStorage } from '../modules/storage/db';
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
    </div>
  `;

  const input = container.querySelector<HTMLInputElement>('#name-input')!;
  const btnOk = container.querySelector<HTMLButtonElement>('#name-confirm')!;

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
