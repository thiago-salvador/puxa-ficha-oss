# Cobertura de dados: como medir, e por que só de um jeito

Quanto de cada ficha está preenchido. Uma medida só, um comando só.

```bash
npm run audit:cobertura
```

Sai um HTML em `~/.disposable-html/AAAA-MM-DD-puxa-ficha-cobertura-dados.descartavel.html`,
o snapshot que o alimentou num `.json` irmão, e as páginas de revisão em
`revisao/` ao lado.

## Por que este documento existe

Em 04/08/2026 duas medidas de cobertura conviveram e discordaram, e a discordância
virou alarme de regressão que não existia. Uma página montada à mão fora do repo
contou os **280 registros da tabela crua** em vez dos **194 publicáveis**, e cobrou
as três posições do quiz de **181 candidatos a Governador**, sendo que o quiz é
presidencial. Nenhuma das duas coisas era regressão de dado: eram réguas
diferentes medindo coisas diferentes e chamando as duas de "cobertura".

A regra que sai daí é curta: **número de cobertura que não vem de
`npm run audit:cobertura` não é número de cobertura.** Página, planilha ou
consulta avulsa que meça o mesmo é derivada, precisa dizer isso no topo, e perde
para o script em caso de conflito. Duas réguas geram dois vocabulários, e a
diferença entre eles é indistinguível de regressão para quem lê.

## O que a régua mede

Mede **o que o leitor vê em puxaficha.com.br**, não o que existe no banco. Onde
os dois divergem, vale a superfície pública.

**Universo: só os publicáveis.** A entrada é a view `candidatos_publico`, não a
tabela `candidatos`. Hoje são 194 de 280: as outras 86 são desistentes, removidos
e pré-candidatos ainda não publicados. Contá-las infla lacuna com gente fora da
corrida.

**Quiz: só os presidenciáveis.** A coluna "Posições (quiz)" é `x/3`, um por tema
do quiz, e vale só para quem disputa a Presidência. Para os outros 183 a célula é
`n/a`, não lacuna. O quiz não pergunta nada a candidato a Governador, então
posição faltando ali não é buraco. Vale também o filtro do próprio quiz: só conta
posição com `verificado = true`, porque é o que `src/lib/api.ts` consome. Posição
gravada e não revisada não vai ao ar, e por isso não vira verde: vira item na
coluna "Itens a revisar".

**Índice de preenchimento: 15 colunas.** Entram foto, bio, redes sociais, dados
pessoais, patrimônio, evolução patrimonial, bens ano a ano, financiamento,
doadores detalhados, votações-chave, projetos de lei, cota parlamentar,
legislação do Executivo, notícias e posições. Ficam **fora** as oito colunas de
achado: cargos ocupados, histórico partidário, contradições, processos, alertas,
sanções, projetos em destaque e itens a revisar.

O motivo é o mesmo para todas: **elas medem o mundo, não o nosso esforço.** Um
governador sem nenhuma sanção administrativa não tem ficha pior que a de um com
cinco; contar sanção como preenchimento premiaria quem tem mais problema. Projeto
em destaque é curadoria editorial, e item a revisar é fila de trabalho: nenhum dos
dois é dado do candidato. Por isso existe ficha com 100% de preenchimento e célula
amarela de destaque, e isso está certo.

## Verificado e vazio, ou nunca coletado

As seis colunas de zero (cargos, partidos, contradições, processos, alertas,
sanções) carregam um traço colorido embaixo, lido da última tentativa registrada
em `coleta_log`:

| Traço | Significado |
|---|---|
| Verde | A fonte foi consultada e respondeu vazio. Único caso em que o zero afirma algo. |
| Âmbar | Nenhuma tentativa registrada. O zero não quer dizer nada. |
| Vermelho | A coleta falhou, ou terminou sem saber dizer se a fonte veio vazia. |
| Cinza | Nenhum ingest alimenta a coluna; o dado só entra por curadoria manual. |
| Sem traço | Este relatório não leu o log de coleta. |

A regra é conservadora: só vira verde quando **todas** as fontes daquela coluna
responderam. Uma fonte não consultada rebaixa o veredito, porque pode ser
justamente a que tinha o dado. O mapa coluna → fonte está em `FONTES_POR_COLUNA`
(`scripts/audit/lib/coverage-model.ts`) e sai de quem escreve em cada tabela, não
de suposição.

A ausência de linha no log é o dado mais importante e não é representada como
linha: candidato sem tentativa registrada simplesmente não traz a chave, e a
falta é lida como "nunca verificado". Há uma diferença deliberada entre *o log
não foi lido* (procedência desconhecida, o relatório diz isso na legenda) e *o
log foi lido e este candidato não tem tentativa* (nunca verificado). Colapsar as
duas repõe exatamente o bug que a tabela veio corrigir.

O relatório funciona em banco **sem** `coleta_log`: a leitura é opcional e, sem a
tabela, todo zero sai com procedência não lida. Detalhe do vocabulário de
`resultado` na migration `coleta_log_tentativa_por_fonte`.

## Acesso ao banco

O snapshot é SQL rodado contra produção em **modo somente leitura**. O transporte
é a Management API do Supabase (`/v1/projects/:ref/database/query`), a mesma que o
MCP do Supabase usa, sempre com `read_only: true` — o servidor abre a transação
em modo somente leitura e recusa escrita, então o caminho não consegue tocar em
produção nem por engano.

A credencial é o **Personal Access Token** (`sbp_…`), não a service role key:

1. `SUPABASE_ACCESS_TOKEN` no ambiente, se estiver definida (é a variável oficial
   do CLI, e é o caminho para CI ou outra máquina);
2. senão, no macOS, o token que `supabase login` já guardou no Keychain.

Se as duas faltarem, o script diz o que fazer. Rode `supabase login` uma vez.

**A API REST do projeto não serve aqui.** `SUPABASE_URL` + service role key é
PostgREST: expõe tabelas e RPCs declaradas, não SQL arbitrário, e responde 403 a
um token de CLI. Foi o beco que travou o relatório entre 02 e 04/08.

Para rodar sem tocar a rede (teste, máquina sem credencial, reexecutar o desenho):

```bash
tsx scripts/audit/coverage-report.ts --from-snapshot=caminho/do/snapshot.json
```

## Arquivos

| Arquivo | Papel |
|---|---|
| `scripts/audit/coverage-snapshot.sql` | Os fatos, incluindo o campo `coleta` de cada candidato. Uma linha, uma coluna `snapshot` com o array inteiro. |
| `scripts/audit/lib/coleta-proveniencia.ts` | Mapa coluna → fontes e veredito da procedência do zero. Lógica pura. |
| `scripts/audit/lib/coverage-model.ts` | A régua: cinco estados de célula, aplicabilidade, índice. Lógica pura. |
| `scripts/audit/lib/snapshot-fetch.ts` | Transporte e credencial. Não interpreta nada, mas remove o bloco de `coleta` quando o banco não tem a view. |
| `scripts/audit/coverage-report.ts` | Monta e desenha. |
| `scripts/audit/check-report.ts` | `npm run audit:cobertura:check`, confere o relatório. |

A divisão importa: o `.sql` é a **única** descrição dos fatos. Em 02/08 existia um
segundo caminho que lia o banco pelo supabase-js e reimplementava em JS as janelas
e uniões da régua; foi removido porque manter as duas versões em sincronia era
convite a duas verdades. `snapshot-fetch.ts` não reabre esse caminho: ele lê o
`.sql` como texto e manda o banco executar.

## Limitações conhecidas

**Histórico incompleto gera falso "não se aplica".** A aplicabilidade sai do
histórico político registrado no próprio site. Quem teve mandato que o banco não
conhece aparece como "não se aplica" onde deveria aparecer como lacuna. Está
escrito na própria página do relatório.

**`cargo_canonico` com o prefixo "Candidatura a X" não casa com a lista de cargos
eletivos.** `CARGOS_ELETIVOS` lista `Vereador`, `Deputado Estadual` e afins; o
banco tem 185 linhas de histórico em 66 fichas publicáveis escritas como
`Candidatura a Vereador`. Para quem só tem eventos nessa forma, `declarouAoTse`
dá falso, e patrimônio e financiamento saem como "não se aplica" em vez de
lacuna real. Hoje isso atinge **uma** ficha (`jarbas-soares`), porque as outras 32
são salvas pelo `SQ_CANDIDATO` do seed. O número cresce conforme entrar ficha nova
sem SQ no seed.

**A coluna Foto mede presença, não qualidade.** `foto_url is not null` e pronto.
Não distingue arquivo nosso em `public/candidates` de foto de terceiro (Wikimedia,
Câmara, Senado, TSE), nem enxerga resolução abaixo do slot de 562x750. Hoje 120
das 194 fichas usam foto de terceiro e 12 usam arquivo nosso em resolução baixa, e
as 132 aparecem como preenchidas.

**A coluna Dados pessoais mede 4 dos 7 campos de identidade** da view pública:
idade, naturalidade, formação e profissão. Ficam de fora gênero, estado civil e
cor/raça.
