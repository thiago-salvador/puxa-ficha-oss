# Status atual

Snapshot verificado em **06/08/2026**. Este arquivo descreve o estado observado
nessa data. Reexecute os gates antes de usá-lo como prova futura.

## Código, banco e produção

| Item | Estado verificado |
|---|---|
| Pasta local canônica | `/Users/thiagosalvador/Documents/Apps/Pessoal/puxa-ficha` |
| Branch de produção | `main` |
| Commit em produção | `0cf39b41` |
| Vercel | Deployment Ready, criado em 06/08/2026 às 13:19 BRT |
| Site | `https://puxaficha.com.br` responde 200 |
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

O `main` recebeu 132 commits por 80 PRs mergeadas, com 416 arquivos e 62
migrations SQL tocados. As principais frentes que chegaram ao código integrado
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
Ele está aguardando aprovação e separa auditoria e pesquisa paralelas da
integração, migrations, banco e release, que permanecem seriais e protegidos por
gates próprios.

Critério de saída:

```text
universo atualizado + nenhuma lacuna aplicável silenciosa
+ cache revalidado + readback público + CI verde
```
