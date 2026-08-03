-- Votos-chave de Mailza Gomes durante o mandato no Senado (2019-2022).
-- Fontes oficiais: Senado Federal, PEC 6/2019 (137999),
-- PLP 19/2019 (135147) e relatório nominal anual de 2021 para a MPV 1031/2021.
-- O recorte grava somente as três votações-chave já existentes no banco.

-- @write tabela=votos_candidato slug=mailza-assis proposicao=137999 campos=voto
INSERT INTO public.votos_candidato (candidato_id, votacao_id, voto)
SELECT c.id, v.id, 'sim'
FROM public.candidatos c
JOIN public.votacoes_chave v ON v.proposicao_id = '137999'
WHERE c.slug = 'mailza-assis'
ON CONFLICT (candidato_id, votacao_id) DO NOTHING;

-- @write tabela=votos_candidato slug=mailza-assis proposicao=135147 campos=voto
INSERT INTO public.votos_candidato (candidato_id, votacao_id, voto)
SELECT c.id, v.id, 'ausente'
FROM public.candidatos c
JOIN public.votacoes_chave v ON v.proposicao_id = '135147'
WHERE c.slug = 'mailza-assis'
ON CONFLICT (candidato_id, votacao_id) DO NOTHING;

-- @write tabela=votos_candidato slug=mailza-assis proposicao=150041 campos=voto
INSERT INTO public.votos_candidato (candidato_id, votacao_id, voto)
SELECT c.id, v.id, 'sim'
FROM public.candidatos c
JOIN public.votacoes_chave v ON v.proposicao_id = '150041'
WHERE c.slug = 'mailza-assis'
ON CONFLICT (candidato_id, votacao_id) DO NOTHING;
