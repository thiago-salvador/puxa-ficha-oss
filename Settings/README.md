# Settings do Puxa Ficha

Este diretório é a porta de entrada operacional do projeto. Ele existe para que
uma pessoa ou agente consiga entender o produto, mudar o código ou atualizar os
dados sem criar uma segunda verdade.

## Ordem obrigatória de leitura

1. [OBJECTIVE.md](OBJECTIVE.md): objetivo, escopo e definição de ficha completa.
2. [EXPECTED_BEHAVIOR.md](EXPECTED_BEHAVIOR.md): regras que não podem regredir.
3. [ARCHITECTURE.md](ARCHITECTURE.md): fluxo da aplicação e dos dados.
4. [SOURCES_AND_DATA.md](SOURCES_AND_DATA.md): fontes, identidade, estados e modelo.
5. [WORKFLOWS.md](WORKFLOWS.md): como desenvolver, coletar, publicar e verificar.
6. [AUTOMATIONS_AND_ENVIRONMENTS.md](AUTOMATIONS_AND_ENVIRONMENTS.md): ambientes,
   segredos e rotinas automáticas.
7. [STACK.md](STACK.md): ferramentas e versões suportadas.
8. [STATUS.md](STATUS.md): fotografia datada do estado atual e das lacunas.
9. [CANDIDATE_DATA_COMPLETENESS_WORKFLOW.md](CANDIDATE_DATA_COMPLETENESS_WORKFLOW.md):
   plano com gates para transformar auditorias e pesquisas em dados
   comprovados nas fichas de todo o universo.
10. [CANDIDATE_DATA_COMPLETENESS_EVAL.md](CANDIDATE_DATA_COMPLETENESS_EVAL.md):
    critérios pass/fail, graders, custo esperado e golden set do workflow.

## Hierarquia de autoridade

Em caso de divergência, use esta ordem:

1. Evidência atual da fonte primária e leitura direta da superfície pública.
2. Schema, migrations, código e testes do `main` atual.
3. Registro canônico de fontes em `src/data/methodology-sources.ts`.
4. Régua em `docs/cobertura-de-dados.md` e `npm run audit:cobertura`.
5. Este diretório.
6. README, comentários antigos, relatórios avulsos e memória de conversas.

`Settings/STATUS.md` é um snapshot, não uma fonte dinâmica. Quando o código, a
produção, as fontes ou a cobertura mudarem, ele deve ser atualizado no mesmo PR.

## Contrato de manutenção

- Toda task deve passar pelo filtro de contribuição ao objetivo descrito em
  `OBJECTIVE.md` antes de entrar em execução.
- Toda mudança estrutural atualiza o arquivo correspondente deste diretório.
- Toda nova fonte só pode ser anunciada quando existe dado publicado e uma
  superfície pública que o renderiza.
- Toda automação documentada deve existir de fato em `vercel.json`, GitHub
  Actions ou outro mecanismo versionado.
- Toda alteração de versão deve atualizar `package.json`, lockfile e `STACK.md`.
- Toda mudança relevante de cobertura deve atualizar `STATUS.md` com um novo
  snapshot gerado por `npm run audit:cobertura`.
- O teste `npm run settings:check` protege a presença e os vínculos mínimos
  desta camada.

## O que não pertence aqui

Segredos, credenciais, dumps, dados pessoais sensíveis, decisões editoriais por
candidato e resultados de execução extensos não devem ser copiados para esta
pasta. Use os mecanismos e registros canônicos citados nos documentos.
