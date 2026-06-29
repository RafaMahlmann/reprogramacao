/**
 * Teleprompter / leitura sincronizada (estilo karaokê) durante a gravação.
 *
 * Retorna um TeleprompterHandle com stop() e setWpm() para controle em tempo real.
 * O setWpm() mantém a posição atual — não reinicia do começo ao mudar a velocidade.
 */

export interface TeleprompterOptions {
  wpm?: number;
}

export interface TeleprompterHandle {
  stop: () => void;
  /** Muda a velocidade imediatamente, mantendo a palavra atual. */
  setWpm: (wpm: number) => void;
  getWpm: () => number;
}

export function runTeleprompter(
  container: HTMLElement,
  text: string,
  opts: TeleprompterOptions = {},
): TeleprompterHandle {
  const words = text.split(/\s+/).filter(Boolean);
  container.innerHTML = words.map((w, i) => `<span data-w="${i}">${w}</span>`).join(' ');
  const spans = Array.from(container.querySelectorAll<HTMLSpanElement>('span'));

  let wpm = Math.max(40, Math.min(300, opts.wpm ?? 130));
  let currentIndex = 0;
  let timer: number | null = null;

  function tick() {
    spans.forEach((s) => s.classList.remove('tp-active'));
    if (currentIndex < spans.length) {
      spans[currentIndex].classList.add('tp-active');
      spans[currentIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      currentIndex++;
    } else {
      if (timer !== null) clearInterval(timer);
      timer = null;
    }
  }

  function startInterval() {
    if (timer !== null) clearInterval(timer);
    timer = window.setInterval(tick, 60000 / wpm);
  }

  startInterval();

  return {
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      spans.forEach((s) => s.classList.remove('tp-active'));
    },
    setWpm(newWpm: number) {
      wpm = Math.max(40, Math.min(300, newWpm));
      startInterval();
    },
    getWpm() {
      return wpm;
    },
  };
}
