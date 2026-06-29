# Bibliotecas e procedência

Conforme a política do projeto, toda dependência passa por análise de procedência
antes de ser incorporada. Nenhum componente externo entra automaticamente.

## Critérios avaliados

origem · reputação · licença · frequência de manutenção · documentação ·
vulnerabilidades conhecidas · compatibilidade com a arquitetura.

## Em uso

| Pacote | Papel | Licença | Por que | Procedência |
|---|---|---|---|---|
| `vite` | Build / dev server | MIT | Padrão de mercado, enorme adoção | Mantido pela equipe Vite/Vue, milhões de downloads/semana |
| `typescript` | Tipagem | Apache-2.0 | Segurança de tipos, refatoração segura | Microsoft |
| `vite-plugin-pwa` | Service worker + manifest (PWA) | MIT | Abstrai Workbox; padrão da comunidade Vite | Autor antfu (core Vite/Vue) |
| `fflate` | ZIP do formato de projeto .rpn | MIT | Minúscula (~8 kB), sem dependências, auditada, altíssima adoção | Autor 101arrowz; amplamente usada em browsers |
| `@breezystack/lamejs` | Encode MP3 320k no export | MIT/LGPL | Fork mantido do lamejs (original sem manutenção); roda no browser, sem deps | Encoder LAME portado para JS |

Tudo nativo do navegador para áudio nesta fase: **Web Audio API**, **AudioWorklet**,
**MediaDevices/getUserMedia**, **IndexedDB**. Sem dependência externa de áudio até aqui —
menos superfície de risco.

## Candidatas (a aprovar antes de instalar)

| Necessidade | Candidata | Licença | Observação |
|---|---|---|---|
| Detecção de afinação | `pitchfinder` | MIT | YIN/AMDF; popular e estável |
| Export MP3 | `@breezystack/lamejs` | MIT/LGPL | Fork mantido do lamejs (lamejs original sem manutenção) |
| Forma de onda | `wavesurfer.js` | BSD-3 | Maduro; avaliar peso vs. desenho próprio em canvas |
| Pitch shift (432 Hz) | `soundtouchjs` | LGPL-2.1 | Time-stretch/pitch-shift; checar implicações da licença |
| Wrapper IndexedDB | `idb` | ISC | Só se a complexidade de persistência crescer |

> Antes de adicionar qualquer candidata: revisar versão, lockfile, `npm audit`,
> número de mantenedores e atividade recente. Registrar a decisão aqui.

## Processo ao adicionar uma dependência

1. Justificar a necessidade (não reinventar, mas também não inflar o bundle).
2. Conferir licença compatível e atribuição quando exigida.
3. `npm install` com versão fixada + commit do `package-lock.json`.
4. Rodar `npm audit` e revisar resultado.
5. Mover a linha de "Candidatas" para "Em uso" com a justificativa.
