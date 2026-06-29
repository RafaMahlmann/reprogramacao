# Reprogramação

PWA para criar áudios personalizados com a **sua própria voz** sobre uma música de fundo.

Você grava uma sequência de comandos (afirmações), o app combina com a música,
repete os comandos em loop com intervalos configuráveis e exporta um único
arquivo de áudio em alta qualidade.

> **Prioridade nº1:** máxima fidelidade da voz. O áudio é capturado e mantido em
> PCM sem perdas (Float32, 48 kHz) durante todo o fluxo.

## Estado atual

✅ Captura de voz em alta fidelidade (AudioWorklet, PCM cru, sem processamento do navegador)
✅ Tela de gravação: editar texto, teleprompter, gravar, ouvir, regravar, apagar, confirmar
✅ Modelo de projeto + armazenamento local (IndexedDB)
✅ Exportação WAV 16/24/32 bits (módulo base)
✅ PWA instalável (manifest + service worker)

🚧 Próximas etapas: importar música de fundo · detecção de afinação + ajuste 432 Hz ·
engine de mixagem da sessão · export MP3 320 kbps · gerenciador de projetos na UI.

## Rodar localmente

Requer Node.js 20+.

```bash
npm install
npm run dev      # servidor de desenvolvimento (http://localhost:5173)
npm run build    # build de produção em dist/
npm run preview  # pré-visualiza o build
```

> O acesso ao microfone exige `localhost` ou HTTPS.

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md) — estrutura modular e responsabilidades
- [Bibliotecas](docs/LIBRARIES.md) — dependências e análise de procedência
- [Segurança](docs/SECURITY.md) — supply chain e práticas adotadas
- [Continuidade para IA](docs/CONTINUIDADE.md) — modo de raciocínio + subsídios técnicos por fase

## Licença

A definir pelo proprietário.
