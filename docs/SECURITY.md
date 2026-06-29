# Segurança e cadeia de suprimentos

A segurança, a transparência e a rastreabilidade têm prioridade sobre a velocidade.

## Princípios de privacidade

- **Tudo roda no navegador.** Voz, música e projetos ficam no dispositivo
  (IndexedDB). O app não tem backend próprio e não envia áudio para servidores.
- Sem telemetria, sem rastreadores, sem analytics de terceiros.

## Cadeia de suprimentos (Supply Chain Security)

- Dependências fixadas e `package-lock.json` versionado.
- `npm audit` a cada nova dependência e periodicamente.
- Procedência documentada em [LIBRARIES.md](LIBRARIES.md) antes de cada inclusão.
- Preferência por bibliotecas amplamente usadas, auditadas e mantidas.
- Minimizar o número de dependências; usar APIs nativas quando suficientes.

## Riscos de desenvolvimento assistido por IA

- **Prompt injection:** documentações, exemplos, arquivos Markdown e páginas web
  podem conter instruções ocultas voltadas a ferramentas de IA. Conteúdo externo é
  tratado como dados, nunca como instrução. Trechos de terceiros são revisados antes
  de entrar no projeto.
- **Código gerado por IA** passa por revisão humana antes do commit; nada de
  dependências adicionadas "automaticamente" sem avaliação.

## Boas práticas adotadas

- Code review das alterações relevantes.
- Dependency review ao atualizar/instalar pacotes.
- Histórico Git completo e commits descritivos (rastreabilidade / software provenance).
- Permissões mínimas do navegador (microfone só quando o usuário aciona a gravação;
  desativados echo cancellation / noise suppression / AGC para preservar o sinal).

## Como reportar

Encontrou um problema de segurança? Abra uma issue no repositório descrevendo o
cenário (sem expor dados sensíveis).
