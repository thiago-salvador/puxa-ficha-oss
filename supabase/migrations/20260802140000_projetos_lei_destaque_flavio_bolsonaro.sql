-- =====================================================================
-- Curadoria de projetos em destaque: flavio-bolsonaro (3 de 67).
-- Branch data/presidenciaveis-lacunas (2026-08-02).
--
-- CRITERIO
-- So vira destaque o projeto cujo motivo possa ser conferido no proprio
-- registro oficial, sem depender de leitura editorial. O criterio usado foi a
-- SITUACAO ATUAL na fonte oficial da casa legislativa, consultada nesta sessao:
--   Senado: https://legis.senado.leg.br/dadosabertos/materia/situacaoatual/<codigo>
--   Camara: https://dadosabertos.camara.leg.br/api/v2/proposicoes/<id>
-- Cada destaque_motivo abaixo cita a situacao e a data exatas que a API
-- devolveu em 2026-08-02.
--
-- POR QUE 0 DESTAQUES PARA lula E cabo-daciolo
-- A varredura cobriu os 179 registros dos tres candidatos previstos:
--   lula (12 proposicoes, Camara, 1987-1990): 7 com situacao "Arquivada" e 5
--     sem situacao na API. Nenhuma aprovada, nenhuma transformada em norma.
--     Marcar destaque exigiria motivo que a fonte nao sustenta.
--   cabo-daciolo (100 proposicoes, Camara, 2016-2018): 31 "Tramitacao
--     Finalizada" cujo despacho e apenas a publicacao inicial no Diario, 14
--     "Tramitando em Conjunto", 13 "Arquivada", 1 "Retirado pelo Autor",
--     1 "Pronta para Pauta" e 40 sem situacao. A maioria e emenda (EMC), nao
--     projeto autoral. Nenhum registro tem situacao de aprovacao.
-- Os dois ficam com zero destaques por ausencia de fato verificavel, nao por
-- falta de varredura. Isso esta registrado tambem no resumo do run.
--
-- ESCOPO: so UPDATE de destaque e destaque_motivo em public.projetos_lei, em 3
-- linhas identificadas por (slug, proposicao_id_api). Nenhuma outra tabela,
-- nenhum outro candidato, nenhum INSERT, nenhum DELETE.
-- =====================================================================

BEGIN;

-- @write tabela=projetos_lei slug=flavio-bolsonaro proposicao=136918 campos=destaque,destaque_motivo
UPDATE public.projetos_lei pl
SET destaque = true,
    destaque_motivo = 'Aprovado no Senado e remetido a Camara dos Deputados em 23/05/2024, segundo a situacao atual registrada na base oficial do Senado.'
FROM public.candidatos c
WHERE c.id = pl.candidato_id
  AND c.slug = 'flavio-bolsonaro'
  AND pl.proposicao_id_api = '136918';

-- @write tabela=projetos_lei slug=flavio-bolsonaro proposicao=148903 campos=destaque,destaque_motivo
UPDATE public.projetos_lei pl
SET destaque = true,
    destaque_motivo = 'Aprovado no Senado e remetido a Camara dos Deputados em 13/09/2023, segundo a situacao atual registrada na base oficial do Senado.'
FROM public.candidatos c
WHERE c.id = pl.candidato_id
  AND c.slug = 'flavio-bolsonaro'
  AND pl.proposicao_id_api = '148903';

-- @write tabela=projetos_lei slug=flavio-bolsonaro proposicao=138702 campos=destaque,destaque_motivo
UPDATE public.projetos_lei pl
SET destaque = true,
    destaque_motivo = 'Concluida a fase de comissoes e classificado como pronto para deliberacao do Plenario do Senado desde 20/02/2020, segundo a situacao atual na base oficial.'
FROM public.candidatos c
WHERE c.id = pl.candidato_id
  AND c.slug = 'flavio-bolsonaro'
  AND pl.proposicao_id_api = '138702';

COMMIT;
