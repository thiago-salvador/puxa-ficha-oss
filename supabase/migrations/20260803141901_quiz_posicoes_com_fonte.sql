-- O quiz passa a pontuar tambem pelas posicoes que TEM fonte.
-- Aprovado por Thiago em 2026-08-03 (payload quiz-e-execucao, C1 e C2).
-- Um UPDATE por candidato, cada um declarado com o proprio slug.

-- @write tabela=posicoes_declaradas slug=augusto-cury campos=verificado
UPDATE public.posicoes_declaradas p SET verificado = true
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'augusto-cury'
  AND p.url_fonte IS NOT NULL AND p.verificado = false;

-- @write tabela=posicoes_declaradas slug=cabo-daciolo campos=verificado
UPDATE public.posicoes_declaradas p SET verificado = true
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'cabo-daciolo'
  AND p.url_fonte IS NOT NULL AND p.verificado = false;

-- @write tabela=posicoes_declaradas slug=edmilson-costa campos=verificado
UPDATE public.posicoes_declaradas p SET verificado = true
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'edmilson-costa'
  AND p.url_fonte IS NOT NULL AND p.verificado = false;

-- @write tabela=posicoes_declaradas slug=flavio-bolsonaro campos=verificado
UPDATE public.posicoes_declaradas p SET verificado = true
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'flavio-bolsonaro'
  AND p.url_fonte IS NOT NULL AND p.verificado = false;

-- @write tabela=posicoes_declaradas slug=hertz-dias campos=verificado
UPDATE public.posicoes_declaradas p SET verificado = true
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'hertz-dias'
  AND p.url_fonte IS NOT NULL AND p.verificado = false;

-- @write tabela=posicoes_declaradas slug=renan-santos campos=verificado
UPDATE public.posicoes_declaradas p SET verificado = true
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'renan-santos'
  AND p.url_fonte IS NOT NULL AND p.verificado = false;

-- @write tabela=posicoes_declaradas slug=rui-costa-pimenta campos=verificado
UPDATE public.posicoes_declaradas p SET verificado = true
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'rui-costa-pimenta'
  AND p.url_fonte IS NOT NULL AND p.verificado = false;

-- @write tabela=posicoes_declaradas slug=samara-martins campos=verificado
UPDATE public.posicoes_declaradas p SET verificado = true
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'samara-martins'
  AND p.url_fonte IS NOT NULL AND p.verificado = false;

-- @write tabela=posicoes_declaradas slug=tarcisio campos=verificado
UPDATE public.posicoes_declaradas p SET verificado = false
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'tarcisio'
  AND c.publicavel = false AND p.verificado = true;

-- @write tabela=posicoes_declaradas slug=augusto-cury campos=descricao
UPDATE public.posicoes_declaradas p
SET descricao = 'A cobertura do Metrópoles sobre a Marcha dos Prefeitos registra que ele defendeu mudar a regra do Bolsa Família que corta o benefício quando a pessoa consegue emprego ou abre um pequeno negócio. O verbo "reverter" é da reportagem; a matéria não traz citação literal do candidato sobre esse ponto.'
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'augusto-cury'
  AND p.tema = 'transferencia_renda';;
