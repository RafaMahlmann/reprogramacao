/**
 * App shell: cria/carrega o projeto e monta a tela atual.
 *
 * Por enquanto há uma única tela (gravação). À medida que o app cresce, este
 * arquivo vira o roteador entre telas (gravação, música, reprodução, export).
 */
import { createProject } from '../modules/project/project-service';
import type { Project } from '../core/types';
import { renderRecordingScreen } from './screens/recording-screen';

export function startApp(root: HTMLElement): void {
  const project: Project = createProject('Reprogramação');
  root.innerHTML = `
    <header class="app-header">
      <h1>Reprogramação</h1>
      <p class="tagline">Sua voz, sua frequência.</p>
    </header>
    <main id="screen"></main>
  `;
  const screen = root.querySelector<HTMLElement>('#screen')!;
  renderRecordingScreen(screen, project);
}
