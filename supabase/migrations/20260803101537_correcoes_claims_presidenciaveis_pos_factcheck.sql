-- Correções de texto em 5 claims publicadas dos pré-candidatos à Presidência.
-- Verificação claim a claim das 17 no ar, abrindo cada fonte citada.
-- Aprovada por Thiago em 2026-08-03 (payload correcoes-claims-v1).
-- Detalhe completo, caso a caso, em
-- supabase/migrations/20260803100000_correcoes_claims_presidenciaveis_pos_factcheck.sql
-- Não despublica nada e não toca em visivel nem verificado.

UPDATE public.pontos_atencao pa
SET titulo = 'Mansão de R$ 5,9 milhões comprada durante mandato',
    descricao = 'Comprou mansão de 1.000 m² por R$ 5,9 milhões em Brasília em 2021, durante o mandato de senador.'
FROM public.candidatos c
WHERE c.id = pa.candidato_id
  AND c.slug = 'flavio-bolsonaro'
  AND pa.id = '9c933004-b41a-408a-82f5-2bbaa29dd74c';

UPDATE public.pontos_atencao pa
SET titulo = 'PIB cresceu 3,5% ao ano no primeiro mandato (2003-2006)',
    descricao = 'A economia brasileira cresceu em média 3,5% ao ano no primeiro mandato: 1,1% em 2003, 5,7% em 2004, 3,2% em 2005 e 4,0% em 2006, segundo o IBGE.',
    fontes = '[{"titulo": "IBGE: PIB cresceu 3,2% e foi de R$ 2,1 trilhões em 2005", "url": "https://agenciadenoticias.ibge.gov.br/agencia-sala-de-imprensa/2013-agencia-de-noticias/releases/13389-asi-pib-cresceu-32-e-foi-de-r-21-trilhoes-em-2005"}, {"titulo": "IBGE: PIB cresceu 4,0% e foi de R$ 2,37 trilhões em 2006", "url": "https://agenciadenoticias.ibge.gov.br/agencia-sala-de-imprensa/2013-agencia-de-noticias/releases/13565-asi-pib-cresceu-40-e-foi-de-r-237-trilhoes-em-2006"}]'::jsonb
FROM public.candidatos c
WHERE c.id = pa.candidato_id
  AND c.slug = 'lula'
  AND pa.id = '612f6a0a-9fc9-47d2-9023-1cf9cab3ca9f';

UPDATE public.pontos_atencao pa
SET titulo = 'Condenação a indenizar Caetano Veloso e penhora de R$ 100 mil',
    descricao = 'Condenado em 2024, junto com Kim Kataguiri, a indenizar Caetano Veloso e Paula Lavigne em R$ 60 mil por associação indevida com pedofilia. Em janeiro de 2024 teve R$ 100 mil penhorados pela Justiça.'
FROM public.candidatos c
WHERE c.id = pa.candidato_id
  AND c.slug = 'renan-santos'
  AND pa.id = '4229b371-7908-4d31-b593-6c8257ca2ea3';

UPDATE public.pontos_atencao pa
SET titulo = 'Do PSD ao PSD: as legendas em mais de 30 anos',
    descricao = 'Começou no PSD, pelo qual se elegeu deputado federal em 1991, e passou ao PFL, legenda que virou DEM em 2007 e se fundiu no União Brasil em 2022. Voltou ao PSD, partido pelo qual governa Goiás desde 2026.'
FROM public.candidatos c
WHERE c.id = pa.candidato_id
  AND c.slug = 'ronaldo-caiado'
  AND pa.id = '7b123f00-93a6-44b2-9fb0-4723f3c23513';

UPDATE public.pontos_atencao pa
SET titulo = 'Rompimentos e reaproximações com Bolsonaro',
    descricao = 'Apoiou Bolsonaro na eleição de 2018. O próprio Bolsonaro afirmou depois que Caiado, nas palavras dele, rompeu com o governo em quatro momentos ao longo do mandato presidencial.'
FROM public.candidatos c
WHERE c.id = pa.candidato_id
  AND c.slug = 'ronaldo-caiado'
  AND pa.id = '8ef45b5e-93e6-4ba9-9bdd-a2985e7d2f16';;
