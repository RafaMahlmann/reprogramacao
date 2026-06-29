import { createProject } from '../modules/project/project-service';
import type { Project } from '../core/types';
import { renderRecordingScreen } from './screens/recording-screen';

const NAME_KEY = 'reprogramacao:userName';

export function getUserName(): string {
  return localStorage.getItem(NAME_KEY) ?? '';
}

export function setUserName(name: string): void {
  localStorage.setItem(NAME_KEY, name.trim());
}

export function startApp(root: HTMLElement): void {
  const project: Project = createProject('Reprogramação Neural');

  root.innerHTML = `
    <header class="app-header">
      <h1>Reprogramação</h1>
      <p class="tagline">Sua voz, sua frequência.</p>
    </header>
    <main id="screen"></main>
  `;

  const screen = root.querySelector<HTMLElement>('#screen')!;
  const savedName = getUserName();

  if (!savedName) {
    showNameCard(screen, () => renderRecordingScreen(screen, project));
  } else {
    renderRecordingScreen(screen, project);
  }
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

  const input  = container.querySelector<HTMLInputElement>('#name-input')!;
  const btnOk  = container.querySelector<HTMLButtonElement>('#name-confirm')!;

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
