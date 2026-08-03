-- Curadoria de projetos em destaque: flavio-bolsonaro (3 de 67).
-- Criterio: situacao atual na base oficial do Senado, consultada em 2026-08-02
-- via https://legis.senado.leg.br/dadosabertos/materia/situacaoatual/<codigo>.
-- lula e cabo-daciolo ficam com zero destaques: nenhum dos 112 registros dos dois
-- tem situacao de aprovacao. Detalhe em
-- supabase/migrations/20260802140000_projetos_lei_destaque_flavio_bolsonaro.sql

UPDATE public.projetos_lei pl
SET destaque = true,
    destaque_motivo = 'Aprovado no Senado e remetido a Camara dos Deputados em 23/05/2024, segundo a situacao atual registrada na base oficial do Senado.'
FROM public.candidatos c
WHERE c.id = pl.candidato_id
  AND c.slug = 'flavio-bolsonaro'
  AND pl.proposicao_id_api = '136918';

UPDATE public.projetos_lei pl
SET destaque = true,
    destaque_motivo = 'Aprovado no Senado e remetido a Camara dos Deputados em 13/09/2023, segundo a situacao atual registrada na base oficial do Senado.'
FROM public.candidatos c
WHERE c.id = pl.candidato_id
  AND c.slug = 'flavio-bolsonaro'
  AND pl.proposicao_id_api = '148903';

UPDATE public.projetos_lei pl
SET destaque = true,
    destaque_motivo = 'Concluida a fase de comissoes e classificado como pronto para deliberacao do Plenario do Senado desde 20/02/2020, segundo a situacao atual na base oficial.'
FROM public.candidatos c
WHERE c.id = pl.candidato_id
  AND c.slug = 'flavio-bolsonaro'
  AND pl.proposicao_id_api = '138702';;
