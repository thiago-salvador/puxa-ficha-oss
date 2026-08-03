-- Run local v3 governadores AL. NÃO APLICAR neste run.
-- Fontes foram verificadas contra o conteúdo das páginas; verificado permanece false
-- para revisão editorial posterior.
BEGIN;

-- @write tabela=posicoes_declaradas slug=jhc tema=reforma_trabalhista campos=posicao,descricao,fonte,url_fonte,verificado,gerado_por
-- Fonte primária: página oficial de votações nominais da Câmara para o deputado JHC,
-- 26/04/2017, com Não na subemenda substantiva do PL 6787/2016.
INSERT INTO public.posicoes_declaradas
  (candidato_id, tema, posicao, descricao, fonte, url_fonte, verificado, gerado_por)
SELECT c.id, 'reforma_trabalhista', 'contra a reforma trabalhista de 2017',
  'A página oficial de votações nominais registra voto Não de JHC na subemenda substitutiva global do PL 6787/2016 em 26/04/2017.',
  'Câmara dos Deputados — Votações nominais de JHC em 2017',
  'https://www.camara.leg.br/deputados/178842/votacoes-nominais-plenario/2017', false, 'curadoria'
FROM public.candidatos c WHERE c.slug = 'jhc'
ON CONFLICT (candidato_id, tema) DO UPDATE SET
  posicao = EXCLUDED.posicao, descricao = EXCLUDED.descricao, fonte = EXCLUDED.fonte,
  url_fonte = EXCLUDED.url_fonte, verificado = false, gerado_por = 'curadoria';

-- @write tabela=posicoes_declaradas slug=renan-filho tema=reforma_trabalhista campos=posicao,descricao,fonte,url_fonte,verificado,gerado_por
-- Fonte de imprensa com transcrição de fala do candidato, 29/05/2026.
INSERT INTO public.posicoes_declaradas
  (candidato_id, tema, posicao, descricao, fonte, url_fonte, verificado, gerado_por)
SELECT c.id, 'reforma_trabalhista', 'apoia o fim da escala 6x1',
  'Em entrevista à Rádio Correio Delmiro, Renan Filho declarou apoio integral ao fim da escala 6x1 e chamou a medida de avanço social e trabalhista.',
  'Cada Minuto — declaração de Renan Filho sobre fim da escala 6x1',
  'https://www.cadaminuto.com.br/noticia/2026/05/29/trabalhador-tem-direito-de-viver-com-a-familia-diz-renan-filho-sobre-fim-da-escala-6x1', false, 'curadoria'
FROM public.candidatos c WHERE c.slug = 'renan-filho'
ON CONFLICT (candidato_id, tema) DO UPDATE SET
  posicao = EXCLUDED.posicao, descricao = EXCLUDED.descricao, fonte = EXCLUDED.fonte,
  url_fonte = EXCLUDED.url_fonte, verificado = false, gerado_por = 'curadoria';

-- @write tabela=posicoes_declaradas slug=renan-filho tema=teto_gastos campos=posicao,descricao,fonte,url_fonte,verificado,gerado_por
-- Fonte primária: notas taquigráficas do Senado, 21/03/2023.
INSERT INTO public.posicoes_declaradas
  (candidato_id, tema, posicao, descricao, fonte, url_fonte, verificado, gerado_por)
SELECT c.id, 'teto_gastos', 'critica o teto de gastos por restringir investimentos',
  'Nas notas taquigráficas de audiência no Senado, Renan Filho atribuiu ao regime fiscal balizado pelo teto de gastos a baixa capacidade de investimento dos anos anteriores.',
  'Senado Federal — Notas taquigráficas da audiência de infraestrutura',
  'https://www25.senado.leg.br/web/atividade/notas-taquigraficas/-/notas/r/11153', false, 'curadoria'
FROM public.candidatos c WHERE c.slug = 'renan-filho'
ON CONFLICT (candidato_id, tema) DO UPDATE SET
  posicao = EXCLUDED.posicao, descricao = EXCLUDED.descricao, fonte = EXCLUDED.fonte,
  url_fonte = EXCLUDED.url_fonte, verificado = false, gerado_por = 'curadoria';

-- @write tabela=posicoes_declaradas slug=renan-filho tema=transferencia_renda campos=posicao,descricao,fonte,url_fonte,verificado,gerado_por
-- Fonte institucional municipal de Alagoas, 03/02/2021.
INSERT INTO public.posicoes_declaradas
  (candidato_id, tema, posicao, descricao, fonte, url_fonte, verificado, gerado_por)
SELECT c.id, 'transferencia_renda', 'apoio a transferência de renda focalizada na primeira infância',
  'O programa CRIA, lançado pelo governador Renan Filho, foi descrito como benefício de transferência de renda para famílias com crianças pequenas.',
  'Prefeitura de Palmeira dos Índios — Programa social CRIA',
  'https://palmeiradosindios.al.gov.br/noticia/programa-social-beneficia-familias-em-palmeira-dos-indios/', false, 'curadoria'
FROM public.candidatos c WHERE c.slug = 'renan-filho'
ON CONFLICT (candidato_id, tema) DO UPDATE SET
  posicao = EXCLUDED.posicao, descricao = EXCLUDED.descricao, fonte = EXCLUDED.fonte,
  url_fonte = EXCLUDED.url_fonte, verificado = false, gerado_por = 'curadoria';

-- @write tabela=candidatos slug=renan-filho campos=profissao_declarada
-- Fonte oficial do Governo Federal, 02/01/2023: economista formado pela UnB.
-- URL: https://www.gov.br/portos-e-aeroportos/pt-br/assuntos/noticias/2023/01/presidente-lula-da-posse-aos-novos-ministros-da-infraestrutura-brasileira-de-transportes
UPDATE public.candidatos
SET profissao_declarada = 'ECONOMISTA'
WHERE slug = 'renan-filho';

COMMIT;
