# Fontes com pipeline pronto e sem entrega publicada

Este arquivo existe por causa do achado A0.3 da auditoria de integridade de
2026-07-24 (`docs/auditoria-integridade-2026-07-24.md`): a pagina `/metodologia`
anunciava ao publico uma fonte que nunca produziu uma linha de dado nem tinha
onde aparecer no site.

A regra que passa a valer: **fonte so aparece em `/metodologia` quando ha dado
publicado E superficie que renderiza esse dado.** Enquanto faltar um dos dois, a
fonte fica aqui, com o caminho de volta escrito.

---

## Cadastro de Sancoes da CGU (CEIS, CNEP, CEPIM)

Removida de `src/data/methodology-sources.ts` na etapa 2C.

### Situacao verificada em 2026-07-25

| Item | Estado |
|---|---|
| Ingest | existe: `scripts/lib/ingest-transparencia-sanctions.ts`, ja registrado em `scripts/ingest-all.ts` |
| Tabela `public.sancoes_administrativas` | 0 linhas (`select count(*)` no projeto `wskpzsobvqwhnbsdsmok`) |
| Tipo no app | existe: `sancoes_administrativas[]` e `total_sancoes` em `src/lib/types.ts` |
| Leitura no servidor | existe: `withSupabaseRetry("sancoes_administrativas(...)")` em `src/lib/api.ts` |
| DTO publico | existe: `publicSancao` em `src/lib/public-profile-dto.ts` |
| Componente que renderiza | **nao existe**: `grep -rn "sancoes_administrativas\|total_sancoes" src/components/ "src/app/(site)/"` volta vazio |
| Credencial | **nao configurada**: `TRANSPARENCIA_API_KEY` (o ingest apenas avisa e pula) |

Ou seja, o dado atravessa o backend inteiro e morre antes da tela.

### O que falta para a fonte voltar

1. **Credencial.** Definir `TRANSPARENCIA_API_KEY` no ambiente do ingest (chave
   da API de Dados do Portal da Transparencia). Sem ela,
   `ingestTransparenciaSanctions` registra `TRANSPARENCIA_API_KEY nao definida,
   pulando` e retorna sem tocar no banco.
2. **Rodar o ingest e conferir volume.** `sancoes_administrativas` precisa sair
   de zero. Enquanto der zero, nao ha o que publicar.
3. **Fonte utilizavel em cada ponto de atencao gerado.** O ingest tambem cria
   linhas em `pontos_atencao`, e desde a migration
   `20260725160000_gate_gravidade_fonte_pontos_atencao.sql` gravidade `alta` ou
   `critica` sem fonte com caminho e recusada no INSERT. O guard ja esta no
   proprio ingest (`motivoRecusaDeFonte`). Para religar, anexar em `fontes` a
   URL publica do Portal da Transparencia que mostra a sancao, e nao a rota
   autenticada da API.
4. **Superficie de exibicao.** Criar o bloco que renderiza
   `ficha.sancoes_administrativas` na ficha, com o mesmo padrao de rotulo de
   fonte e data usado nas outras secoes.
5. **So entao** reinserir o card em `src/data/methodology-sources.ts`, com
   `updateFrequency` refletindo a cadencia real de execucao (ver regra de
   cadencia no cabecalho daquele arquivo).

---

## DECISAO de 2026-08-05 sobre as duas fontes mortas

O dono aprovou resolver a ambiguidade "o ingest roda, nao da erro e devolve sem
dados". A decisao NAO foi a mesma para as duas, porque a situacao delas nao e a
mesma, e o criterio que separou foi um so: **a fonte ja pos dado no ar?**

| | Jarbas / Serenata | CEAPS Senado |
|---|---|---|
| Endpoint hoje | **HTTP 522** (Cloudflare de pe, origem fora) | **HTTP 404** na rota de despesas |
| Linhas publicadas por ela | **0** em `pontos_atencao` | **102** em `gastos_parlamentares` (65 em fichas publicaveis) |
| Tentativas em `coleta_log` | **0** | 10 |
| Card em `/metodologia` | **REMOVIDO** | **MANTIDO** |
| Ingest | mantido, agora grava `erro` | mantido, agora grava `erro` / `indeterminado` |

**Por que o card do Jarbas saiu.** E exatamente o achado A0.3 que criou este
arquivo: a pagina anunciava ao publico uma fonte que nunca produziu uma linha.
Somado ao endpoint fora do ar, o card prometia ao leitor uma verificacao de
gasto suspeito que nunca aconteceu para ninguem. `tests/ui-claims-copy-contract.test.ts`
passou a travar a volta dele sem dado junto.

**Por que o card do CEAPS ficou.** Aqui removeria a procedencia de numero que
esta no ar agora: 102 linhas de gasto parlamentar que a ficha e o comparador
mostram. A rota de ATUALIZACAO caiu; o dado publicado nao sumiu. Tirar o card
deixaria o leitor sem saber de onde veio o valor que ele esta lendo, que e o
oposto do que este arquivo existe para evitar.

**Por que nenhum dos dois ingests foi removido.** Remover apaga junto as guardas
de identidade escritas em 05/08 e os testes que as cobrem, e 522 e 404 nao provam
descontinuacao definitiva. O que muda e o silencio: os dois passam a declarar o
desfecho em `coleta_log`, entao "fonte morta" para de ser indistinguivel de
"procuramos e nao achamos".

**Criterio objetivo para remover o ingest do Jarbas depois** (antes nao havia
nenhum, e por isso a pergunta ficou aberta): agora que cada rodada grava `erro`,
se `coleta_log` mostrar `fonte = 'jarbas'` com `resultado = 'erro'` em **8
rodadas semanais consecutivas** sem nenhuma `encontrado` no meio, a API esta
descontinuada de fato e o ingest sai junto com o tipo, o teste e a entrada aqui.
Consulta que responde isso:

```sql
select date_trunc('week', executado_em) semana, resultado, count(*)
  from coleta_log where fonte = 'jarbas'
 group by 1, 2 order by 1 desc;
```

---

## Fontes com endpoint morto (verificado em 2026-08-05)

Estas duas nao sao lacuna de curadoria nem de credencial: o endpoint saiu do ar.
O ingest continua no repositorio e registrado em `scripts/ingest-all.ts`, roda
sem erro visivel e devolve "sem dados", que no relatorio de cobertura e
indistinguivel de "procuramos e nao achou nada". Registrado aqui para o
relatorio parar de tratar fonte morta como lacuna a preencher.

Achado durante a auditoria que seguiu o falso positivo em massa do ingest de
sancoes (2026-08-04): as duas foram checadas com chamada real ao tentar fechar o
mesmo tipo de guarda de identidade nelas.

### Jarbas / Serenata de Amor (`scripts/lib/ingest-jarbas.ts`)

| Item | Estado |
|---|---|
| Endpoint | `https://jarbas.serenata.ai/api/chamber_of_deputies/reimbursement` |
| Verificacao 2026-08-05 | **HTTP 404 em todas as rotas testadas, inclusive `https://jarbas.serenata.ai/`** |
| Comportamento do ingest | `res.status === 404` cai no caminho "sem dados na API (404)" e segue para o proximo candidato, sem erro |
| Guarda de identidade | adicionada em 2026-08-05 (`conferirReembolsos`), dormente enquanto a API estiver fora |

O que este ingest gravava quando funcionava: `pontos_atencao` com gravidade alta
ou media e texto de acusacao nomeada ("a IA Rosie identificou reembolsos
suspeitos"). A guarda nova recusa a resposta inteira quando qualquer registro
vier com `applicant_id` de outro deputado, porque a URL filtra por parametro de
query e nada comparava o retorno. Se a API voltar num formato diferente, e a
guarda que impede o pior caso.

Para religar: confirmar se o projeto Serenata publicou endpoint novo ou se a API
foi descontinuada de vez. Se foi, remover o ingest e o card da fonte em vez de
deixar codigo morto rodando semanalmente.

### CEAPS Senado (`scripts/lib/ingest-ceaps-senado.ts`)

| Item | Estado |
|---|---|
| Endpoint | `https://legis.senado.leg.br/dadosabertos/senador/{id}/despesas?ano=` |
| Verificacao 2026-08-05 | **HTTP 404** com corpo `No static resource dadosabertos/senador/{id}/despesas`, para todo id testado |
| Rotas irmas | `/senador/{id}` e `/senador/lista/atual` seguem **200**, ou seja o servico esta no ar e a rota de despesas mudou ou saiu |
| Comportamento do ingest | `fetchJSON` lanca, o catch avisa no stderr e devolve `null`, que o chamador loga como "sem dados" |
| Guardas de identidade | adicionadas em 2026-08-05 (`agregarDespesasDoAno`) |

Duas guardas entraram junto, porque os dois defeitos existiam
independentemente do endpoint estar fora:

1. `IdentificacaoParlamentar` estava tipado como `Record<string, unknown>` e
   nunca era lido. O payload diz de quem sao as despesas e o codigo gravava o
   que viesse.
2. O codigo somava na linha do ano PEDIDO qualquer ano que a API devolvesse. O
   comentario antigo tratava isso como comportamento conhecido e aceitavel ("a
   API as vezes retorna o ano solicitado, as vezes outros"), o que e evidencia
   de filtro nao confiavel, nao licenca para confiar nele. Bloco sem `NumAno`
   entra no mesmo descarte: despesa de ano desconhecido somada na linha do ano
   pedido e o mesmo erro sem nem a evidencia de qual ano foi somado.

**Falha de rede continua indistinguivel de fonte vazia, e a correcao nao e
aqui.** `fetchJSON` repete e lanca em timeout, DNS, 5xx, 429 e JSON invalido; o
catch de `fetchDespesasAno` trata todos como `null`, e o chamador loga "sem
dados" igual a um 404. Separar 404 dos demais dentro deste ingest resolveria um
ingest so, e o buraco existe em varios (`jarbas` e o proprio `sancoes` sem
credencial tem o mesmo catch). A correcao estrutural e o `coleta_log`, que
registra a TENTATIVA e tem `erro` e `indeterminado` como desfechos distintos de
`vazio_confirmado`. Enquanto o CEAPS estiver 404 em todo id, nenhum dos dois
caminhos grava dado, entao a distincao so passa a valer quando a rota voltar.

Para religar: achar a rota atual de despesas CEAPS no portal de dados abertos do
Senado (ou o CSV equivalente) e apontar `BASE_URL` para ela. As guardas ja estao
prontas para o formato novo, e `tests/ingest-guards-identidade.test.ts` cobre as
duas.

### Contraprova: a Camara nao tem esse problema

Testado no mesmo dia, e o resultado importa para nao espalhar guarda onde nao
precisa. `https://dadosabertos.camara.leg.br/api/v2/proposicoes`:

- honra o filtro (`idDeputadoAutor=0` e `idDeputadoAutor=999999999` devolvem 0 registros);
- **rejeita parametro desconhecido** com erro, em vez de ignorar em silencio
  (`idDeputadoAutorX=204554` nao volta lista).

E o oposto do Portal da Transparencia, que ignora parametro desconhecido e
devolve a lista nacional. As rotas de gastos e votos da Camara usam path param
(`/deputados/{id}/despesas`), onde id errado da 404 e nao dado de outra pessoa.
Por isso nenhuma guarda nova foi adicionada em `ingest-camara.ts`.

---

## Nota sobre cadencia das demais fontes

Atualizado em 2026-07-29 (verificacao original: 2026-07-25):

- `.github/workflows/ingest.yml` ganhou `schedule: 0 6 * * 3` (quartas): ingere
  camara+senado e revalida o Data Cache publico ao final. TSE e demais fontes
  continuam por `workflow_dispatch`.
- Outros workflows agendados: `link-check-fontes.yml` (segundas, URLs de fontes
  de pontos de atencao) e `data-quality.yml` (quintas: IDs camara/senado vs API
  oficial + audits de superficie publica; dia 3 do mes: SQ do seed vs
  consulta_cand do TSE).
- `vercel.json` tem 4 crons: `/api/alerts/send-digest`, `/api/news/refresh`,
  `/api/internal/published-consistency` e `/api/internal/runtime-smoke`. Apenas
  o segundo ingere dado de fonte publica.

Em `/metodologia`: Google News diz "diaria" (cron da Vercel), Camara e Senado
dizem "semanal" (schedule do ingest). O resto segue "sob demanda", que descreve
o que de fato acontece: lote manual. Rotulo sobe ou desce junto com o cron, no
mesmo commit.
