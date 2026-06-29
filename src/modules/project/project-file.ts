/**
 * Formato de projeto .rpn (Reprogramação Neural).
 *
 * É um arquivo único, portátil — análogo ao projeto do DaVinci. Por dentro é
 * um ZIP transparente, então o conteúdo nunca fica preso num formato fechado:
 *
 *   manifest.json          -> versão, projeto (textos, ordem, configurações), nome do usuário
 *   audio/<recordingId>.wav -> cada gravação em WAV float-32 (sem perdas, reversível)
 *
 * Usamos float-32 dentro do .rpn para reconstrução perfeita (bit a bit) do PCM
 * gravado. O download avulso de WAV para o usuário continua em 24-bit (padrão).
 */
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { AudioClip, Project } from '../../core/types';
import { encodeWav, decodeWav } from '../audio/wav';

const FORMAT_VERSION = 1;

interface Manifest {
  format: 'reprogramacao';
  version: number;
  exportedAt: number;
  userName: string;
  project: Project;
}

/** Monta o arquivo .rpn (Blob) a partir do projeto e seus clips. */
export async function buildProjectFile(
  project: Project,
  clips: Map<string, AudioClip>,
  userName: string,
): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};

  const manifest: Manifest = {
    format: 'reprogramacao',
    version: FORMAT_VERSION,
    exportedAt: Date.now(),
    userName,
    project,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  for (const cmd of project.commands) {
    if (cmd.recordingId && clips.has(cmd.recordingId)) {
      const wavBlob = encodeWav(clips.get(cmd.recordingId)!, 32);
      const buf = await wavBlob.arrayBuffer();
      files[`audio/${cmd.recordingId}.wav`] = new Uint8Array(buf);
    }
  }

  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped as unknown as BlobPart], { type: 'application/octet-stream' });
}

export interface ImportedProject {
  project: Project;
  clips: Map<string, AudioClip>;
  userName: string;
}

/** Lê um arquivo .rpn e devolve o projeto + clips reconstruídos. */
export async function importProjectFile(file: File): Promise<ImportedProject> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const files = unzipSync(buf);

  const manifestRaw = files['manifest.json'];
  if (!manifestRaw) throw new Error('Arquivo .rpn inválido: manifest.json ausente.');
  const manifest = JSON.parse(strFromU8(manifestRaw)) as Manifest;

  const clips = new Map<string, AudioClip>();
  for (const cmd of manifest.project.commands) {
    if (cmd.recordingId) {
      const wav = files[`audio/${cmd.recordingId}.wav`];
      if (wav) {
        const ab = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
        clips.set(cmd.recordingId, decodeWav(ab));
      }
    }
  }

  return { project: manifest.project, clips, userName: manifest.userName };
}
