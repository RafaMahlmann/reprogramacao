/**
 * Gerenciamento de projetos: criar, persistir, carregar.
 *
 * Orquestra o modelo de domínio (core/types) com o armazenamento (storage/db),
 * sem que a UI precise conhecer detalhes de persistência.
 */
import { DEFAULT_SETTINGS, type Project, type VoiceCommand } from '../../core/types';
import { uid } from '../../core/id';
import { projectStore } from '../storage/db';

/**
 * Os 7 comandos de Reprogramação Neural (Luiz Antônio Valle).
 * Substitua "(seu nome)" pelo seu nome antes de gravar cada comando.
 * A sequência e a função de cada comando são intencionais — não reordenar.
 */
const STARTER_SCRIPTS = [
  // 1. Indução ao estado delta (filtros mentais atenuados)
  '(seu nome) você é cada vez mais calmo, tranquilo e sereno, seu corpo está totalmente descontraído, sua mente está funcionando numa frequência delta, lenta, de meio ciclo por segundo e em perfeitas condições.',

  // 2. Libertação de traumas e bloqueios
  '(seu nome), você é totalmente livre de qualquer bloqueio, mal estar ou imprint provocado por traumas, rejeições, frustrações ou decepções que tenha sofrido durante a sua gestação, seu nascimento, sua infância, sua adolescência, idade adulta nesta ou em outras vidas, em qualquer dimensão ou universo, você é completamente livre.',

  // 3. Autocura e equilíbrio físico, mental, emocional e espiritual
  '(seu nome), você perdoa todos que o ofenderam ou o magoaram e perdoa a si próprio da mesma forma e totalmente, você está completamente curado, dentro de você tudo foi aceito, assimilado e transmutado em energia pura e positiva, agora há somente uma grande paz, alegria, luz, amor, sabedoria, realização plena e equilíbrio físico, mental, emocional e espiritual. Sua mente inconsciente está regulando todo o seu corpo, todos os seus órgãos funcionam perfeita e harmoniosamente bem, todas as suas glândulas estão totalmente ativas e funcionam perfeita e harmoniosamente bem, todos os seus níveis hormonais estão perfeitos, seu sistema imunológico e sistema nervoso funcionam com perfeição em todo o seu potencial, todas as células do seu corpo funcionam com perfeição e harmonia distribuindo e despertando a luz em todo o seu corpo.',

  // 4. Acesso ao conhecimento interior e recuperação de memórias
  '(seu nome) você é perfeito e contém em si todo o conhecimento do universo, você é uma biblioteca viva, dentro de você cada célula do seu corpo estão armazenadas informações sobre você e o universo, seu inconsciente aflora para o seu consciente essas informações e recordações contidas em você, você toma conhecimento consciente de tudo e se recorda de tudo com grande serenidade, paz interior e estado de pleno amor, você se recorda de todas as suas vidas, em todas as dimensões e universos, essa recordação flui para o seu consciente junto com o conhecimento integral da verdade de uma forma suave e tranquila, você sente-se bem ao recordar e é confortado por uma sabedoria infinita e uma paz profunda, você vibra na frequência do amor incondicional, você possui uma intuição muito desenvolvida e sente a verdade.',

  // 5. Ativação de funções superiores e dons divinos
  '(seu nome), você é um ser divino, foste feito com todos os atributos do criador, esses atributos estão plenamente ativados e despertam em você seus dons divinos, seu DNA está ativado em todo o seu potencial, seu DNA está 100% ativado em todas as suas partes, todos os seus chacras estão harmonizados e totalmente ativados, suas glândulas a pineal, pituitária e timo funcionam totalmente, perfeitamente e harmoniosamente. O seu terceiro olho está completamente aberto e ativo, seus hemisférios cerebrais estão ativos e sincronizados, suas polaridades, masculino e feminina, IN e IANG estão em harmonia e perfeitamente harmonizados, as polaridades foram aceitas e assimiladas em sua plenitude.',

  // 6. Sintonização com frequências elevadas e despertar multidimensional
  '(seu nome), você recepciona inteiramente com harmonia as energias da quinta, sexta e demais dimensões superiores em todos os seus corpos, você faz o download do sistema operacional multidimensional com perfeição e ele é completamente ativado, o que te permite operar em todas as dimensões de forma harmoniosa e perfeita, o seu corpo de luz está integralmente ativado, você se recorda de tudo, toma conhecimento de toda a verdade, se liberta completamente de toda limitação e desperta da ilusão da terceira dimensão, você se liga fortemente ao EU superior e a sua supra consciência e a ilusão termina.',

  // 7. Fechamento e conclusão de todos os comandos
  '(seu nome) todos esses comandos estão realizados, executados e concluídos, assim é.',
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
