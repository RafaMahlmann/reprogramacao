/**
 * Gerenciamento de projetos: criar, persistir, carregar.
 *
 * Orquestra o modelo de domínio (core/types) com o armazenamento (storage/db),
 * sem que a UI precise conhecer detalhes de persistência.
 */
import { DEFAULT_SETTINGS, type Project, type VoiceCommand } from '../../core/types';
import { uid } from '../../core/id';
import { projectStore } from '../storage/db';

/** Roteiros iniciais sugeridos (afirmações). O usuário pode editar tudo. */
const STARTER_SCRIPTS = [
  'Eu estou em paz comigo mesmo.',
  'A cada respiração, eu me sinto mais calmo e centrado.',
  'Eu confio na minha capacidade de realizar o que desejo.',
];

export function createProject(name = 'Novo Projeto'): Project {
  const now = Date.now();
  const commands: VoiceCommand[] = STARTER_SCRIPTS.map((text, i) => ({
    id: uid(),
    order: i,
    text,
  }));
  return {
    id: uid(),
    name,
    createdAt: now,
    updatedAt: now,
    commands,
    settings: { ...DEFAULT_SETTINGS },
  };
}

export async function saveProject(project: Project): Promise<void> {
  project.updatedAt = Date.now();
  await projectStore.save(project);
}

export function listProjects(): Promise<Project[]> {
  return projectStore.list();
}

export function loadProject(id: string): Promise<Project | undefined> {
  return projectStore.get(id);
}
