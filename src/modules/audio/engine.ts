/**
 * Engine de reprodução/mixagem da sessão completa.
 *
 * STATUS: stub. Responsabilidade futura:
 *  - tocar a música de fundo de forma contínua (loop ou faixa longa);
 *  - intercalar os comandos de voz na sequência, com os intervalos configurados;
 *  - repetir a sequência de comandos enquanto a música durar;
 *  - aplicar (opcional) o ajuste para 432 Hz na música.
 *
 * Renderiza tanto para reprodução ao vivo (Web Audio) quanto para o export
 * (OfflineAudioContext), reaproveitando a mesma lógica de montagem da sessão.
 */
import type { Project } from '../../core/types';

export interface SessionPlan {
  /** Duração total estimada da sessão (s). */
  totalDurationSec: number;
}

export function planSession(_project: Project): SessionPlan {
  throw new Error('planSession: não implementado ainda (ver módulo audio/engine).');
}
