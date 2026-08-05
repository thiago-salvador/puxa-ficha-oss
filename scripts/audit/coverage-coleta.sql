-- Procedência do zero: última tentativa de coleta por candidato e por fonte.
--
-- Complemento OPCIONAL de `coverage-snapshot.sql`. Só roda quando a tabela
-- `coleta_log` existe (`lib/snapshot-fetch.ts` checa com `to_regclass` antes de
-- chamar), porque o relatório precisa continuar rodando em banco que ainda não
-- recebeu a migration.
--
-- O QUE ESTA CONSULTA RESPONDE. O relatório tinha, na própria legenda, a
-- confissão de que `zero` podia ser "verificado e nada encontrado" ou "nunca
-- coletado". `coleta_log` registra a TENTATIVA, e é a tentativa que separa os
-- dois. Ver a migration `coleta_log_tentativa_por_fonte` para o vocabulário de
-- `resultado`; aqui só se lê.
--
-- A AUSÊNCIA DE LINHA É O DADO MAIS IMPORTANTE, e por isso esta consulta não
-- tenta representá-la: candidato sem tentativa registrada para uma fonte
-- simplesmente não traz aquela chave no objeto, e `provenienciaDoZero` em
-- `lib/coverage-model.ts` lê a falta como `nunca_verificado`. Inventar aqui uma
-- linha 'nunca' apagaria a diferença entre "não perguntamos" e "perguntamos e
-- deu isso".
--
-- Só o escopo `candidato` interessa: fonte territorial (SICONFI, IBGE, CAPAG…)
-- tem UF como alvo, não candidato, e acusá-la por candidato produziria 194
-- lacunas inexistentes.

select coalesce(
  jsonb_object_agg(alvo, fontes) filter (where alvo is not null),
  '{}'::jsonb
) as coletas
from (
  select u.alvo, jsonb_object_agg(u.fonte, u.resultado) as fontes
  from public.coleta_log_ultima u
  where u.escopo = 'candidato'
    and exists (select 1 from public.candidatos_publico c where c.slug = u.alvo)
  group by u.alvo
) t;
