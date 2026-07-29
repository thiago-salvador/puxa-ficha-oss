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
