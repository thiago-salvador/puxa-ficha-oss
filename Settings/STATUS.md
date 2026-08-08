# Status atual

Snapshot verificado em **07/08/2026** (workflow `pf-patrimonio-20260807T170643Z`).
Este arquivo descreve o estado observado nessa data. Reexecute os gates antes
de usá-lo como prova futura.

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
