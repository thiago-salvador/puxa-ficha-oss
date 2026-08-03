-- Duas claims NO AR cujo texto deixou de ser verdadeiro depois de publicado.
-- Aprovado por Thiago em 2026-08-03 (payload cruzamento-factchecks, acao A=aplicar).
-- Achadas cruzando dois fact-checks independentes das mesmas claims.

-- @write tabela=pontos_atencao slug=ciro-gomes-gov-ce campos=titulo,descricao,fontes
UPDATE public.pontos_atencao pa
SET titulo = 'Condenado em primeira instância por violência política de gênero, sem trânsito em julgado',
    descricao = 'Em julho de 2024, a 115ª Zona Eleitoral recebeu denúncia do Ministério Público contra Ciro Gomes por violência política de gênero, relacionada a declarações sobre a senadora Janaína Farias. Em 18 de maio de 2026, com decisão publicada no dia seguinte, ele foi condenado em primeira instância a 1 ano e 4 meses de reclusão, convertidos em penas restritivas de direitos, mais multa. Em 9 de julho de 2026 o TRE-CE rejeitou os embargos de declaração da defesa e manteve a condenação. A sentença é de primeira instância e ainda cabe recurso, portanto não há trânsito em julgado.',
    fontes = '[{"url": "https://g1.globo.com/ce/ceara/noticia/2026/05/19/ciro-gomes-e-condenado-por-violencia-politica-de-genero-por-comentarios-sobre-prefeita-de-crateus-janaina-farias.ghtml", "data": "2026-05-19", "titulo": "G1: Ciro Gomes e condenado por violencia politica de genero"}, {"url": "https://mpce.mp.br/denuncia-do-mp-contra-ciro-gomes-por-crime-de-violencia-politica-de-genero-e-aceita-pela-justica-eleitoral/", "data": "2024-07-11", "titulo": "MPCE: denuncia por violencia politica de genero aceita pela Justica Eleitoral"}]'::jsonb
FROM public.candidatos c
WHERE c.id = pa.candidato_id
  AND c.slug = 'ciro-gomes-gov-ce'
  AND pa.id = 'e01bbf63-93f7-4726-ade0-9861e693f397'
  AND pa.visivel = true;

-- @write tabela=pontos_atencao slug=acm-neto campos=titulo
UPDATE public.pontos_atencao pa
SET titulo = 'TCM-BA aprovou com ressalvas, por unanimidade, as contas de 2017, com queda no gasto com publicidade'
FROM public.candidatos c
WHERE c.id = pa.candidato_id
  AND c.slug = 'acm-neto'
  AND pa.id = '7ce00008-0725-4a00-8e01-000000000008'
  AND pa.visivel = true;;
