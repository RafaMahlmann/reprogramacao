/**
 * Tela "Áudios salvos" — recuperação direta.
 *
 * Lê TODOS os clipes de áudio guardados no IndexedDB, independentemente de qual
 * projeto. Garante que o usuário sempre consiga ouvir e baixar suas gravações,
 * mesmo que o vínculo projeto↔gravação tenha se perdido.
 *
 * Faz o melhor esforço para rotular cada clipe cruzando o id da gravação com os
 * comandos de todos os projetos salvos.
 */
import type { AudioClip } from '../../core/types';
import { clipStore } from '../../modules/storage/db';
import { listProjects, saveProject } from '../../modules/project/project-service';
import { importProjectFile } from '../../modules/project/project-file';
import { setUserName } from '../app';
import { playClip } from '../../modules/audio/playback';
import { downloadClipWav } from '../../modules/export/download';

interface Entry {
  id: string;
  clip: AudioClip;
  label: string;
}

export async function renderSavedAudiosScreen(root: HTMLElement, onBack: () => void): Promise<void> {
  root.innerHTML = `<div class="rec-loading">Lendo áudios da memória…</div>`;

  const [all, projects] = await Promise.all([clipStore.listAll(), listProjects()]);

  // Mapa recordingId -> rótulo (a partir dos comandos de todos os projetos)
  const labelMap = new Map<string, string>();
  for (const p of projects) {
    p.commands.forEach((cmd, i) => {
      if (cmd.recordingId) labelMap.set(cmd.recordingId, `Comando ${i + 1}`);
    });
  }

  const entries: Entry[] = all.map((e, i) => ({
    id: e.id,
    clip: e.clip,
    label: labelMap.get(e.id) ?? `Áudio ${i + 1}`,
  }));

  let stopPlayback: (() => void) | null = null;

  // Abre um projeto .rpn salvo no PC e volta para a gravação com ele carregado.
  function attachOpenRpn(): void {
    const inp = root.querySelector<HTMLInputElement>('#open-rpn');
    if (!inp) return;
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (!file) return;
      const status = root.querySelector<HTMLElement>('.saved-status');
      try {
        if (status) status.textContent = 'Abrindo projeto…';
        const imported = await importProjectFile(file);
        for (const [id, clip] of imported.clips) await clipStore.save(id, clip);
        if (imported.userName) setUserName(imported.userName);
        await saveProject(imported.project);
        stopPlayback?.();
        onBack(); // recarrega a gravação com o projeto mais recente (o que acabou de importar)
      } catch (err) {
        if (status) status.textContent = '⚠ Não foi possível abrir este arquivo .rpn.';
        console.error(err);
      } finally {
        inp.value = '';
      }
    };
  }

  if (entries.length === 0) {
    root.innerHTML = `
      <section class="rec">
        <button class="btn-link" id="back">‹ Voltar</button>
        <p class="saved-empty">Nenhum áudio na memória deste navegador.</p>
        <p class="saved-sub">Se você salvou um projeto <strong>.rpn</strong> no seu computador, abra-o aqui para recuperar seus áudios e textos.</p>
        <label class="btn btn-project" for="open-rpn">📂 Abrir projeto salvo (.rpn)</label>
        <input type="file" accept=".rpn,application/octet-stream" hidden id="open-rpn" />
        <p class="saved-status rec-status"></p>
      </section>
    `;
    root.querySelector<HTMLButtonElement>('#back')!.onclick = onBack;
    attachOpenRpn();
    return;
  }

  root.innerHTML = `
    <section class="rec">
      <button class="btn-link" id="back">‹ Voltar para gravação</button>
      <h2 class="saved-title">💾 ${entries.length} áudio(s) salvos na memória</h2>
      <p class="saved-sub">Estes são todos os áudios guardados neste navegador. Ouça e baixe em WAV 24-bit (sem perdas) para guardar no computador.</p>
      <label class="btn btn-project" for="open-rpn">📂 Abrir outro projeto salvo (.rpn)</label>
      <input type="file" accept=".rpn,application/octet-stream" hidden id="open-rpn" />
      <p class="saved-status rec-status"></p>
      <div class="saved-list"></div>
      <button class="btn btn-dl-all" id="dl-all">⬇ Baixar todos (${entries.length} arquivos)</button>
    </section>
  `;

  root.querySelector<HTMLButtonElement>('#back')!.onclick = () => { stopPlayback?.(); onBack(); };
  attachOpenRpn();

  const list = root.querySelector<HTMLElement>('.saved-list')!;
  entries.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'saved-row';
    row.innerHTML = `
      <div class="saved-row-info">
        <span class="saved-row-label">${entry.label}</span>
        <span class="saved-row-dur">${entry.clip.durationSec.toFixed(1)}s</span>
      </div>
      <div class="saved-row-actions">
        <button class="btn btn-play btn-play-row">▶ Ouvir</button>
        <button class="btn btn-dl btn-dl-row">⬇ Baixar WAV</button>
      </div>
    `;
    row.querySelector<HTMLButtonElement>('.btn-play-row')!.onclick = () => {
      stopPlayback?.();
      stopPlayback = playClip(entry.clip);
    };
    row.querySelector<HTMLButtonElement>('.btn-dl-row')!.onclick = () =>
      downloadClipWav(entry.clip, `${entry.label}.wav`);
    list.append(row);
  });

  root.querySelector<HTMLButtonElement>('#dl-all')!.onclick = () => {
    entries.forEach((entry, i) => {
      setTimeout(() => downloadClipWav(entry.clip, `${entry.label}.wav`), i * 400);
    });
  };
}
