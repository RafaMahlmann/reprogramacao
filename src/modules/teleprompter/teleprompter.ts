/**
 * Teleprompter / leitura sincronizada (estilo karaokê) durante a gravação.
 *
 * Versão atual: realce simples palavra a palavra em ritmo constante, para
 * ajudar a leitura. Sincronização fina por reconhecimento de fala pode ser
 * adicionada depois (Web Speech API), mantendo esta interface.
 */

export interface TeleprompterOptions {
  /** Palavras por minuto do realce. */
  wpm?: number;
}

/**
 * Realça as palavras de `text` dentro de `container` em ritmo constante.
 * Devolve uma função para cancelar o realce.
 */
export function runTeleprompter(
  container: HTMLElement,
  text: string,
  opts: TeleprompterOptions = {},
): () => void {
  const wpm = opts.wpm ?? 130;
  const words = text.split(/\s+/).filter(Boolean);
  container.innerHTML = words.map((w, i) => `<span data-w="${i}">${w}</span>`).join(' ');
  const spans = Array.from(container.querySelectorAll<HTMLSpanElement>('span'));
  const msPerWord = 60000 / wpm;
  let i = 0;
  const timer = window.setInterval(() => {
    spans.forEach((s) => s.classList.remove('tp-active'));
    if (i < spans.length) {
      spans[i].classList.add('tp-active');
      spans[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      i++;
    } else {
      window.clearInterval(timer);
    }
  }, msPerWord);

  return () => window.clearInterval(timer);
}
