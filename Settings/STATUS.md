# Status atual

Snapshot verificado em **08/08/2026**. Este arquivo descreve o estado observado
nessa data. Reexecute os gates antes de usá-lo como prova futura.

## Snapshot 08/08/2026: consolidação em uma branch e deploy

- **Uma branch local só, `main`.** A `codex/profiles-complete-2026` foi mergeada
  (`ae73df1`), junto com a PR #127 (`71264a9`). Dezessete branches remotas
  superadas foram apagadas, com o SHA de cada uma em
  `docs/arquivo/branches-apagadas-20260808.md`. Preservadas:
  `codex/lacunas-publicaveis-20260805`, `codex/reconciliacao-cobertura-zero`
  (PR #114) e `perf/ficha-em-cache` (PR #72).
- **Produção deixou de ser `0cf39b41`.** O deploy da consolidação subiu e a CI da
  `main` voltou a ficar verde pela primeira vez desde 06/08. O que a destravou
  foi `ec5ae2b`: o `npm audit` de produção reprovava por `nanoid <3.3.17`
  (GHSA-2v37-7h3g-55p8, severidade high), e o job `verify` é o único check
  exigido pela branch protection.
- **As 5 migrations da completude continuam fora do banco**
  (`20260807050000` a `20260807053000`). O código que as pressupõe está em
  produção e degrada com elegância: `isMissingVerificationColumnError` em
  `src/lib/api.ts` cai para `CANDIDATO_COLUMNS_LEGACY`. Estado deliberado, não
  esquecimento.
- **Correções de defeito nesta rodada:** `42703` (coluna inexistente) entrou em
  `NON_RETRYABLE_ERROR_CODES`, porque toda carga fria de ficha pagava 3
  tentativas com timeout antes do fallback que sempre funciona
  (`/candidato/lula` levava 20,9s; passou a 0,7 a 1,6s); os geradores de
  backfill de patrimônio passaram a aplicar `sanitizePublicText`, que faltava e
  fez a `20260807182000` reintroduzir marcadores `#NULO#` horas depois da
  limpeza; e `20260808032540` saneou os 9 itens que sobraram.

- **Divergência de ledger na migration dos marcadores, e o rename que a
  fechou.** Ela nasceu no repositório como `20260808010000` e foi aplicada pelo
  `apply_migration` do MCP da Management API, que carimba timestamp próprio em
  vez de usar o nome do arquivo. O banco registrou `20260808032540`, e o
  repositório passou a afirmar uma versão que nunca existiu em produção. A
  comparação entre o ledger remoto e `supabase/migrations/` na mesma data
  achou o par: 6 versões só locais e 1 só remota, sendo que a única remota tem
  o mesmo `name` e statements idênticos aos do arquivo local (md5 igual após
  normalizar comentário e espaço). As outras 5 só locais são as retidas da
  completude, divergência deliberada. O arquivo foi renomeado para
  `20260808032540`, porque quem tem razão sobre o que aconteceu é o banco;
  escrever no ledger para acomodar um nome de arquivo seria mudar produção
  para salvar o repositório. Terceiro caso do padrão da issue #131, registrado
  em `docs/arquivo/ledger-divergencia-20260808.md`.

- **O gate `@write` voltou a rodar, e agora existe guard de ledger.**
  `npm run audit:cobertura:allowlist` sem janela morria por exceção de parse. Não
  era um caso isolado: o parser rodado sobre as 373 migrations acusou quatro
  falhas distintas, e a quarta (`20260805137000`) era bug de parser de SQL, com
  `statementApos` sem entender dollar-quoting. O módulo ganhou a forma
  `chave=<literal>` para escrita endereçada por chave, que exige o literal ancorado
  no statement e joga essas escritas numa seção separada do relatório, rotulada
  como não verificável estaticamente. Anotação sem `chave=` cujo identificador não
  aparece no SQL continua reprovando. Em paralelo, `ledger-guard.yml` passou a
  comparar ledger e repositório por um invariante de três regras, com a função de
  comparação pura e coberta por 12 testes. Detalhe e verificação em
  `QA/2026-08-08-issue-131-ledger.md`.

- **Cinco correções de durabilidade (revisão das soluções do QA, 08/08).** A
  releitura das cinco tasks olhou a forma da solução, não os números, e achou
  cinco coisas que iam doer depois:
  1. Contornar o ledger virou padrão (dois casos de escrita sem rastro). Virou a
     issue #131; depende do backup existir primeiro.
  2. O gate das 5 migrations retidas era só uma frase, e o timestamp delas é
     anterior ao de oito já aplicadas. Agora é mecânico:
     `tests/migrations-retidas-gate.test.ts` mais aviso no topo de cada arquivo.
  3. O selo `Destaque editorial` na legislação do Executivo prometia curadoria
     onde a seleção é regex de palavra-chave, e aquela tabela não tem campo
     editorial (medido: 4 de 14.061 linhas de `projetos_lei` têm curadoria real).
     Passou a `Relevância pública`, com regressão. O selo editorial de verdade
     segue na lista parlamentar, condicionado a `projeto.destaque`.
  4. A renomeação para Destaques criou dois números homônimos: a ficha conta
     todos os pontos públicos, a régua conta os visíveis menos os positivos. A
     coluna da régua passou a `Alertas (sem positivos)`, com teste de colisão.
  5. Limpeza de dado sem gate que impeça a volta. Agora existe
     `npm run audit:marcadores-tse:gate`, que reprova se `#NULO#` ou `#NE#`
     aparecer no recorte publicado.

- **Backup do banco: duas camadas, verificado em 08/08.** O Supabase já fazia
  backup físico diário (Pro), com Point in Time e Restore to new project no
  painel; a afirmação anterior de que o projeto não tinha backup nenhum era
  falsa. O workflow `backup-db.yml` passou a funcionar no mesmo dia e entrega a
  segunda camada: dump lógico cifrado, guardado fora da conta Supabase, artifact
  de 17 MB com retenção de 14 dias e verificação `pg_restore --list` dentro do
  próprio run. O projeto não usa Supabase Storage, então o aviso de que backups
  não incluem objetos de Storage não se aplica.
- **O que continua sem cobertura:** reconstruir o banco a partir do repositório.
  Nenhum dos dois backups resolve isso, e é o escopo da issue #131.

### Correções de registro (auditoria de 08/08)

Afirmações destes documentos que não se sustentaram quando reconferidas:

- "readback confirmou zero marcador restante" (`QA/2026-08-07-resumo-sessao.md`)
  era falsa duas vezes: o readback do script rodava sem o filtro dos publicados,
  e a `20260807182000` reintroduziu marcadores depois da limpeza.
- "gates verdes" e "allowlist da execução OK": `npm run audit:cobertura:allowlist`
  falha hoje em qualquer recorte, por inconsistência preexistente em
  `20260805123929`. Continua em aberto.
- Números com deriva: régua "6 faltante / 27 n/a" mede hoje 5 e 28; gate de
  identidade "643 pares" mede 645; "29 linhas com a fonte nova" não fecha em
  nenhum recorte (o padrão exato dá 27).

## Snapshot 07/08/2026: patrimônio por eleição e candidaturas na trajetória

- Banco compartilhado: ledger reconciliado. Fantasma remoto `20260807144555`
  removido; `20260807054000` (neutralização judicial, já aplicada por fora)
  marcada no ledger. Aplicadas com allowlist fechada e readback:
  `20260807180000` (4 candidaturas oficiais nunca ingeridas: cintia-dias 2012;
  jayme-campos, jose-roberto-arruda e mailza-assis 2014), `20260807181000`
  (tabela `patrimonio_ausencia_oficial` + 48 ausências oficiais 2010-2024,
  confirmadas nos pacotes `bem_candidato` lidos de ponta a ponta, sem valor
  fabricado) e `20260807182000` (27 lacunas de bens 2006-2024 com fonte
  rastreável). Células de 2026 ficam de fora até o snapshot do TSE estabilizar.
- Migrations pendentes (pertencem ao gate de completude maior, não aplicadas):
  `20260807050000` a `20260807053000`.
- Código: eleição colapsada com posse volta a aparecer como candidatura no ano
  do pleito (81 casos ocultos pela regra de display); API pública expõe
  `patrimonio_eleicoes` por eleição aplicável (publicado, vazio_confirmado,
  nao_coletado); ficha exibe ausência oficial com fonte e data. 2.165 testes
  passando, gates verdes.
- Cobertura pós-apply (`npm run audit:cobertura`, produção read-only): índice
  médio 87,3; 39 fichas em 100; célula de patrimônio 94 ok / 67 parcial /
  6 faltante / 27 n/a; a régua agora mede patrimônio por eleição aplicável
  (>= 2006), não por presença.
- Ciclo 2026 fechado (migration `20260807183000`): 17 lacunas preenchidas com
  bens do pacote oficial `bem_candidato_2026` e 13 ausências oficiais
  registradas, todas declarando o snapshot 2026-08-04 (registros em fluxo;
  revalidar quando o TSE atualizar). Ausências oficiais totais: 61/61.
- Identidade (auditoria A2C): dos 29 slugs sem SQ no seed, 4 ganharam chave
  verificada (jose-estevao e samara-mineiro por rota CPF, SQs 2026 curados no
  seed; jarbas-soares e renan-santos em quarentena). Universo pré-2010
  auditado (2002-2008 por SQ+UF): 26 pares verificados, todos já cobertos na
  trajetória; nenhum SQ <= 2000 no seed dos publicados.
- Correção de dado falso: removidos os patrimônios 2008/2020 de jarbas-soares
  (homônimo, migração `20260807184000`); as candidaturas correspondentes já
  estavam despublicadas desde 05/08. Trilho 1 de prospecção de chaves (07/08):
  nenhuma chave nova para os bloqueados (as varreduras tse-cpf/tse-historico
  já tinham confirmado ausência em 2010-2026), mas encontrou reincidência do
  homônimo de renato-gomes (candidaturas 2008/2020 reinseridas por ingestão
  após a remoção de 05/08) — removida de novo pela migração `20260807185000`.
  Causa raiz pendente: a ingestão não respeita bloqueio de identidade
  registrado. cadu-xavier 2020 segue corretamente despublicado.
- Produção: commit `0cf39b41` segue no ar; dados novos revalidam sozinhos na
  janela de cache de 3600s; merge/deploy da branch
  `codex/profiles-complete-2026` permanece no gate de completude.
- Bloqueios remanescentes: 25 slugs sem rota de casamento exata — prospectados
  em fonte_dados/redes/site/coleta_log/migrations sem chave alguma; são
  pré-candidatos 2026 sem registro oficial no snapshot ou com ausência
  confirmada em 2010-2026. Destrave por re-scan pós-janela de registro do TSE
  (set/2026) ou por curadoria fornecendo uma chave oficial por pessoa.
  renan-santos com linha 2022 de homônimo em quarentena (decisão editorial);
  jarbas-soares em quarentena de identidade; rui-costa-pimenta 2002/2006 com
  UF=BR (candidaturas presidenciais, exceção estrutural da regra de UF, já
  cobertas na trajetória).

## Snapshot 06/08/2026 (anterior)

Snapshot verificado em **06/08/2026**. Este arquivo descreve o estado observado
nessa data. Reexecute os gates antes de usá-lo como prova futura.

## Código, banco e produção

| Item | Estado verificado |
|---|---|
| Pasta local canônica | `/Users/thiagosalvador/Documents/Apps/Pessoal/puxa-ficha` |
| Branch de produção | `main` |
| Commit em produção | `0cf39b41` |
| Vercel | Deployment Ready, criado em 06/08/2026 às 13:19 BRT |
| Site | `https://puxaficha.com.br` e `/api/deployment-info` responderam no início da execução `pf-completeness-20260807T022551Z` |
| Universo público | 194 slugs únicos em `/api/candidato-slugs` |
| Coorte | 11 Presidente, 164 Governador e 19 Vice-Governador, cobrindo 27 UFs |
| Migrations | 360 locais e remotas; zero diferença de ledger |
| Checkout consolidado | Um worktree e uma branch local antes desta documentação |

## Cobertura pública

Resultado de `npm run audit:cobertura` contra produção em modo somente leitura:

- índice médio: 87,9;
- 60 fichas com índice 100;
- 134 fichas abaixo de 100;
- 191 fotos, 189 bios, 173 conjuntos de redes e 190 fichas com notícias;
- lacunas explícitas: 3 fotos, 5 bios, 21 redes, 13 patrimônios aplicáveis,
  21 financiamentos aplicáveis e 4 fichas sem notícias;
- somente 35 fichas têm votações publicadas; 11 estão sem dado aplicável e 148
  não se aplicam segundo a régua atual;
- posições do quiz: 5 completas, 6 parciais e 183 não aplicáveis.

Esses números não significam cobertura editorial completa. `partial` continua
dívida. Estados de zero precisam de procedência. A régua também documenta
limitações de aplicabilidade, qualidade de foto e dados pessoais ainda não
medidos no índice.

## O que mudou na carga de 30/07 a 06/08

O `main` recebeu 132 commits por 80 PRs mergeadas, com 431 arquivos únicos e 47
migrations únicas no intervalo reconciliado. As principais frentes que chegaram ao código integrado
foram:

- régua única de cobertura, procedência por fonte e `coleta_log_ultima`;
- gates de identidade, homônimos, CPF e `SQ_CANDIDATO`;
- ingestões históricas e normalização de cargos e partidos;
- curadoria e reconciliação de processos, sanções e outras frentes sensíveis;
- correções de patrimônio, financiamento e doadores;
- refresh de notícias com lotes, `execution_id`, cursor, recuperação e
  idempotência;
- coleta de Wikipedia/Wikidata e proteção de dados curados;
- indicadores da home ampliados para o universo publicável;
- segurança, observabilidade, cache, acessibilidade e revisão ampla do produto.

O resultado real da semana é infraestrutura de dados e muitos ganhos de
cobertura, mas não a conclusão do objetivo. As 134 fichas abaixo de 100 e as
limitações da régua provam que ainda existem lacunas. Parte do trabalho entregue
em scripts, migrations ou PRs ainda precisa de confirmação na ficha pública.

## Trabalho ainda aberto

| PR | Estado em 06/08/2026 | Leitura operacional |
|---|---|---|
| [#127](https://github.com/thiago-salvador/puxa-ficha-oss/pull/127) | Bloqueada | Preservar redes curadas no merge de Wikidata. |
| [#114](https://github.com/thiago-salvador/puxa-ficha-oss/pull/114) | Conflitante | Reconciliação de cobertura zero precisa ser refeita sobre o `main` atual. |
| [#72](https://github.com/thiago-salvador/puxa-ficha-oss/pull/72) | Draft e atrasada | Cache da ficha precisa de decisão ou encerramento. |

Os checks recentes do GitHub não estavam totalmente verdes, incluindo execuções
de CodeQL e CI. Este snapshot não atribui causa sem diagnóstico específico.

## Próximo marco

O próximo marco não é "rodar mais buscas". É transformar a régua em uma fila
fechada por ficha e frente, corrigir causas compartilhadas, integrar cada dado
até o componente público e reduzir a zero os campos aplicáveis sem conclusão.

O plano de execução está em
[`CANDIDATE_DATA_COMPLETENESS_WORKFLOW.md`](CANDIDATE_DATA_COMPLETENESS_WORKFLOW.md).
As Etapas 0 a 5 foram aprovadas e concluídas na execução
`pf-completeness-20260807T022551Z`, na branch local
`codex/profiles-complete-2026`. A baseline e a reconciliação da semana foram
concluídas. A auditoria global somente leitura fechou seis manifestos com
194/194 candidatos cada; a pesquisa dirigida fechou 4.923 propostas/estados.
A integração local preparou com segurança 294 financiamentos, 39 patrimônios, 3.595 links de
projetos, 45 pedidos de registro de 2026, 43 conjuntos de redes e metadados de
verificação para 194 fichas. O ledger bruto tinha 342/41, mas 49 conflitos e um
financiamento com SQ divergente foram bloqueados. Typecheck, 2.119 testes,
build, allowlist 12/12, identidade 642/642 e o self-test 30/30 passaram. Três
verificadores independentes aprovaram o código e as migrations no escopo local.
Banco, publicação editorial, merge, deploy e email continuam protegidos pelos
gates e não receberam autorização de aplicação em produção. O próximo passo é
o segundo gate da Etapa 6, com aplicação ordenada e readback real.

Critério de saída:

```text
universo atualizado + nenhuma lacuna aplicável silenciosa
+ cache revalidado + readback público + CI verde
```

[codex-stamp: log feito pelo Codex; Claude deve ignorar se nao for util ou incorporar se fizer sentido]
