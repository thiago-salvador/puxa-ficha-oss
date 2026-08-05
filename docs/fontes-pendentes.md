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
   de filtro nao confiavel, nao licenca para confiar nele.

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
