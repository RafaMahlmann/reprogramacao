# Arquitetura

O projeto segue arquitetura modular: cada responsabilidade tem seu próprio módulo,
sem duplicação, com tipos compartilhados num único lugar.

```
src/
├── core/                  Modelo de domínio e utilitários puros
│   ├── types.ts           Project, VoiceCommand, MusicTrack, AudioClip, settings
│   └── id.ts              Geração de IDs
├── modules/               Lógica de negócio, sem DOM
│   ├── recording/         Captura de voz em alta fidelidade
│   │   ├── recorder.ts            VoiceRecorder (getUserMedia + AudioWorklet)
│   │   └── pcm-recorder-worklet.js Processor que entrega PCM Float32 cru
│   ├── audio/             Áudio sem perdas
│   │   ├── wav.ts         Codificação WAV 16/24/32 bits
│   │   ├── playback.ts    Reprodução de AudioClip via Web Audio
│   │   └── engine.ts      [stub] Mixagem da sessão (música + comandos + loop)
│   ├── pitch/             [stub] Detecção de afinação + ajuste 432 Hz
│   ├── export/            [stub] Export único (WAV / MP3)
│   ├── storage/           Persistência local (IndexedDB)
│   ├── project/           Criação/carga/salvamento de projetos
│   └── teleprompter/      Leitura sincronizada (karaokê)
└── ui/                    Camada de apresentação
    ├── app.ts             Shell + roteamento entre telas
    ├── screens/           Telas (recording-screen, …)
    └── components/        Componentes reutilizáveis
```

## Princípios

- **Fidelidade primeiro.** O áudio vive como Float32 PCM (sem perdas) do microfone
  até o export. Compressão (MP3) só no passo final e opcional.
- **UI não conhece persistência.** As telas falam com `project/` e `audio/`, nunca
  diretamente com IndexedDB ou Web Audio de baixo nível.
- **Módulos sem DOM.** Tudo em `modules/` é testável sem navegador renderizado.
- **Tipos no centro.** `core/types.ts` é a fonte única de verdade do modelo.

## Fluxo de dados (gravação)

```
Microfone → AudioWorklet (PCM cru) → VoiceRecorder → AudioClip (Float32)
   → clipStore (IndexedDB)  +  projectStore (metadados)
   → playback.ts (ouvir)  /  wav.ts (export sem perdas)
```

## Decisões técnicas

- **AudioWorklet em vez de MediaRecorder** para evitar compressão com perdas na captura.
- **Web Audio API nativa** para reprodução e (futura) mixagem offline (OfflineAudioContext),
  reaproveitando a mesma lógica para tocar ao vivo e para exportar.
- **Vite + TypeScript** para build modular, tree-shaking e tipagem forte.
- **vite-plugin-pwa (Workbox)** para o service worker e o manifesto.
