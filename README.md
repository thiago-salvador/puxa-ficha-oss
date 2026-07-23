# Puxa Ficha

Plataforma cívica de consulta pública sobre candidatos das eleições brasileiras
de 2026. Ficha pública, comparador lado a lado e pontos de atenção com fontes
visíveis. Os dados vêm de bases oficiais (TSE, Câmara dos Deputados, Senado
Federal, Portal da Transparência) sob a Lei de Acesso à Informação.

**Produção:** https://puxaficha.com.br

## Stack

- **Next.js 16** (App Router, renderização sob demanda)
- **TypeScript**
- **Tailwind CSS 4** + shadcn/ui
- **Supabase** (PostgreSQL)
- **Sentry** (observabilidade, opcional)
- Deploy na **Vercel**

## Pré-requisitos

- Node.js **24.x** (ver `.nvmrc`)
- Uma conta no [Supabase](https://supabase.com) (o plano free basta para desenvolvimento)
- Opcional: [Supabase CLI](https://supabase.com/docs/guides/cli) para aplicar as migrations

## Setup local

### 1. Instalar dependências

```bash
npm ci
```

### 2. Variáveis de ambiente

```bash
cp .env.example .env.local
```

Preencha no mínimo `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e
`NEXT_PUBLIC_SITE_URL`. Os valores do Supabase estão em
**Project Settings → API** no painel do seu projeto. O `.env.example` documenta
todas as variáveis, incluindo as opcionais (Sentry, alertas por email, ingestão).

### 3. Banco de dados

O schema e os dados vivem em `supabase/migrations/` como migrations SQL
sequenciais. Autentique a CLI, aponte para o seu projeto e aplique:

```bash
supabase login                              # autentica a CLI (abre o browser)
supabase link --project-ref SEU_PROJECT_REF # vai pedir a senha do banco
supabase db push
```

As migrations incluem o schema completo e os *seeds* com dados públicos de
candidatos. Elas são snapshots verificados das fontes oficiais (TSE, Câmara,
Senado); não são regeneráveis a partir do zero apenas com o código deste
repositório, mas sobem sozinhas num projeto Supabase vazio, sem depender de
nenhum artefato externo.

### 4. Rodar

```bash
npm run dev      # http://localhost:3000
```

## Scripts principais

```bash
npm run dev         # servidor de desenvolvimento
npm run build       # build de produção
npm start           # servir o build
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # testes unitários (node --test)
npm run test:visual # testes visuais (Playwright: rode `npx playwright install` antes)
npm run validate:seed  # valida a integridade do seed de candidatos
```

> Os gates obrigatórios de um PR (`lint`, `typecheck`, `test`, `build`) não
> dependem do Playwright. Os testes visuais são opcionais e exigem
> `npx playwright install` para baixar os browsers.

## Pipeline de dados

Os scripts em `scripts/` (biblioteca em `scripts/lib/`) coletam dados das APIs
públicas e persistem no Supabase. Exigem uma `SUPABASE_SERVICE_ROLE_KEY` e, para
algumas fontes, uma `TRANSPARENCIA_API_KEY`.

```bash
npx tsx scripts/ingest-all.ts camara senado   # REST APIs
npx tsx scripts/ingest-all.ts tse             # CSV do TSE
```

O pipeline é idempotente e respeita a hierarquia de proveniência das fontes
(não sobrescreve dado de fonte de maior prioridade com uma de menor).

## Estrutura

```
src/            aplicação Next.js (rotas, componentes, libs)
scripts/        pipeline de ingestão e utilitários de dados
  lib/          biblioteca compartilhada do pipeline
supabase/
  migrations/   schema + seeds (SQL sequencial)
data/           seeds de produto (candidatos.json e afins)
tests/          testes unitários, de contrato e visuais
public/         estáticos (fotos de candidatos, ícones)
```

## Privacidade

O CPF nunca é exposto no cliente; é usado apenas como chave de cruzamento no
servidor, durante a ingestão. Veja [SECURITY.md](SECURITY.md). Se identificar
qualquer dado pessoal chegando ao browser, reporte pelo canal privado.

## Contribuindo

Veja [CONTRIBUTING.md](CONTRIBUTING.md) e o
[Código de Conduta](CODE_OF_CONDUCT.md). Toda contribuição roda pelo CI
(lint, typecheck, testes e build), que funciona em PRs de fork sem segredos.

## Licença

Código sob [Elastic License 2.0](LICENSE): você pode usar, modificar e
contribuir livremente, mas não pode oferecer o software a terceiros como serviço
hospedado. Os dados são públicos (Lei de Acesso à Informação) e não estão
cobertos pela licença do código.
