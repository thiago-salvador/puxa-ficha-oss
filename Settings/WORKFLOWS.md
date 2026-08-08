# Workflows

## Gate de entrada da task

Antes de planejar ou editar, responda em uma frase: "Como esta task aproxima o
Puxa Ficha da base mais completa e confiável possível sobre cada candidato?"

A resposta deve indicar um efeito verificável na cobertura, atualidade,
identidade, proveniência, publicação no frontend ou capacidade de manter esses
resultados. Registre também a menor prova que confirmará o avanço. Se não houver
ligação concreta com o objetivo, não execute a task.

## Mudança de código

1. Comece do `main` atual e limpo na pasta canônica.
2. Crie uma branch `codex/<objetivo>` quando a mudança precisar de isolamento.
3. Inspecione chamadores, schema, contrato público e testes antes de editar.
4. Faça a menor mudança que corrija a causa compartilhada.
5. Rode os gates proporcionais e um teste que falharia sem a correção.
6. Faça commit com Thiago Salvador como autor principal. Quando um agente
   produzir a mudança, registre-o em um trailer `Co-Authored-By` válido.
7. Abra PR sem fazer merge, salvo autorização explícita.
8. Depois do merge/deploy, confirme commit, deployment e comportamento público.

## Atualização de dados

1. Defina o universo por `SQ_CANDIDATO` ou outro identificador oficial aceito.
2. Declare fonte, escopo, resultado possível e política de erro.
3. Execute dry-run e confira cardinalidade, duplicatas e identidade.
4. Persista em lote fechado. Casos ambíguos vão para quarentena.
5. Registre a tentativa em `coleta_log`, inclusive falha ou ausência confirmada.
   Quando o passo 4 tiver escrito em tabela de produção, essa linha não é
   opcional nem manual: ela sai de `escreverAuditado()` e é conferida por gate.
   Ver "Escrita em produção fora de migration", abaixo.
6. Leia o banco diretamente e compare totais, somas e amostras.
7. Revalide apenas as tags públicas afetadas.
8. Leia a API e a ficha pública.
9. Rode `npm run audit:cobertura` e registre a nova lacuna ou ganho.

Esse fluxo é indivisível para a definição de concluído. Um pipeline funcional
que não altera a ficha é um pipeline ainda não integrado.

## Migrations

O ledger `supabase_migrations.schema_migrations` significa uma coisa só:
migration aplicada. Nada além disso entra nele. Execução de script de serviço,
correção pontual de dado, carga manual e conserto de emergência não viram linha
de ledger, nem quando seria conveniente ter um registro em algum lugar. Inserir
ou reescrever linha ali para registrar algo que não é migration, ou para
acomodar o nome de um arquivo, é mudar produção para salvar a aparência do
repositório, e foi assim que a issue #131 nasceu. A decisão e as alternativas
descartadas estão em
[`docs/arquivo/decisao-trilha-de-escrita-20260808.md`](../docs/arquivo/decisao-trilha-de-escrita-20260808.md).

O que precisa de rastro e não é migration vai para a trilha de escrita descrita
na próxima seção. São duas superfícies separadas de propósito, e nenhuma
substitui a outra: o ledger responde "que schema é esse", a trilha responde
"quem mexeu no dado".

- Migrations são sequenciais e nunca devem reescrever o histórico já aplicado.
- Antes de `db push`, compare os ledgers local e remoto.
- Use allowlist fechada das migrations esperadas.
- Dados e schema devem ter dry-run ou consulta equivalente antes da escrita.
- Pare diante de migration inesperada, identidade ambígua ou mudança de
  cardinalidade fora do planejado.
- Depois da aplicação, confira ledger, tabelas/views e superfície pública.

## Escrita em produção fora de migration

Toda escrita de operador em tabela de produção que não vem de uma migration
passa pelo helper `escreverAuditado()`, em
[`scripts/lib/escrita-auditada.ts`](../scripts/lib/escrita-auditada.ts).
"Escrita de operador" é o recorte exato da regra e da conferência: código de
`scripts/`, rodado por uma pessoa contra o banco de produção. Escrita de runtime
disparada por request do usuário final é outro regime, tratado em "O que fica
fora do recorte", abaixo. Ele
grava uma linha em `coleta_log` com `natureza = 'escrita'` carregando quem
executou (`fonte` e `execucao`), por que (`detalhe`, começando pelo motivo
declarado), qual tabela (`alvo`), quantas linhas o banco confirmou ter tocado
(`volume`) e quando (`executado_em` e `duracao_ms`).

Três propriedades do helper valem como contrato, não como detalhe de
implementação:

- **Volume é medido, não estimado.** A contagem sai do `.select()` encadeado na
  própria escrita. Payload de 300 linhas com `WHERE` que casa 12 é exatamente o
  caso em que estimativa vira mentira registrada.
- **Falha também deixa rastro.** Escrita que abortou grava `resultado = 'erro'`
  antes de a exceção subir. Sem isso, um `--apply` que quebrou na metade fica
  indistinguível de um `--apply` que nunca rodou.
- **Trilha que não grava derruba o processo.** É o oposto da regra de
  `scripts/lib/coleta-log.ts`, onde telemetria nunca mata o ingest. Ingest sem
  telemetria perde uma linha de relatório; escrita de operador sem trilha é o
  defeito da issue #131 acontecendo de novo.

### A regra deixou de ser só texto

O passo 5 de "Atualização de dados" manda registrar a tentativa em `coleta_log`
desde 04/08. Ninguém nunca conferiu, e a medição de 08/08 mostrou o resultado:
oito scripts escreviam em tabela de domínio sem passar por trilha auditada, e um
deles é o caso 1 da própria issue #131. Desses oito, sete não mencionavam
`coleta_log` em lugar nenhum do arquivo; o oitavo, `backfill-cpf-tse.ts`,
registrava, mas como coleta, sem dizer o motivo nem quantas linhas mudou. Regra
escrita e não conferida é regra que não existe.

Os oito foram migrados para o helper na mesma rodada. A medição de
`auditarRepositorio()` sobre o repositório inteiro passou a dar **zero
inadimplentes** em 270 arquivos lidos, com 30 exceções declaradas e nenhuma
obsoleta.

A conferência agora é mecânica e mora em dois arquivos:

- [`scripts/audit/lib/escrita-auditada-gate.ts`](../scripts/audit/lib/escrita-auditada-gate.ts)
  varre os `.ts` dos recortes declarados em `RECORTES_AUDITADOS`, hoje `scripts/`
  e `src/`, e detecta escrita que não passa pelo helper. A unidade de detecção é
  a cadeia de chamadas a partir de `.from(...)`, não o verbo isolado:
  `crypto.Hash#update` e `Map#delete` não são escrita em banco, e um gate que os
  acusasse seria desligado na primeira sexta-feira.
- [`tests/escrita-auditada-gate.test.ts`](../tests/escrita-auditada-gate.test.ts)
  roda essa varredura contra o repositório real e trava a lista de arquivos
  inadimplentes. Arquivo novo na lista exige decisão humana; arquivo que saiu da
  lista derruba o teste até alguém tirá-lo de lá. É essa trava que cobre a
  limitação conhecida da varredura, que é análise de texto e não de tipos.

### Isenções que o gate conhece, e por que cada uma existe

Estas vivem no código do gate, como constante exportada, e o teste as consome.
Nada entra sem motivo escrito.

- **Tabelas de trilha** (`TABELAS_DE_TRILHA`): escrita cujo alvo é `coleta_log`.
  Cobre `scripts/lib/coleta-log.ts`, que é a outra metade da trilha, e o próprio
  `scripts/lib/escrita-auditada.ts`, porque passar o helper por si mesmo é
  recursão. Não expiram.
- **Estado de ferramenta** (`TABELAS_DE_ESTADO_DE_FERRAMENTA`):
  `link_check_url_observacao`, escrita em toda execução inclusive dry-run, porque
  confirmar URL morta em duas rodadas é o algoritmo. Nada dela chega ao leitor.
- **Pipeline de coleta** (`PADRAO_PIPELINE_DE_COLETA`, que casa
  `scripts/lib/ingest-*.ts` e `scripts/lib/enrich-*.ts`): já deixam trilha, só
  não escrita pelo próprio módulo, porque `scripts/ingest-all.ts` registra o lote
  com `registrarColetaDeResultados()`. A isenção é verificada, não confiada: o
  teste confere que todo arquivo isento por esta classe declara um `source:` que
  `FONTES` conhece. Além disso, rotear ingest pelo helper faria telemetria matar
  coleta, que é o oposto da regra de ouro de `coleta-log.ts`.
- **Por forma do código**: alvo em tabela temporária (`tmp_*`, `temp_*`,
  `_temp`) e cliente cujo identificador diz `local`, `test`, `fixture`, `stub`,
  `fake` ou `mock`, porque nenhum dos dois é estado publicado.

Nenhuma exceção é regex genérica sobre verbo: cada uma é entrada nomeada, com
motivo escrito ao lado, e `auditarRepositorio()` acusa exceção **obsoleta**, ou
seja, entrada que parou de escrever direto e ficou mentindo na lista. A lista não
cresce sozinha e também não pode envelhecer em silêncio.

### Escrita de runtime em `src/`

`src/` está dentro do recorte, não fora. Entrou porque o cron de notícias e as
rotas de alerta escrevem em produção tanto quanto um script, e deixar a superfície
de runtime fora seria um buraco do tamanho do app.

O que é exceção nomeada ali (`EXCECOES_DE_RUNTIME`, 8 entradas) são escritas
disparadas por request do usuário final sob consentimento, não por operador: as
rotas de alerta em `src/app/api/alerts/` (alvos `alert_subscribers`,
`alert_subscriptions` e `notification_log`), mais
`src/lib/analytics-launch-store.ts` e `src/lib/quiz-short-link-store.ts`. As
tabelas envolvidas não têm nenhuma ocorrência em `src/lib/api.ts`, logo estão
fora da superfície pública, e uma linha de trilha por request inundaria a tabela
que o gate lê, transformando trilha de operador em log de tráfego.

Separada dessas, `EXCECOES_DE_COLETA_EM_RUNTIME` cobre
`src/app/api/news/refresh/route.ts`, que já deixa trilha própria em `coleta_log`,
no mesmo contrato dos `ingest-*` de `scripts/lib`.

Consequência que continua valendo: escrita de operador nova que apareça em `src/`
é acusada pelo gate como qualquer outra, e só sai da lista com entrada nomeada e
motivo escrito.

### Ordem obrigatória de rollout

Esta é a parte que quebra produção se for ignorada, e é a única ordem aceita:

```text
1. aplicar 20260808120000_coleta_log_natureza_escrita.sql
2. conferir no banco: coluna natureza existe e coleta_log_ultima filtra por ela
3. só então rodar qualquer script migrado com --apply
```

A migration `20260808120000` cria `coleta_log.natureza` e recria a view
`coleta_log_ultima` com `where natureza = 'coleta'`. As duas coisas andam na
mesma migration porque a view é `distinct on` sem `where` e é servida na
superfície pública por `src/lib/api.ts`: acrescentar a coluna sem recriar a view
faria uma linha de escrita, por ser a mais recente do trio, aparecer para o
usuário final como "última tentativa de coleta".

**Se a ordem for invertida**, o estrago é pior do que uma falha limpa. O helper
executa a escrita de domínio primeiro e grava a trilha depois. Com a coluna
ausente em produção, o script migrado rodando com `--apply` grava o dado, o
insert da trilha falha por coluna inexistente, o helper lança e o processo morre.
Resultado: dado dentro, rastro fora, script interrompido no meio. É o defeito da
issue #131 produzido pela correção dela, e com o agravante de acontecer sem que
ninguém tenha feito nada errado no script.

**O que transforma isso em falha segura é o preflight, e ele já está no helper.**
Antes da primeira escrita de domínio, `escreverAuditado()` faz um `select` das
nove colunas que o insert da trilha realmente preenche (`natureza`, `fonte`,
`escopo`, `alvo`, `resultado`, `volume`, `detalhe`, `execucao`, `duracao_ms`),
com `limit(1)`. Sondar só `natureza` provaria menos do que o insert precisa.

Três propriedades desse preflight importam:

- **É leitura, não escrita.** Um insert de teste provaria a mesma coisa e
  deixaria lixo na tabela que o próprio gate lê.
- **É fail-closed.** Reprovou, a função `aplicar` não chega a ser chamada e nada
  de domínio é tentado. Não existe modo degradado que escreve sem trilha.
- **É memoizado por processo**, inclusive quando reprova. Script que escreve
  milhares de linhas não paga um round-trip por linha, e fail-closed não vira
  loteria por tentativa.

Com o preflight, a ordem invertida custa uma mensagem de erro antes de qualquer
mudança de dado. Sem ele, custaria uma escrita órfã. A ordem deixou de ser
cerimônia e virou propriedade verificável: o passo 3 falha sozinho se o passo 1
não aconteceu, sem depender de o operador lembrar da ordem.

Isso protege contra a coluna ausente, que é o modo de falha conhecido. Não
substitui os passos 1 e 2: o preflight prova que a trilha é gravável, não que a
view `coleta_log_ultima` foi recriada com o filtro certo. Essa parte continua
sendo conferência humana no passo 2.

## Curadoria editorial

Pesquisa, classificação, aprovação, aplicação e publicação são etapas distintas.
Nenhum item vai ao ar sem um `sim` explícito e individual quando a frente exigir
curadoria. A decisão deve preservar fontes por afirmação e o escopo pesquisado.

Use os comandos versionados de curadoria. Eles são dry-run por padrão e só
escrevem com `--apply`.

## Cobertura total do universo

Toda correção descoberta por amostragem deve virar uma consulta sobre as 194
fichas atuais, ou sobre o universo vigente quando ele mudar. O objetivo não é
corrigir o candidato que revelou o bug, mas a regra compartilhada e todos os
registros afetados.

Divida a execução por frentes independentes, como identidade, patrimônio,
histórico, justiça e renderização, quando elas não disputarem os mesmos arquivos
ou migrations. Integre e valide o conjunto no final.

## PR, Vercel e lançamento

- Repositório: `thiago-salvador/puxa-ficha-oss`.
- Branch protegida de integração: `main`.
- Projeto Vercel: `puxa-ficha`, região `gru1`, Node 24.x.
- Domínio canônico: `https://puxaficha.com.br`.

Antes de lançar:

```text
CI verde -> PR revisada -> merge conhecido -> deployment Ready
-> /api/deployment-info no commit esperado
-> APIs públicas -> páginas reais -> cobertura e smoke
```

Um status Ready sem readback é apenas prova de infraestrutura.

## Fechamento

No fechamento, informe qual avanço previsto aconteceu e qual prova o confirma.
Não conte arquivos, commits, buscas ou pipelines como progresso quando eles não
mudaram a completude, a confiabilidade ou a capacidade de sustentar as fichas.

Atualize `Settings/STATUS.md` quando houver mudança relevante de produção,
cobertura, automação, fonte ou risco. Registre trabalho significativo no log
canônico do projeto, quando existir, e na Daily Note operacional.
