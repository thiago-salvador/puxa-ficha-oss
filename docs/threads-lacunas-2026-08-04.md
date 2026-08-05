# Log das 6 threads de fechamento de lacunas (2026-08-04)

Log compartilhado das sessões que rodam em paralelo no plano de fechamento de
lacunas de dados. Cada thread trabalha no próprio git worktree, então **este
arquivo vive no checkout principal de propósito**, e não numa branch: é o único
caminho que todas as sessões enxergam enquanto o trabalho ainda não foi mergeado.

Caminho absoluto, para citar em prompt de outra sessão:

```
/Users/thiagosalvador/Documents/Apps/Pessoal/puxa-ficha-oss/docs/threads-lacunas-2026-08-04.md
```

## Como usar

- Ao **terminar** uma fatia que outra thread possa consumir, acrescente a entrada
  na seção da sua thread: o que ficou pronto, em que branch, e o contrato que os
  outros chamam (nome de tabela, de função, de arquivo).
- Ao **começar** algo que toca arquivo compartilhado, anote antes, para a próxima
  sessão não editar o mesmo arquivo às cegas. Os pontos quentes conhecidos hoje
  são `scripts/audit/lib/coverage-model.ts`, `scripts/audit/coverage-report.ts`,
  `scripts/ingest-all.ts` e `scripts/lib/types.ts`.
- Não reescreva entrada de outra thread. Acrescente abaixo, com hora.
- Migration nova: confira o prefixo de timestamp contra o que já está aqui antes
  de escolher o seu, porque duas threads criando migration no mesmo minuto geram
  ordem ambígua. Os prefixos `20260804160000` e `20260804170000` já estão usados.

## Estado das threads

**Todas as frentes estão na `main` desde 05/08.** A sessão de integração está
registrada no fim deste arquivo, na seção "Integração das 5 frentes". A tabela
abaixo guarda o estado de cada thread no fim do próprio trabalho dela, que é o
que as outras sessões consultavam; a coluna de PR diz onde cada uma foi parar.

| # | Assunto | Estado | Branch | PR |
|---|---|---|---|---|
| 1 | Log de proveniência de coleta | Mergeada | `worktree-coleta-log-proveniencia` | [#88](https://github.com/thiago-salvador/puxa-ficha-oss/pull/88) |
| 2 | Coleta dos 27 candidatos quase vazios de 03/08 | Mergeada | `data/escopo-slugs-e-27-candidatos` | [#87](https://github.com/thiago-salvador/puxa-ficha-oss/pull/87) |
| 3 | Relatório de cobertura | Mergeada, com a reconciliação resolvida | `worktree-cobertura-uma-regua` | [#89](https://github.com/thiago-salvador/puxa-ficha-oss/pull/89) |
| 4 | Falso positivo em massa no ingest de sanções, e auditoria do mesmo padrão | Mergeada | `claude/suspicious-panini-25734f` e `fix/ingest-guards-identidade` | [#85](https://github.com/thiago-salvador/puxa-ficha-oss/pull/85) e [#86](https://github.com/thiago-salvador/puxa-ficha-oss/pull/86) |
| 5 | Resgate dos pares duplicados e filtro de publicável nos ingests | Mergeada | `worktree-resgate-duplicados` | [#90](https://github.com/thiago-salvador/puxa-ficha-oss/pull/90) |
| 6 | (nunca preenchida) | | | |

> A linha 5 foi preenchida na integração de 05/08, a partir do relatório em
> `docs/resgate-pares-duplicados-2026-08-04.md`, que já existia. A 6 continua em
> branco: nenhuma sexta frente apareceu.
>
> **Aviso sobre a numeração:** a Daily Note do vault chama a thread do
> `coleta_log` de "Thread 6", e aqui ela é a 1. As duas numerações divergem desde
> o começo. Quem for cruzar os dois registros, cruze pelo assunto e não pelo
> número. A linha 2 acima foi ocupada por ser a primeira livre, e não porque o
> plano das 20:58 tenha chamado essa fatia de thread 2.

---

## Thread 1: log de proveniência de coleta

**Estado:** pronto. Branch `worktree-coleta-log-proveniencia`, commits `b11f2db` e
`95dccef`. As duas migrations já foram aplicadas no projeto de produção
(`wskpzsobvqwhnbsdsmok`). Os nove passos do job `verify` do CI passam.

### O problema que isso resolve

O banco guardava o que foi encontrado e nunca o fato de ter ido procurar. Com
isso, "zero" era ambíguo em 954 células do relatório de cobertura, e não havia
como provar a exigência do dono do projeto de que todo dado preenchível seja
preenchido: sem registro da tentativa, "verdadeiramente zero" é afirmação sem
prova.

O caso limite era sanções administrativas, vazias em 194 de 194 fichas. A causa
não era ausência de sanção: `ingest-transparencia-sanctions` avisava e voltava
quando faltava `TRANSPARENCIA_API_KEY`, e voltar sem escrever era indistinguível,
para quem lê o banco depois, de ter consultado os quatro cadastros e não achar
nada.

### O que existe agora

**`public.coleta_log`** (append-only, uma linha por tentativa) e a view
**`public.coleta_log_ultima`** (última tentativa por `fonte`/`escopo`/`alvo`).
Ambas sem grant para `anon` e `authenticated`; escrita é service role.

Colunas que interessam: `fonte`, `escopo` (`candidato` | `territorio` |
`global`), `alvo` (slug, UF ou `agregado_NNNN`), `candidato_id`, `executado_em`,
`resultado`, `volume`, `detalhe`, `url`, `execucao`, `duracao_ms`.

Cinco desfechos, mais um sexto estado que é a ausência de linha:

| Valor | Significa |
|---|---|
| `encontrado` | consultamos e veio dado (`volume` diz quanto) |
| `vazio_confirmado` | consultamos, a fonte respondeu, e respondeu vazio. **O único que autoriza dizer "é zero mesmo"** |
| `nao_aplicavel` | a pergunta não cabe para este alvo, por regra declarada |
| `erro` | fomos buscar e não deu (credencial, HTTP, pré-requisito). **Nunca é zero** |
| `indeterminado` | escreveu zero linhas e não sabe dizer se a fonte veio vazia ou se a consulta falhou |
| *(sem linha)* | **nunca verificado**. Lê-se pela negativa |

`indeterminado` é um quinto valor além dos quatro do escopo original, e é
deliberado: vários ingests engolem falha de rede num `catch` que devolve lista
vazia, e chamar isso de zero repetiria, em campo novo, o erro que a tabela veio
corrigir. **Todo `indeterminado` no relatório é dívida com endereço:** é um
ingest que ainda precisa declarar o próprio desfecho.

### Consulta canônica

```sql
-- Quais candidatos nunca foram verificados para a fonte X
select c.slug, c.nome_urna
  from public.candidatos c
 where not exists (
   select 1 from public.coleta_log l
    where l.escopo = 'candidato'
      and l.alvo   = c.slug
      and l.fonte  = 'transparencia-sanctions')
 order by c.nome_urna;

-- Situação por candidato, separando o zero provado do zero presumido
select c.slug,
       coalesce(u.resultado, 'nunca_verificado') as situacao,
       u.executado_em, u.detalhe
  from public.candidatos c
  left join public.coleta_log_ultima u
    on u.escopo = 'candidato' and u.alvo = c.slug and u.fonte = 'transparencia-sanctions';
```

### Números medidos no banco de produção (2026-08-04 21h)

Sobre os 280 registros da tabela `candidatos` (não sobre o recorte de 194
publicáveis; quem precisa do recorte filtra por `candidatos_publico`):

| Fonte | Nunca verificado | Encontrado | Zero provado |
|---|---:|---:|---:|
| `transparencia-sanctions` | **280** | 0 | **0** |
| `google-news` | 280 | 0 | 0 |
| `tse-historico` | 280 | 0 | 0 |
| `ceaps-senado` | 270 | 10 | 0 |
| `senado` | 254 | 26 | 0 |
| `camara` | 216 | 64 | 0 |
| `tse` | 50 | 230 | 0 |

Ou seja: as 194 fichas com sanções vazias **nunca foram consultadas**. Não foram
consultadas e vieram limpas. Nenhum zero provado existe hoje no banco, para
nenhuma fonte, porque nenhum ingest instrumentado rodou ainda.

### Contrato para quem for chamar

**Ingests.** O registro acontece em `runIngestTask`, em `scripts/ingest-all.ts`,
um ponto só. É por onde passam os três comandos do `.github/workflows/ingest.yml`,
então cobre os 20+ ingests e os que vierem depois. **Não** espalhe a chamada pelos
ingests: fonte nova sem rastro por esquecimento é o modo de falha que o log
existe para expor.

O que um ingest faz por conta própria é só o que aquele ponto não consegue saber:

- declarar `coleta_resultado` (campo novo, opcional, em `IngestResult`) quando
  sabe distinguir "a fonte respondeu vazio" de "a consulta falhou";
- chamar `registrarColetas` quando volta **antes** de montar resultado nenhum
  (o caso da credencial ausente).

Helper: `scripts/lib/coleta-log.ts`. Exporta `registrarColeta`,
`registrarColetas`, `registrarColetaDeResultados`, `FONTES` (mapa fonte para
escopo) e `montarLinhas`. **Falha de log nunca derruba ingest:** toda escrita é
try/catch com aviso no stderr.

**Relatório de cobertura (thread 3).** A régua em
`scripts/audit/lib/coverage-model.ts` **não foi tocada**, para não colidir com
quem tem esse arquivo. O que está pronto para ser plugado:

- `scripts/audit/coverage-snapshot.sql` já traz o campo `coleta`, um objeto
  `fonte -> { resultado, volume, executado_em, detalhe }` por candidato;
- `scripts/audit/lib/coleta-proveniencia.ts` é puro e testado, e expõe
  `FONTES_POR_COLUNA` (mapa das 23 colunas para as fontes que as alimentam),
  `provenienciaDaColuna(coluna, coleta)` e `ROTULO_PROVENIENCIA`.

O veredito tem cinco valores: `coletado`, `zero_provado`, `nunca_verificado`,
`nao_sabemos` e `sem_ingest`. A precedência carrega opinião e está documentada no
arquivo: `nunca_verificado` ganha de `nao_sabemos` porque fonte que ninguém
tentou é trabalho pendente com endereço, e esconder isso atrás de "houve um erro"
faz parecer que já foram lá e não deu.

`sem_ingest` marca coluna que nenhum ingest preenche (processos judiciais,
posições do quiz, legislação do Executivo). Ali o vazio se resolve com trabalho
editorial, e cobrar coleta automatizada seria cobrar o que não existe.

Falta só a thread 3 decidir **como desenhar** isso na tabela, ou seja separar
visualmente o `zero` provado do `zero` presumido.

### O que mudou nos ingests

- **`ingest-transparencia-sanctions`**: `fetchSancoes` fazia `catch { return [] }`,
  então uma sanção real atrás de um HTTP 500 chegava com a mesma cara de "não tem
  sanção". Falha e vazio agora são tipos distintos, e o ingest só declara
  `vazio_confirmado` com os **quatro** cadastros respondendo. A falha de cadastro
  **não** entra em `result.errors` de propósito: `ingest-all` faz `exit(1)` com
  qualquer erro ali, e indisponibilidade parcial do Portal passaria a derrubar a
  ingestão inteira, o que não é o comportamento de hoje nem decisão desta thread.
- **Credencial ausente** (`sanctions` e `transparencia`): os dois voltavam mudos.
  Agora gravam uma linha de `erro` por candidato.
- **`ingest-transparencia`** declara `indeterminado`, porque é stub e não persiste.
- **`enrich-wiki-historico`** declara `nao_aplicavel`: categoria da Wikipedia não
  traz `periodo_inicio`, então a fonte estruturalmente não tem o que preencher.

### Backfill: o que se permitiu concluir, e o que não

330 linhas, em `tse`, `camara`, `senado` e `ceaps-senado`. Idempotente
(conferido em duas execuções, 330 linhas nas duas).

A única inferência aceita: se a **própria coluna `fonte`** da linha diz "TSE...",
então o TSE foi consultado para aquele candidato. A evidência está na linha, não
numa suposição sobre qual código poderia tê-la escrito. Por isso a atribuição
nunca foi "esta tabela é escrita pelo ingest X": `projetos_lei` tem 10.910 linhas
de 'Camara' e 2.051 de 'Senado', mas também 265 de 'ALEP Transparencia', 174 de
'SAPL ALEAM' e mais 20 origens de assembleia estadual que vieram de curadoria.

**Nenhuma linha de `vazio_confirmado` foi gravada pelo backfill**, para ninguém.
O banco de hoje não prova que alguém foi ao Portal e não achou sanção; só sabe
que a tabela está vazia. Quem não recebeu linha ficou como nunca verificado.

Fora do backfill de propósito: `processos` (curadoria de STF, MP-RJ e imprensa),
`noticias_candidato` (ingest e quatro migrations de curadoria, indistinguíveis
pela coluna `fonte`, que guarda o nome do veículo), `votos_candidato` e
`historico_politico`/`mudancas_partido` (vários escritores, sem coluna `fonte`),
e `indicadores_estaduais` (a coorte de UFs coletadas está no código, não no
banco; fica para o primeiro run instrumentado).

### Limitação em aberto

Não existe `.env.local` no repo, então esta sessão não teve a service role para
rodar um ingest de ponta a ponta. O helper foi provado inserindo **na tabela
real** o payload exato que ele monta (as duas constraints aceitaram, as linhas
foram apagadas depois), mas ninguém ainda viu um `npx tsx scripts/ingest-all.ts
sancoes` gravando de verdade.

**Primeira coisa a fazer quando houver credencial:** rodar esse comando e
conferir as linhas em `coleta_log`. Enquanto isso não acontece, todo número de
"zero provado" no relatório vai ser 0, o que está correto e não é bug.

### Armadilhas achadas no caminho, que valem para as outras threads

- **Worktree novo não tem `node_modules` próprio.** Imports resolvem subindo até
  a raiz, então `tsc` e os testes passam, mas `npm run check:dead-code` sai 1 com
  "Unused devDependencies" e o erro parece defeito do seu diff. Rode
  `ln -sfn ../../../node_modules node_modules` no worktree antes dos gates. Se um
  gate falhar no worktree e passar na main no mesmo commit, `git stash -u` e
  reconfirme antes de culpar o próprio código.
- **`npm run verify` não existe** como script do `package.json`. `verify` é o
  nome do **job** no `.github/workflows/ci.yml`, com nove passos: audit de deps
  de produção, lint, cspell da UI, typecheck, typecheck dos scripts, validate
  seed, gate das fotos, knip, testes, e build (a cobertura c8 roda como
  `continue-on-error`).
- **`candidatos` tem 280 linhas, não 194.** 194 é o recorte publicável. Toda
  contagem precisa dizer qual universo está usando; foi o que gerou o falso
  alarme de regressão das 20h30.
- Migration com `INSERT`/`UPDATE`/`DELETE` precisa da anotação `-- @write` acima
  do statement, e o parser em `scripts/audit/lib/pending-writes.ts` **exige que o
  statement mencione literalmente o valor de `ref=` ou `slug=`**. Anotação que
  não bate com o SQL vira exceção, não aviso.

---

## Thread 2: coleta dos 27 candidatos quase vazios de 03/08

**Estado:** pronto. **Sem commit e no checkout principal (`main`), não em
worktree**, o que é a primeira coisa a coordenar (ver "O que falta"). Os nove
passos do CI passam. Ninguém foi despublicado: 194 publicáveis antes e depois,
os 27 seguem `publicavel = true`.

**Escopo:** os 27 slugs publicados em 03/08 com ficha quase vazia. Nenhuma outra
sessão tocou neles nesta janela.

### O problema que isso resolve

Os 27 entraram no ar com zero processos, zero sanções, zero pontos de atenção e
26 dos 27 sem nenhuma notícia. A leitura fácil era "candidato pequeno não tem
dado". Estava errada: a maior parte do que faltava estava em fonte pública que o
pipeline já baixava e jogava fora.

### O achado que destravou a thread

`buildSQMap`, em `scripts/lib/ingest-tse.ts`, lê o `consulta_cand_2026` inteiro
e **guarda só o `SQ_CANDIDATO`, descartando o resto de cada linha**. O comentário
da função diz que ela existe para cruzar o CSV de bens, que só tem o SQ, e isso
está certo. O efeito colateral é que `DS_GENERO`, `DS_COR_RACA`,
`DS_ESTADO_CIVIL`, `NR_CPF_CANDIDATO`, `SG_UF_NASCIMENTO` e `DS_EMAIL` passam
pela memória do processo a cada execução e nunca chegam ao banco.

Com o CPF em mãos, o histórico deixou de depender de casamento por nome: varri
`consulta_cand` de 2010 a 2024 (oito pleitos, cerca de 4,2 milhões de linhas)
casando por CPF, que é identidade exata.

### O que existe agora

**Escopo por slug no pipeline inteiro.** `loadCandidatos()` em
`scripts/lib/helpers.ts` passou a honrar `PF_INGEST_SLUGS`. Como todos os
módulos de ingestão passam por essa função, um filtro num ponto só escopa a
coleta inteira. Slug inexistente **aborta**, porque erro de digitação silencioso
viraria coleta vazia com cara de sucesso.

**`scripts/lib/helpers.ts` é arquivo compartilhado.** Está na lista de pontos
quentes junto com `ingest-all.ts`. A mudança é aditiva (sem `PF_INGEST_SLUGS` o
comportamento é idêntico ao anterior), mas quem for editar o mesmo arquivo, veja
antes.

**`data/candidatos.json` também foi tocado**, em 12 pontos: `wikipedia_title`
para 7 candidatos, `tse_sq_candidato` de 2026 para 4 que não tinham, e o
`nome_completo` de `gilberto-vasconcelos` corrigido de "Gilberto Vasconcelos"
para "Gilberto Vasconcelos da Silva" (o nome truncado era o motivo de ele não
casar com o TSE). `npm run validate:seed` passa.

### Contrato para quem for chamar

```
PF_INGEST_SLUGS=slug1,slug2 npx tsx scripts/ingest-all.ts wikipedia wikidata
```

- Vale para **qualquer** fonte do `ingest-all.ts`, porque o filtro está em
  `loadCandidatos()` e não em módulo específico.
- Sem a variável, nada muda: roda nos 271 do seed.
- Slug fora do seed lança erro com a lista dos desconhecidos.
- É o jeito de mexer num lote sem tocar na ficha de quem outra sessão está
  curando no mesmo repositório.

### Números medidos no banco de produção (2026-08-04 22h30)

Nos 27, depois da coleta: 53 linhas de histórico político, 16 mudanças de
partido, 215 notícias, 50 de patrimônio, 37 de financiamento, 19 fichas com
gênero, cor/raça e estado civil, 22 com naturalidade, 19 com CPF, 7 biografias e
11 fotos reais no lugar do avatar de iniciais.

Antes da sessão, quase tudo isso era zero: 0 linhas de histórico, 0 de partido,
0 de financiamento, 0 de gênero, 0 de naturalidade, 0 de CPF, 0 de biografia, 0
de foto real, 20 notícias (todas de um candidato só) e 13 de patrimônio.

**Fotos oficiais do TSE 2026 estão no Wikimedia Commons**, com o
`SQ_CANDIDATO` no nome do arquivo (`2026 NOME CANDIDATO CARGO UF TSE (SQ).jpg`).
Buscar no Commons pelo SQ achou 8 das 19. O `DivulgaCandContas` ainda não
publicou nenhum candidato de 2026, então essa é a única rota de foto oficial
hoje. Resolução baixa (111x155 ou 161x225), abaixo do slot de 562x750, mas o
gate `audit:fotos` só mede arquivo em `public/candidates` e não `foto_url`
remota, então não há gate quebrado.

### O que não preenchi de propósito

Três casos em que a fonte oferecia dado e a resposta certa era deixar vazio:

1. **`carlos-machado`**: o nome casa com **cinco pessoas diferentes** no TSE
   (cinco CPFs, cinco datas de nascimento, vereadores em RS, SP e MG). Nenhuma
   verificável como o pré-candidato do PCB em SP. Histórico rejeitado inteiro.
2. **`guilherme-fonseca`**: casou com um vereador de Dores do Indaiá/MG pelo
   UNIÃO, contra um pré-candidato do PSTU em PE. Rejeitado.
3. **`luciana-gurgel`**: a Wikipédia afirma "atualmente é deputada estadual pelo
   Amapá". A lista oficial da ALAP não tem o nome dela (tem Hildegard Gurgel) e o
   TSE 2022 registra **suplente**. Não gravei `cargo_atual`. O único
   `cargo_atual` gravado na thread foi o da `alessandra-campelo`, conferido na
   Mesa Diretora no site da ALEAM, onde ela consta como secretária-geral.

Também descartei 27 das 238 notícias coletadas, por citarem homônimo: "José
Carlos Machado" de Sergipe, "Larissa Moraes" da Bahia, "Larissa Gaspar" do
Ceará, um Guilherme Fonseca português e outro do Rio em 2018.

### Erro cometido nesta thread, e revertido

**Rodei `ingest-all.ts sancoes` e ele gravou 729 linhas falsas**: as mesmas 27
sanções genéricas para cada um dos 27 candidatos, com `vinculo = 'direto'`, sem
`cnpj_empresa` e sem `numero_processo`, com órgãos sancionadores sem relação
nenhuma com eles ("Prefeitura Municipal de Gravataí/RS", "Prefeitura Municipal
de Birigui - SP", "CAMARA DOS DEPUTADOS").

Revertido na mesma sessão com `delete from sancoes_administrativas`. A tabela
voltou a 0 linhas, que era o estado dela em todo o projeto. Conferido depois do
delete: `pontos_atencao` seguem 249, `processos` seguem 30, `publicavel` segue
194.

É o mesmo defeito que a sessão das 22h17 diagnosticou pela causa raiz (o
parâmetro `cpfCnpj` não existe na API do Portal da Transparência e é ignorado em
silêncio, devolvendo sempre a primeira página). **A lição operacional aqui é
outra e vale para todas as threads: eu rodei o ingest antes de ler o que ele
faz.** Num site de checagem eleitoral, o custo de rodar primeiro e conferir
depois é atribuir sanção falsa a pessoa real.

### Rastro que não existe: nada desta thread foi para a `coleta_log`

Conferido depois de tudo: `coleta_log` tem só `tse` (última em 03/08),
`camara`, `senado` e `ceaps-senado`. **Nenhuma linha das rodadas de hoje**, que
incluíram `tse`, `wikipedia`, `wikidata`, `wikidata-politico`, `wiki-historico`,
`instagram`, `tcu`, `transparencia`, `camara`, `senado` e `ceaps-senado`.

O motivo é estrutural e não é descuido do helper: `scripts/lib/coleta-log.ts`
vive na branch `worktree-coleta-log-proveniencia`, que não foi mergeada, e esta
thread rodou no `main`, que não tem o arquivo.

**Consequência para a thread 3:** as células dos 27 que eu acabei de preencher
continuam sem procedência, e as que continuam zeradas seguem contando como
"nunca verificado" mesmo onde eu verifiquei e o vazio é verdadeiro. É o mesmo
buraco que a varredura de sanções das 22h17 deixou, agora em mais fontes. Quem
mergear a thread 1 primeiro e rodar de novo com escopo resolve os dois casos de
uma vez.

### O que falta

1. **Decidir onde este trabalho mora.** Está sem commit e no `main`, enquanto
   todas as outras threads estão em worktree. Enquanto não for commitado, uma
   sessão que rode `git checkout` ou `git stash` no checkout principal leva as
   mudanças junto. É o item mais urgente.
2. **Re-rodar as fontes com escopo depois do merge da thread 1**, para os 27
   ganharem linha em `coleta_log` e a cobertura passar a ler verificado em vez de
   nunca verificado.
3. **Redes sociais: 25 dos 27 seguem sem nenhum perfil.** É o maior bloco de
   "não achei" do relatório. Wikipédia, Wikidata e o enriquecimento de Instagram
   não resolveram, e eu não gravei palpite: perfil errado numa ficha eleitoral é
   dano a pessoa real. Precisa de fonte oficial (site de partido, página de
   Assembleia, material de campanha).
4. **Biografia para 20 dos 27.** Os 7 que têm vieram de verbete na Wikipédia. Os
   outros só têm notícia, e escrever biografia a partir de notícia exige decisão
   editorial que não tomei sozinho.
5. **Cidade de nascimento para 10.** O registro de 2026 só publica a UF, e o
   histórico deles não preenche o município.
6. **Os 8 sem registro no TSE 2026** (prazo até 15/08) destravam sozinhos quando
   protocolarem: gênero, cor/raça, estado civil, patrimônio e foto oficial
   chegam juntos. Vale re-rodar depois do prazo.
7. **`preta-lu` tem candidatura a deputada federal em 2022 apta no TSE cujo
   resultado vem como `#NULO`.** O projeto não grava histórico sem resultado, e
   eu segui a regra em vez de inventar desfecho. Falta apurar a votação.

### Armadilhas achadas, que valem para as outras threads

- **`npm run verify` não existe neste repositório.** O enunciado da minha thread
  pedia "verify passando com 9 gates". `npm run verify` devolve
  `Missing script`. Os nove gates são os passos do job do `ci.yml`: `npm audit
  --omit=dev --audit-level=high`, `lint`, `lint:spell:ui`, `typecheck`,
  `check:scripts`, `validate:seed`, `audit:fotos:gate`, `check:dead-code` e
  `npm test`. Rodei os nove, todos passam.
- **`zsh` não faz word splitting de variável sem aspas.** Um laço
  `for g in "run lint" ...; do npm $g; done` manda `run lint` como argumento
  único e devolve `Unknown command` nos nove gates seguidos, o que parece
  falha real do projeto e não é. Use array ou `${=g}`.
- **A busca da Wikipédia do pipeline usa `nome_urna`.** Para `larissa-rosado`
  isso vira a busca "Larissa" e para `baba`, "Babá". Nos dois casos existe
  verbete, e a busca por `nome_completo` acha na primeira tentativa. Foi assim
  que 7 verbetes apareceram depois de o pipeline ter dito que não havia nenhum.
- **O guarda de relevância das notícias tem furo.** Duas matérias entraram para
  `ismar-marques` sem o nome dele aparecer no título (eram sobre Elizeu Aguiar,
  o cabeça de chapa). Conferi título a título antes de gravar e descartei as
  duas. Quem for confiar em `splitNewsByCandidateMention` sem revisão, saiba que
  ele deixa passar matéria do cabeça de chapa.
- **`bem_candidato_2026` distingue "não declarou" de "declarou zero".** Quatro
  dos 19 registrados aparecem no arquivo com zero bens. Isso é achado (patrimônio
  verdadeiramente vazio), não lacuna, e o relatório classifica assim.
- **A prestação de contas de 2026 ainda não existe**: o zip devolve 404. Todo
  financiamento gravado nesta thread é de pleitos de 2010 a 2024.

---

## Thread 3: relatório de cobertura, uma régua só

**Estado:** pronto e verificado, **sem commit**. Branch
`worktree-cobertura-uma-regua`, worktree
`.claude/worktrees/cobertura-uma-regua`. Lint, typecheck e os 1.758 testes
passam. Tem uma reconciliação pendente com a thread 1, descrita no fim.

### O problema que isso resolve

Existiam duas medidas de cobertura concorrentes e elas discordavam, o que gerou
um falso alarme de regressão em 04/08. Além disso o script canônico não rodava
mais sozinho: o caminho que lia o banco pelo `supabase-js` foi removido em 02/08
e o que sobrou exigia colar o resultado do SQL num arquivo à mão.

### O que existe agora

**Um comando:** `npm run audit:cobertura`. Lê o banco, monta o HTML, grava o
snapshot ao lado e gera as páginas de revisão.

**Acesso ao banco:** a Management API do Supabase
(`POST /v1/projects/:ref/database/query`), a mesma que o MCP usa, sempre com
`read_only: true`. O modo é imposto pelo servidor, não por confiança no código:
mandei um `create table` de teste e voltou
`25006: cannot execute CREATE TABLE in a read-only transaction`.

Credencial, nesta ordem: `SUPABASE_ACCESS_TOKEN` no ambiente, senão o Personal
Access Token que o `supabase login` guardou no Keychain do macOS.

**A REST do projeto não serve, e o 403 era esperado.** `SUPABASE_URL` mais
service role key é PostgREST: expõe tabelas e RPCs declaradas, não SQL
arbitrário, e não aceita token de CLI. Quem for tentar de novo por ali vai bater
no mesmo muro.

Isso **não** reabre o caminho removido em 02/08. O que foi removido reimplementava
a régua em JS; `scripts/audit/lib/snapshot-fetch.ts` lê o `.sql` como texto e
manda o banco executar. O SQL segue sendo a única descrição dos fatos.

Documentação em `docs/cobertura-de-dados.md`, apontada do README.

### A régua conferida contra o banco

| Ponto | Verificação |
|---|---|
| Universo é só publicável | A entrada é a view `candidatos_publico`: 194, contra 280 na tabela crua |
| Quiz é só presidencial | Os 183 não-presidenciáveis (164 Governador, 19 Vice) saem `n/a`; os 11 presidenciáveis pontuam em x/3, só com `verificado = true`, que é o filtro do quiz |
| Colunas de achado fora do índice | O índice usa 15 das 23 colunas. Ficam fora as 6 de achado (sanções, contradições, processos, alertas, itens a revisar, projeto em destaque) e mais duas: cargos ocupados e histórico partidário |

O critério que une as oito vale escrever, porque a pergunta volta: elas medem o
mundo, não o nosso esforço. Governador sem sanção não tem ficha pior que o com
cinco, e contar sanção como preenchimento premiaria quem tem mais problema.

### Comparação com o relatório de 02/08: não houve regressão

O índice médio caiu de 84,0% para 75,8%, e é composição, não perda de dado:

| Recorte | 02/08 | 04/08 |
|---|---:|---:|
| Fichas medidas | 166 | 194 |
| Índice médio **nos 165 presentes nos dois** | 84,1% | **84,5%** |
| Índice médio das 29 fichas novas | | 26,1% |

Nos comuns, 35 células mudaram, cada uma com migration nomeada: 25 de fila de
revisão esvaziada (`quiz_posicoes_com_fonte`, `claims_desatualizadas_no_ar`,
`descartar_claims_sem_mandato_contraditorias`), 7 de posição de quiz com fonte
(PRs #51 e #52), e uma cada de `ac_governadores_votos_mailza`,
`ac_governadores_tse_thor_bens` e
`fontes_profundas_roberto_claudio_e_veredito_marcelo_brigadeiro`. As 29 novas são
16 vices de `politica_de_vice_registro_tse_2026` e 13 governadores de
`roster_governadores_convencoes_agosto_2026`; a que saiu foi wilson-witzel.

### Comparação com a página feita à mão, que causou o alarme

`~/.disposable-html/2026-08-04-cobertura-dados-por-estado.descartavel.html`.
Mesmo universo e mesmas 23 colunas, 838 células divergentes de 4.462. Fui ao
banco em cada grupo em vez de assumir que o script estava certo:

| Grupo | Células | Veredito |
|---|---:|---|
| Quiz cobrado de quem disputa Governador | 183 | página errada |
| Alertas contando `feito_positivo` | 14 | página errada, conferido linha a linha |
| "Não se aplica" cobrindo dado existente | 17 | página errada |
| Zero troca de partido tratado como lacuna | 35 | página errada |
| 3 processos de Helder Salomão | 1 | **sem origem**: `processos`, `sancoes_administrativas` e `pontos_atencao` dele têm 0, 0 e 1; não há linha duplicada com o nome dele |
| Financiamento e doadores escondidos como `n/a` | 46 | **script certo e mais duro**: os 23 têm `SQ_CANDIDATO` no seed, então já declararam ao TSE |
| Cargos, destaques, itens a revisar, posições | ~220 | definição diferente, as duas defensáveis |
| Foto | 132 | **a página mede algo que o script não mede** |

A página levou banner vermelho de aposentada, com os desvios listados.

### O que a página à mão tinha de melhor

Ela separa foto nossa no slot de 562x750, foto nossa em resolução baixa (12
fichas) e foto de terceiro hospedada por Wikimedia, Câmara, Senado ou TSE (120
fichas). O script só pergunta se `foto_url` existe e pinta as 132 de verde. Está
registrado nas limitações de `docs/cobertura-de-dados.md`; virar coluna é decisão
do dono do projeto.

### Defeito achado na régua, com o estrago medido

`cargo_canonico` gravado como `Candidatura a Vereador` não casa com a lista
`CARGOS_ELETIVOS`, que tem `Vereador`. São 185 linhas de histórico em 66 fichas
publicáveis nessa forma, e 33 fichas só têm eventos assim. Para elas
`declarouAoTse` dá falso e patrimônio e financiamento saem como "não se aplica"
em vez de lacuna.

Medi em vez de estimar, rodando a régua com e sem normalização do prefixo:
**atinge 1 ficha hoje** (`jarbas-soares`), porque as outras 32 são salvas pelo
`SQ_CANDIDATO` do seed. Cresce conforme entrar ficha nova sem SQ. Não corrigi:
está documentado e é decisão do dono.

### Contrato para quem for chamar

- `npm run audit:cobertura` para o relatório inteiro.
- `tsx scripts/audit/coverage-report.ts --from-snapshot=PATH` roda sem rede, com
  snapshot em disco. É o modo para teste e para máquina sem credencial.
- `scripts/audit/lib/snapshot-fetch.ts` exporta `obterSnapshot`, `obterColetas`,
  `consultar` e `resolverToken`. `consultar(sql, ref, token)` serve para qualquer
  leitura pontual em produção e já vai com `read_only: true`.
- A data do arquivo de saída passou a ser local, não UTC: rodando depois das 21h
  em São Paulo o nome saía com a data de amanhã e o corpo dizia hoje.

### Reconciliação pendente com a thread 1

**Duplicamos trabalho, e o certo é resolver antes de mergear as duas.** Quando
esta sessão começou, a branch da thread 1 tinha zero commits e `coleta_log` não
existia no banco, então implementei a procedência por conta própria. A thread 1
commitou e aplicou a migration no meio da sessão.

O que existe em dobro:

| Assunto | Thread 1 | Thread 3 |
|---|---|---|
| Mapa coluna para fonte | `FONTES_POR_COLUNA` em `scripts/audit/lib/coleta-proveniencia.ts`, 23 colunas | `FONTES_POR_COLUNA` em `scripts/audit/lib/coverage-model.ts`, só as 6 de zero |
| Veredito | `provenienciaDaColuna`, 5 valores | `provenienciaDoZero`, 6 valores |
| Leitura do log | campo `coleta` dentro de `coverage-snapshot.sql` | `scripts/audit/coverage-coleta.sql`, consulta separada com probe de `to_regclass` |
| Teste | `tests/coleta-proveniencia.test.ts` | `tests/coverage-proveniencia.test.ts` |

Não há conflito textual de git: os arquivos novos têm nomes diferentes e não
toquei em `coverage-snapshot.sql`. O que há é duas descrições da mesma coisa, que
é exatamente o problema que esta thread existiu para acabar.

**Proposta de resolução, na ordem:**

1. Fica o módulo da thread 1 (`coleta-proveniencia.ts`) como fonte do mapa e do
   veredito, porque cobre as 23 colunas e a precedência dele está melhor
   argumentada: `nunca_verificado` ganhando de `nao_sabemos` está certo, e a minha
   fazia o contrário.
2. Fica o campo `coleta` dentro de `coverage-snapshot.sql`, e o meu
   `coverage-coleta.sql` sai junto com `obterColetas`. Uma consulta é melhor que
   duas. **Ressalva:** a versão da thread 1 referencia `coleta_log_ultima` sem
   guarda, então o snapshot inteiro quebra em banco sem a migration. Em produção
   ela já está aplicada, então isso só custa em banco novo ou em rollback.
3. `coverage-model.ts` passa a chamar o módulo da thread 1 em vez da cópia local.
   O desenho na tabela (o traço colorido embaixo da célula, a legenda e as dicas)
   fica como está: é a parte que a thread 1 deixou explicitamente em aberto.
4. **Resolver duas discordâncias reais de mapa, com evidência e não por
   antiguidade.** Levantei quem escreve em cada tabela com grep e cheguei a
   fontes que o mapa da thread 1 não tem:
   - `cargos`: a thread 1 tem `tse-historico` e `wikidata-politico`; `ingest-senado`
     e `enrich-wiki-historico` também escrevem em `historico_politico`.
   - `alertas`: a thread 1 marca como `[]`, sem ingest; `ingest-jarbas`,
     `ingest-tcu` e `ingest-transparencia-sanctions` escrevem em `pontos_atencao`.

   A diferença importa: fonte a menos no mapa faz um zero ser declarado
   confirmado sem que todas as fontes tenham respondido.

### O que o log de coleta já mostra

Rodei o relatório contra a `coleta_log` real. Das 853 células zeradas com
procedência, **nenhuma é zero provado**: 477 nunca verificadas (194 de sanções,
165 de alertas, 91 de cargos, 27 de partidos) e 376 sem ingest nenhum
(191 de contradições, 185 de processos). As outras 155 células zeradas são "itens
a revisar", que é fila de trabalho e não leva procedência.

**Ponto para a thread das sanções.** A varredura das 22h17 confirmou zero sanções
em 98 candidatos com CPF, consultando CEIS, CNEP e CEAF. Conferi `coleta_log`
depois: ela só tem `camara`, `senado`, `ceaps-senado` e `tse`, nenhuma linha de
`transparencia-sanctions`. **O achado existe e o rastro não**, então o relatório
segue marcando as 194 como nunca verificadas, e está certo em marcar. Basta o
ingest registrar o desfecho para as 98 virarem verde sozinhas, sobrando os 96 sem
CPF como lacuna real.

### O que falta

1. **Commitar a branch.** Está tudo sem commit, e o worktree é a única cópia.
2. **A reconciliação dos quatro passos acima**, antes de mergear as duas threads.
   Mergear as duas como estão repõe a duplicação em escala menor.
3. Decidir sobre o prefixo `Candidatura a X` (1 ficha hoje) e sobre levar a
   qualidade da foto para o relatório canônico. As duas estão documentadas como
   limitação conhecida, nenhuma foi corrigida por conta própria.

### Armadilhas achadas, que valem para as outras threads

- **`check-report.ts` escolhe sozinho o HTML mais recente** em `~/.disposable-html`
  que case com `puxa-ficha-cobertura-dados`. Relatório gerado com `--out` de nome
  diferente não é conferido, e o script confere silenciosamente um arquivo antigo.
  A flag é `--report`, não `--html`.
- **Edit com caminho absoluto do checkout principal escreve no checkout
  principal, mesmo com a sessão dentro do worktree.** Aconteceu aqui: as primeiras
  edições em `coverage-report.ts` foram parar na main. Detectado com
  `git status` na main, copiado para o worktree e revertido com `git checkout --`.
  Rode `git -C <main> status` antes de fechar se tiver usado caminho absoluto.
- **Confirme que uma mudança de código é neutra rodando o mesmo snapshot antes e
  depois.** Fiz isso aqui e deu 0 células diferentes, o que separou o que mudei do
  que o banco mudou sozinho enquanto as outras threads trabalhavam. Sem essa
  checagem eu teria atribuído à minha mudança um deslocamento de 26 células que
  era escrita de outra sessão.

---

## Thread 4: falso positivo em massa no ingest de sanções, e auditoria do mesmo padrão

**Estado:** pronto, **commitado e com PR aberta**, em duas branches, entrada
escrita na madrugada de 05/08 (00h11). Os nove gates passam nas duas.

| Branch | PR | Commit | Escopo |
|---|---|---|---|
| `claude/suspicious-panini-25734f` | [#85](https://github.com/thiago-salvador/puxa-ficha-oss/pull/85) | `11ccda1` | correção do ingest de sanções |
| `fix/ingest-guards-identidade` | [#86](https://github.com/thiago-salvador/puxa-ficha-oss/pull/86) | `47776a4` | guardas em `jarbas` e `ceaps-senado`, sai de `main` |

**Escopo:** o defeito que a thread 2 encontrou ao rodar `ingest-all.ts sancoes`
e reverteu (as 729 linhas falsas), levado até a causa raiz e fechado em código,
mais a varredura do mesmo padrão em todos os outros ingests.

**Nenhuma migration criada**, então os prefixos `20260804160000` e
`20260804170000` da thread 1 seguem sendo os únicos usados.

### O problema que isso resolve

`?cpfCnpj=<cpf>` **não existe** em nenhum dos quatro endpoints de sanção do
Portal da Transparência. A API aceita a requisição, ignora o parâmetro que não
conhece **em silêncio** e devolve a página 1 da lista nacional inteira. Cada
candidato recebia os mesmos registros de gente e empresa sem relação nenhuma com
ele, gravados com `vinculo = 'direto'`.

O guarda de CPF nulo já existia e não protegia nada, porque o problema não era
quem consultava, era o que a consulta significava.

### A causa raiz, reproduzida contra a API antes de mexer no código

| Chamada | Retorno | |
|---|---|---|
| `ceis?cpfCnpj=00000000191` | 15 registros | filtro ignorado |
| `ceaf?cpfCnpj=00000000191` | 15 registros | filtro ignorado |
| `cepim?cpfCnpj=00000000191` | 15 registros | filtro ignorado |
| `ceis?codigoSancionado=00000000191` | 0 registros | filtro respeitado |
| `ceaf?cpfSancionado=00000000191` | 0 registros | filtro respeitado |

Parâmetro correto por endpoint, conforme `v3/api-docs`: `ceis` e `cnep` usam
`codigoSancionado`, `ceaf` usa `cpfSancionado`, `cepim` usa `cnpjSancionado`.

### O que existe agora

**Duas travas independentes, nenhuma confiando na outra**, em
`scripts/lib/ingest-transparencia-sanctions.ts`:

1. **Antes da rede.** Sem CPF válido (11 dígitos, dígitos verificadores
   conferidos), não faz requisição nenhuma e marca `skipped`. CPF mascarado
   vindo de outra fonte é recusado aqui.
2. **Sobre a resposta.** Todo registro tem o documento conferido contra o CPF
   consultado, e o que não casa é descartado com aviso, **mesmo a API tendo dito
   que filtrou**. CNPJ nunca casa com CPF, documento ausente nunca casa.

**A API publica CPF de pessoa física mascarado** (`***.435.151-**`), só os 6
dígitos do meio. Casamento por máscara passa a exigir que o nome também bata: 6
dígitos não identificam ninguém, e homônimo viraria acusação.

**CEPIM saiu do pipeline.** Só filtra por CNPJ e só devolve pessoa jurídica,
então o CPF de um candidato jamais poderia casar. Aquelas linhas eram ruído por
construção.

**Três defeitos achados no caminho, no mesmo módulo:** as interfaces não
correspondiam a nenhum campo do DTO real (`numerosProcesso` contra
`numeroProcesso`, um `ativo` que a API não tem, `nomeInformacaoSancao`
inexistente), datas `DD/MM/AAAA` iam cruas para coluna `DATE`, e o dedupe
comparava `numero_processo` nulo com string vazia, o que duplicava a cada
rodada porque `NULL` nunca é igual a `''`.

**Guardas de identidade em outros dois ingests** (PR #86, sai de `main`):
`conferirReembolsos` em `ingest-jarbas.ts` e `agregarDespesasDoAno` em
`ingest-ceaps-senado.ts`. Detalhe em "O que não mudei de propósito" e em
`docs/fontes-pendentes.md`, que ganhou a seção "Fontes com endpoint morto".

### Contrato para quem for chamar

O módulo de sanções passou a exportar núcleo puro, testável sem rede e sem
banco. Quem for instrumentar ou estender:

```ts
import {
  coletarSancoesDoCandidato,  // guard de CPF + conferência, com rede injetável
  conferirDocumento,          // "exato" | "mascarado" | "nao-confere"
  cpfEhValido,
  normalizarRegistros,
  parseDataBR,
} from "./lib/ingest-transparencia-sanctions"
```

- `coletarSancoesDoCandidato(cpf, nome, deps)` devolve
  `{ consultou, motivoSkip?, sancoes, descartes }`. `consultou: false` significa
  que o guard barrou **antes de qualquer requisição**.
- `deps.buscar(endpoint, documento)` é o ponto de injeção da rede. É aí que a
  thread 1 reaplica o `RespostaCadastro`, e não mais em `fetchSancoes`, que
  deixou de existir.
- `ConferenciaReembolsos` e `ConferenciaDespesas`, nos outros dois módulos,
  seguem o mesmo formato: `{ ok: true, ... } | { ok: false, motivo }`.

### Números medidos no banco de produção (2026-08-04 23h50)

Varredura corrigida rodada nos **271** do seed, 289 segundos:

| | |
|---|---|
| Consultados de verdade | 141 |
| Pulados antes da rede, sem CPF válido | 130 |
| Sanções gravadas | 0 |
| Registros descartados pela trava 2 | 0 |
| Falhas de rede | 0 |

Conferido no banco depois, e não só no log: `sancoes_administrativas` segue com
**0 linhas**. Zero descarte é o resultado esperado agora, porque com o parâmetro
certo a API devolve vazio em vez de devolver a lista nacional.

**O zero tem duas naturezas e o relatório não deve confundir:** para os 141
consultados é achado (foram procurados nos três cadastros e não têm nada); para
os 130 sem CPF é lacuna, e só o CPF do TSE fecha.

### O que não mudei de propósito

**`ingest-camara.ts` não recebeu linha nenhuma**, e a razão é medida, não
suposição. Testado em 05/08 contra `dadosabertos.camara.leg.br`:

- honra o filtro (`idDeputadoAutor=0` e `=999999999` devolvem 0 registros);
- **rejeita parâmetro desconhecido com erro**, em vez de ignorar em silêncio
  (`idDeputadoAutorX=204554` não volta lista).

É o oposto do Portal da Transparência. As rotas de gasto e voto usam path param
(`/deputados/{id}/despesas`), onde id errado dá 404 e não dado de outra pessoa.
Espalhar guarda ali seria custo sem risco correspondente.

### As duas fontes que eu ia blindar estão com o endpoint morto

Verificado com chamada real em 05/08, e registrado em `docs/fontes-pendentes.md`:

| Fonte | Verificação |
|---|---|
| `jarbas.serenata.ai` | HTTP 404 em todas as rotas, inclusive na raiz |
| `legis.senado.leg.br/dadosabertos/senador/{id}/despesas` | HTTP 404 com `No static resource`, enquanto `/senador/{id}` segue 200 |

Os dois ingests rodam sem erro visível e devolvem "sem dados", que no relatório
de cobertura é **indistinguível de "procuramos e não achamos nada"**. As guardas
ficam dormentes até a fonte voltar, e é justamente na volta que elas importam.

Isso interessa direto às threads 1 e 3: são duas fontes que o relatório trata
hoje como lacuna a preencher e que na verdade não têm mais de onde vir.

### Os 9 candidatos do banco que estão fora do seed

Achado lateral da varredura, que responde uma dúvida das threads 2 e 3. O banco
tem **280** candidatos e `data/candidatos.json` tem **271**. Como todo ingest
itera pelo seed, os 9 de fora não são coletados por ninguém.

Investigados: todos são linha legada de **2026-03-29** com `publicavel = false`,
invisíveis no site. Seis são presidenciáveis que saíram do seed (Pablo Marçal,
Boulos, Marina Silva, Jair Bolsonaro, Simone Tebet, Michelle Bolsonaro), um é
`eduardo-leite`, e **dois são linha duplicada de quem está publicado**:

| Órfã | Publicada | Notícias órfã contra publicada |
|---|---|---|
| `tarcisio` | `tarcisio-gov-sp` | 101 contra 399 |
| `fernando-haddad` | `haddad-gov-sp` | 0 contra 247 |

A ficha publicada é a mais rica nos dois casos, então **não há dado publicado
faminto**. O que existe é dado filho velho pendurado em linha órfã, pontos de
atenção incluídos, que nenhum ingest atualiza. Não é lacuna de cobertura, é
limpeza, e conversa com a branch `worktree-resgate-duplicados`.

### O que falta

1. **Mergear as duas PRs.** Não mergeei: a decisão é do dono do projeto. A #86
   sai de `main` e não toca o arquivo de sanções, então mergeia em qualquer
   ordem.
2. **A colisão com a thread 1, que é o item que precisa de coordenação.** A
   branch `worktree-coleta-log-proveniencia` reescreve
   `ingest-transparencia-sanctions.ts` (instrumentação da `coleta_log`) e ainda
   carrega o `cpfCnpj` quebrado. As duas **não mergeiam sozinhas**, porque a
   `fetchSancoes` que ela altera deixou de existir. Ordem decidida: a #85
   primeiro, e a thread 1 rebaseia em cima reaplicando o `RespostaCadastro`
   dentro do `ColetaDeps`. Não rebaseei por conta própria porque o worktree
   daquela thread está `locked`.
3. **Esta varredura não gravou linha em `coleta_log`**, pelo mesmo motivo do item
   anterior: o módulo só existe na branch da thread 1. Depois do rebase, vale
   re-rodar para os 141 consultados virarem `vazio_confirmado` em vez de nunca
   verificado.
4. **Os 130 sem CPF continuam inverificáveis.** Depende de obter CPF pelo TSE,
   que é a rota que a thread 2 abriu com o `buildSQMap`.
5. **Decidir o destino das duas fontes mortas.** Se Jarbas e CEAPS foram
   descontinuadas de vez, o certo é remover os ingests e os cards em vez de
   deixar código morto rodando. Não removi: é decisão de produto.
6. **Limpar as 9 linhas órfãs**, junto com a `worktree-resgate-duplicados`.
7. **O ponto de atenção de sanção continua sendo recusado pelo guard de fonte**
   (`motivoRecusaDeFonte`), porque a rota consultada é API autenticada e a fonte
   exibida precisa ser a página pública equivalente. Comportamento preservado de
   propósito, e a correção continua pendente como antes.

### Armadilhas achadas, que valem para as outras threads

- **API que ignora parâmetro desconhecido em silêncio é a armadilha central, e
  não se generaliza entre fontes.** O Portal da Transparência devolve a lista
  nacional; a Câmara devolve erro. Descobrir custa duas chamadas: uma com id
  impossível (deve voltar vazio) e uma com o nome do parâmetro adulterado (deve
  falhar). Vale rodar isso antes de confiar em qualquer endpoint filtrado por
  query.
- **Conferir a identidade do retorno é a única defesa que sobrevive a mudança de
  API.** Nome de parâmetro pode estar certo hoje e mudar amanhã. O que não muda é
  que o registro precisa ser da pessoa consultada.
- **CPF em API pública vem mascarado.** `***.435.151-**` tem 6 dígitos úteis, que
  são as posições 4 a 9. Comparação exata falha, e comparação só pela máscara
  aceita homônimo. Quem for casar CPF de fonte pública precisa das duas coisas,
  máscara e nome.
- **Endpoint morto chega ao pipeline como "sem dados".** Três ingests desta
  janela (`jarbas`, `ceaps-senado`, e o próprio `sancoes` sem credencial) tratam
  falha com `catch` e seguem, então fonte fora do ar é indistinguível de fonte
  vazia. É exatamente o buraco que a `coleta_log` da thread 1 existe para fechar,
  e o `indeterminado` que ela criou é a peça certa.
- **`TRANSPARENCIA_API_KEY` é lida antes de o `.env.local` ser carregado.** O
  carregamento acontece dentro de `scripts/lib/supabase.ts`, no primeiro acesso
  ao client. Como `ingestTransparenciaSanctions` checa a chave antes de tocar o
  Supabase, rodar direto devolve "chave nao definida" em 0.0s, com cara de
  configuração faltando. Exporte a env antes
  (`set -a; . ./.env.local; set +a`) ou toque o Supabase primeiro.
- **Worktree novo não tem `node_modules`**, e `knip` falha nele passando na
  `main` no mesmo commit. Linkar antes de acusar o próprio diff.
- **Prove o teste de regressão por mutação.** Afrouxei de propósito a conferência
  de documento e as guardas dos outros dois ingests: 2 testes caíram no primeiro
  caso e 6 no segundo, e voltaram a passar depois do revert. Teste de guarda que
  ninguém tentou quebrar não é evidência de nada.
- **Contagem de teste igual não significa arquivo não coletado.** `main` sozinha
  dá 1.748 testes e as duas branches dão 1.760, e por coincidência os dois
  arquivos novos têm 12 testes cada. Conferi com `git stash` antes de acreditar.

---

## Thread 5: resgate dos pares duplicados e filtro de publicável nos ingests

**Estado:** mergeada em 05/08, PR [#90](https://github.com/thiago-salvador/puxa-ficha-oss/pull/90).
Relatório completo em `docs/resgate-pares-duplicados-2026-08-04.md`; esta seção só
registra o que as outras threads precisam saber.

**Contrato que mudou para todo mundo:** os 17 ingests/enriches passaram a montar a
lista com `loadCandidatosPublicos()` (`scripts/lib/helpers-db.ts`), que cruza o
seed com a view `candidatos_publico`. O roster processado caiu de **271 para
194**. `loadCandidatos()` continua intacto e continua sendo a fonte do roster
completo para `validate-seed`, `persist-sq` e para a hipótese de republicação.

Os dois filtros compõem: `PF_INGEST_SLUGS` age dentro de `loadCandidatos()`, então
`PF_INGEST_SLUGS=a,b` com o roster publicável devolve a interseção, e um slug
publicável fora do ar não volta pela variável.

**Banco já aplicado** por script com service role, antes do merge. Nenhum DELETE,
nenhuma mudança de `publicavel`; arquivar foi mudar flag e status. Todo achado
migrado entrou com `verificado=false` e `visivel=false`, mesmo quando a origem
estava verificada.

**Cinco casos de `status` x `publicavel` inconsistentes** ficaram listados no
relatório e não foram corrigidos: são decisão do dono do projeto, não de coleta.

---

## Integração das 5 frentes (2026-08-05)

Sessão de integração, sem feature nova, sem coleta nova e sem migration nova. O
objetivo era só levar as cinco frentes para a `main` na ordem que não perde
trabalho, com os nove gates passando a cada passo.

### Ordem em que mergeou, e por quê

| # | PR | Frente | Por que nesta posição |
|---|---|---|---|
| 1 | [#87](https://github.com/thiago-salvador/puxa-ficha-oss/pull/87) | Escopo por slug e seed dos 27 | Estava **sem commit e solto no checkout principal**. Enquanto ficasse assim, um `git checkout` de outra sessão levava tudo junto. Era o item urgente, e virou o primeiro |
| 2 | [#85](https://github.com/thiago-salvador/puxa-ficha-oss/pull/85) | Correção do ingest de sanções | Reescreve `ingest-transparencia-sanctions.ts` por inteiro. Tinha que ir antes da thread do log, que instrumenta o mesmo arquivo |
| 3 | [#86](https://github.com/thiago-salvador/puxa-ficha-oss/pull/86) | Guardas em jarbas e ceaps-senado | Sai de `main` e não toca sanções; a ordem contra a #85 era livre |
| 4 | [#88](https://github.com/thiago-salvador/puxa-ficha-oss/pull/88) | Log de proveniência de coleta | Rebaseada sobre a #85, reaplicando a instrumentação no ponto novo |
| 5 | [#89](https://github.com/thiago-salvador/puxa-ficha-oss/pull/89) | Relatório de cobertura, com a reconciliação | Precisa do módulo da #88 em `main` para poder chamá-lo em vez de duplicá-lo |
| 6 | [#90](https://github.com/thiago-salvador/puxa-ficha-oss/pull/90) | Resgate dos pares duplicados | Toca 17 arquivos de ingest, que são os mesmos que todas as outras mexeram. Por último, por cima de tudo |

A ordem planejada foi seguida sem inversão. Os nove gates do job `verify` do
`ci.yml` passaram localmente em cada branch antes do push, e o `verify` do CI
passou em cada PR antes do merge.

### O que a integração precisou decidir, e não estava no plano

**A instrumentação de sanções mudou de lugar, não só de linha.** A #85 removeu
`fetchSancoes`, que era onde a thread do log punha o `RespostaCadastro`. O ponto
de injeção da rede passou a ser `ColetaDeps.buscar`, e é lá que a distinção entre
falha e vazio foi reaplicada: `buscar` devolve `{ok: true, registros} | {ok:
false, erro}`, `ColetaResultado` ganhou `falhas: string[]`, e o veredito ficou
falha em algum cadastro → `erro`, gravou → `encontrado`, nada com todos
respondendo → `vazio_confirmado`. Sem isso, um HTTP 500 no CEIS viraria
"candidato sem sanção" no relatório público, que é a mesma classe de erro do
falso positivo que a #85 corrigiu, só que na direção contrária.

**O guard de `to_regclass` não cabe dentro do SELECT.** A ressalva registrada na
thread 3 era que o campo `coleta` do `coverage-snapshot.sql` referenciava
`coleta_log_ultima` sem guarda. A correção não podia ser um `to_regclass` no
próprio comando: a relação é resolvida na análise, então a consulta falharia
antes de qualquer guarda de runtime rodar. O bloco ficou delimitado por
marcadores e `snapshot-fetch.ts` o remove quando a view não existe, depois de
sondar. Teste cobre o strip e cobra os marcadores, para renomeá-los não desligar
a degradação em silêncio.

**Dois furos de mapa confirmados contra o código**, como a thread 3 propôs:
`cargos` ganhou `senado` e `wiki-historico` (quatro escritores em
`historico_politico`, não dois), e `alertas` deixou de ser coluna derivada e
ganhou `jarbas`, `tcu` e `transparencia-sanctions` (três ingests escrevem em
`pontos_atencao`). Levantado com `grep 'from("<tabela>")' scripts/`, descartando
`fix-*`, `apply-*`, `backfill-*` e `link-check-*`, que são intervenção humana e
não registram tentativa.

**O caminho de credencial ausente passou a usar o roster publicável.** Depois da
#90, `registrarColetas` no caminho sem `TRANSPARENCIA_API_KEY` usa
`loadCandidatosPublicos()`, e não o seed inteiro: o log tem que registrar
tentativa de quem o pipeline teria consultado, senão inventa 77 lacunas que
ninguém tem intenção de fechar. O mesmo vale para `ingest-transparencia`.

**Uma ressalva de review virou correção.** O `agregarDespesasDoAno` da #86 só
descartava bloco com ano DIFERENTE do pedido: bloco com `NumAno` ausente, vazio
ou só espaço era somado na linha do ano pedido, sem entrar em `anosDescartados`.
É o mesmo defeito que a guarda existe para fechar, sem nem a evidência de qual
ano foi somado. Corrigido, com teste, e a assimetria contra `CodigoParlamentar`
ausente (que continua tolerado) ficou escrita no comentário.

**Destino dos `tmp-resgate-*`: renomeados, não removidos.** O knip não opina
sobre eles, porque `scripts/*.ts` é entry no `knip.json` e os três são entry
point com qualquer nome. A decisão foi por conteúdo: o de apply é idempotente por
marcador e documenta o que foi escrito em produção, e o de acervo é citado pelo
relatório como o jeito de regerar a lista dos inativos. Foram para a convenção
que o repo já usa (`apply-resgate-pares-duplicados.ts`,
`audit-resgate-pares-duplicados.ts`, `audit-acervo-nao-publicados.ts`), porque o
prefixo `tmp-` prometia um descarte que não vai acontecer.

### Um defeito que só aparecia com as frentes juntas

`entradaDeResultado`, em `scripts/lib/coleta-log.ts`, descartava qualquer
`IngestResult` com `skipped` **antes** de olhar o `coleta_resultado`. Existem
duas puladas no pipeline e elas não são a mesma coisa:

| Pulada | Declara desfecho? | O que significa |
|---|---|---|
| `ingest-camara`, incremental | Não | "o dado já estava coberto, não fui buscar". Gravar sobrescreveria em `coleta_log_ultima` a última tentativa real |
| `ingest-transparencia-sanctions`, CPF ausente ou inválido | **Sim**, `erro` com o motivo | "não dá para consultar este candidato". A declaração era jogada fora em silêncio |

Medido na primeira varredura: 194 publicáveis processados, **98 linhas gravadas
e 96 candidatos sem nenhuma**. Os 96 não têm CPF válido e apareciam como "nunca
verificado", indistinguíveis de quem só está na fila. Separar lacuna com
endereço de trabalho pendente é a razão de ser da tabela, e era exatamente esse
caso que se perdia.

Corrigido em [#91](https://github.com/thiago-salvador/puxa-ficha-oss/pull/91): a
declaração ganha de `skipped`, e `skipped` sem declaração segue sem virar linha.
A regra 2 do próprio comentário da função já dizia isso; a ordem do código fazia
o contrário. `ingest-camara` é o único outro que seta `skipped` e nunca declara
desfecho, então o comportamento dele não muda.

### Verificação de ponta a ponta, no checkout principal

**Os nove gates do job `verify`** (`npm run verify` não existe; são os passos do
`ci.yml`): `npm audit --omit=dev --audit-level=high`, `lint`, `lint:spell:ui`,
`typecheck`, `check:scripts`, `validate:seed`, `audit:fotos:gate`,
`check:dead-code` e `npm test`. **9/9 PASS** na `main` final, e 9/9 em cada
branch antes de cada push.

**Estado do banco, conferido depois de tudo:** 280 candidatos, 194 publicáveis,
0 sanções, 260 pontos de atenção, 30 processos. Nada despublicado, nada
deletado.

**Linhas novas em `coleta_log`, por fonte** (rodadas de 05/08, madrugada):

| Fonte | Linhas | Candidatos | Encontrado | Zero provado | Erro | Indeterminado |
|---|---:|---:|---:|---:|---:|---:|
| `transparencia-sanctions` | 294 | 194 | 0 | 198 | 96 | 0 |
| `tse` | 73 | 16 | 73 | 0 | 0 | 0 |
| `wikipedia` | 27 | 27 | 4 | 0 | 0 | 23 |
| `wikidata` | 27 | 27 | 1 | 0 | 0 | 26 |

As 294 de sanções são três passadas (um smoke test de 2 slugs, a varredura antes
da correção do `skipped` e a varredura depois). O estado que vale é o da view
`coleta_log_ultima`: **194 de 194 publicáveis com linha, 98 `vazio_confirmado` e
96 `erro`**. Antes destas rodadas o banco tinha 330 linhas, todas `encontrado`,
vindas do backfill, e **nenhum zero provado para fonte nenhuma**.

`tse` cobriu 16 dos 27 porque só esses têm registro ou histórico no TSE; os 8 sem
registro de 2026 destravam sozinhos quando protocolarem (prazo 15/08). São 73
linhas para 16 candidatos porque o ingest do TSE devolve mais de um
`IngestResult` por candidato (perfil, patrimônio, financiamento).

**Os 49 `indeterminado` de `wikipedia` e `wikidata` são dívida com endereço**, no
sentido exato que a thread 1 definiu: os dois ingests terminam sem escrita e sem
declarar desfecho, então o log não sabe dizer se a fonte veio vazia ou se a
consulta falhou. Não foi corrigido nesta sessão: é mudança de comportamento de
ingest, não de integração.

**Relatório de cobertura** (`npm run audit:cobertura`, contra o banco real):

| Procedência do zero | Células | Onde |
|---|---:|---|
| `sem_ingest` | 376 | contradições 191, processos 185 |
| `nunca_verificado` | 283 | alertas 165, cargos 91, partidos 27 |
| (sem procedência) | 154 | itens a revisar, que é fila de trabalho |
| **`zero_provado`** | **98** | sanções |
| `nao_sabemos` | 96 | sanções, dos candidatos sem CPF |

Antes: 853 células zeradas com procedência e **nenhum zero provado**, 477 nunca
verificadas. Agora as 194 células de sanções saíram de "nunca verificado" para
uma afirmação: 98 são zero de verdade, e 96 são lacuna que só o CPF do TSE fecha.

## O que ficou de fora, e por quê

Nada do plano de integração ficou pendente. O que segue aberto é trabalho que
não era desta sessão, e cada item já estava registrado na thread de origem:

1. **`wikipedia` e `wikidata` não declaram desfecho** (49 `indeterminado` acima).
   Cada um precisa distinguir "a fonte respondeu e não tem verbete" de "a
   consulta falhou". É mudança de ingest.
2. **Os 96 publicáveis sem CPF válido** continuam inverificáveis no Portal. A
   rota é o CPF do registro do TSE, que a thread 2 abriu com o `buildSQMap`.
3. **Os 8 dos 27 sem registro no TSE 2026** (prazo 15/08). Gênero, cor/raça,
   estado civil, patrimônio e foto oficial chegam juntos quando protocolarem.
4. **25 dos 27 seguem sem nenhuma rede social**, e 20 sem biografia. Precisa de
   fonte oficial e de decisão editorial, não de coleta.
5. **`jarbas` e `ceaps-senado` estão com o endpoint morto** (404 verificado em
   05/08). As guardas ficam dormentes até a fonte voltar. Remover os ingests e os
   cards é decisão de produto.
6. **Prefixo `Candidatura a X` em `cargo_canonico`** atinge 1 ficha hoje
   (`jarbas-soares`) e cresce conforme entrar ficha nova sem SQ.
7. **Qualidade da foto** não entrou no relatório canônico: ele só pergunta se
   `foto_url` existe.
8. **Cinco casos de `status` x `publicavel` inconsistentes**, listados no
   relatório do resgate, esperando decisão.
9. **`preta-lu`** tem candidatura de 2022 apta cujo resultado vem como `#NULO`;
   falta apurar a votação para o histórico poder ser gravado.

## Thread 7 — cobertura por fonte e filtro de despublicados (05/08/2026)

Base: PR #97 (`fix/cobertura-totais-legenda`, commit `1402759`), em worktree
isolado fora de `.qwen`. A tabela original de 23 frentes foi preservada e cada
seção ganhou um segundo eixo com uma linha por fonte e candidato: desfecho,
volume, última tentativa e detalhe. As fontes nunca consultadas aparecem
primeiro e são contadas no cabeçalho do candidato.

A lista inclui as 18 fontes canônicas de escopo candidato, `tse-cpf` e fontes
adicionais já observadas no log. Fontes fora do catálogo só aparecem onde há
tentativa registrada; elas não viram lacuna inventada para os demais. Fontes
territoriais ficam fora.

O snapshot agora filtra `historico_politico.despublicado_em is null`, igual à
ficha pública. A comparação antiga x nova rodou em uma única consulta Supabase
com `read_only: true`, sobre o mesmo snapshot transacional: 194 candidatos antes
e depois, **0 células alteradas em todas as 23 colunas**. O efeito visual atual é
nulo, mas a régua deixa de depender de linhas que a ficha não publica.

Verificação no relatório servido em `http://127.0.0.1:8899/`:

- legenda e DOM: 4.462/4.462 células, com os cinco estados iguais;
- `coleta_log_ultima`: Aroldo Félix 9/9, Lula 4/4 e Zé Cocá 6/6, sem divergência
  de fonte ou desfecho;
- viewport de 375 px: documento 360/360 px, sem rolagem horizontal da página;
  as 58 tabelas rolam dentro do próprio container;
- gates do job `verify`: 9/9 PASS, incluindo 1.821 testes.

### Follow-up: aplicabilidade das fontes (05/08/2026)

"Nunca verificado" agora significa somente fonte aplicável sem tentativa. Sem
tentativa registrada, Câmara e Jarbas viram `N/A` quando não há ID da Câmara nem
mandato de deputado federal; Senado e CEAPS viram `N/A` quando não há ID do
Senado nem mandato de senador. Uma tentativa real sempre prevalece e mantém seu
desfecho.

No relatório completo, 659 linhas antes marcadas como pendentes viraram `N/A`:
158 da Câmara, 159 do Jarbas, 171 do Senado e 171 do CEAPS. Augusto Cury caiu de
15 para 11 fontes nunca verificadas; as quatro fontes parlamentares agora
aparecem como `N/A`. A tabela de 23 frentes e o índice de preenchimento não
mudaram.

O relatório foi regenerado em modo somente leitura e verificado em navegador
real. O DOM tem 4.462 células de cobertura, 3.698 linhas por fonte e 659 `N/A`;
em 375 px, o documento mede 360/360 px e as tabelas continuam rolando dentro do
container. Os nove gates passaram, incluindo 1.824 testes.

[codex-stamp: log feito pelo Codex; Claude deve ignorar se nao for util ou incorporar se fizer sentido]
