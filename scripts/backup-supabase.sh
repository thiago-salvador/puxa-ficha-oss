#!/usr/bin/env bash
# Dump do banco Supabase do Puxa Ficha.
#
# Por que existe. O projeto roda no plano Free, que nao tem backup automatico
# acessivel (docs Supabase: backups diarios so em Pro+; a recomendacao para o
# Free e exportar regularmente e guardar copia fora). O acervo editorial dos
# candidatos e reconstrutivel pelas migrations versionadas, mas duas tabelas
# so existem no banco: noticias_candidato (ingerida por /api/news/refresh e
# scripts/lib/ingest-google-news.ts) e alert_subscribers (emails de
# assinantes, PII). Sem dump, um erro de escrita em massa perde as duas sem
# caminho de volta.
#
# Uso:
#   SUPABASE_DB_URL="postgresql://..." scripts/backup-supabase.sh [dir-saida]
#
# A connection string e a "Direct connection" (ou o pooler em modo session)
# do painel do Supabase: Project Settings -> Database -> Connection string.
# Requer pg_dump com major >= a do servidor (Supabase hoje: 15/17; instale
# postgresql-client-17 que cobre todas).
#
# Saida (formato custom do pg_dump, restauravel com pg_restore):
#   <dir>/puxa-ficha-<UTC>.dump          schema + dados do schema public
#
# Restore de teste (empurrar para um projeto Supabase NOVO, nunca o de
# producao):
#   pg_restore --no-owner --no-privileges -d "postgresql://<projeto-novo>" \
#     puxa-ficha-<UTC>.dump
#
# O dump contem PII: nunca commitar (backups/ esta no .gitignore) e so
# armazenar cifrado fora da maquina local.
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "ERRO: defina SUPABASE_DB_URL com a connection string direta do Postgres." >&2
  echo "Painel Supabase: Project Settings -> Database -> Connection string." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERRO: pg_dump nao encontrado. Instale postgresql-client-17 (ou use" >&2
  echo "'supabase db dump --db-url ...' que exige Docker)." >&2
  exit 1
fi

DIR_SAIDA="${1:-backups}"
CARIMBO="$(date -u +%Y%m%dT%H%M%SZ)"
ARQUIVO="${DIR_SAIDA}/puxa-ficha-${CARIMBO}.dump"

mkdir -p "${DIR_SAIDA}"

echo "gerando dump em ${ARQUIVO}"
pg_dump "${SUPABASE_DB_URL}" \
  --format=custom \
  --schema=public \
  --no-owner \
  --no-privileges \
  --file="${ARQUIVO}"

TAMANHO="$(du -h "${ARQUIVO}" | cut -f1)"
echo "dump concluido: ${ARQUIVO} (${TAMANHO})"

# Prova minima de integridade: um dump que o proprio pg_restore nao consegue
# listar esta corrompido e nao serve de backup.
pg_restore --list "${ARQUIVO}" >/dev/null
echo "verificacao pg_restore --list: ok"
