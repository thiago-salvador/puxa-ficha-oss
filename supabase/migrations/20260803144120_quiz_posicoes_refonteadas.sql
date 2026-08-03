-- As 11 posicoes do quiz que estavam sem fonte, agora com fonte ou fora do quiz.
-- Aprovado por Thiago em 2026-08-03 (payload quiz-e-execucao, C1: correr atras da fonte).

-- @write tabela=posicoes_declaradas slug=flavio-bolsonaro tema=teto_gastos campos=descricao,fonte,url_fonte,verificado
UPDATE public.posicoes_declaradas p
SET descricao = 'Votou contra o Novo Arcabouço Fiscal (PLP 93/2023, que resultou na Lei Complementar 200/2023) na votação nominal do Plenário do Senado em 21 de junho de 2023. Não votou na Emenda Constitucional 95/2016, o Teto de Gastos: era deputado estadual à época.',
    fonte = 'Senado Federal, lista de votação nominal do PLP 93/2023',
    url_fonte = 'https://www25.senado.leg.br/web/atividade/materias/-/materia/157826',
    verificado = false
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'flavio-bolsonaro' AND p.tema = 'teto_gastos';

-- @write tabela=posicoes_declaradas slug=flavio-bolsonaro tema=reforma_trabalhista campos=verificado
UPDATE public.posicoes_declaradas p
SET verificado = false
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'flavio-bolsonaro' AND p.tema = 'reforma_trabalhista'
  AND p.url_fonte IS NULL;

-- @write tabela=posicoes_declaradas slug=lula tema=reforma_trabalhista campos=descricao,fonte,url_fonte
UPDATE public.posicoes_declaradas p
SET descricao = 'Em discurso a lideranças sindicais em 12 de maio de 2022, chamou de "escravocrata" a mentalidade de quem fez a reforma trabalhista e a reforma sindical, e defendeu sindicatos fortes.',
    fonte = 'g1, cobertura do congresso da Força Sindical (12/05/2022)',
    url_fonte = 'https://g1.globo.com/politica/eleicoes/2022/noticia/2022/05/12/em-congresso-de-liderancas-sindicais-lula-defende-mudancas-na-legislacao-trabalhista.ghtml'
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'lula' AND p.tema = 'reforma_trabalhista';

-- @write tabela=posicoes_declaradas slug=lula tema=teto_gastos campos=descricao,fonte,url_fonte
UPDATE public.posicoes_declaradas p
SET descricao = 'Em 30 de agosto de 2023, sancionou com dois vetos a Lei Complementar 200/2023, o Novo Arcabouço Fiscal, que substituiu o teto de gastos da Emenda Constitucional 95/2016.',
    fonte = 'Agência Câmara de Notícias, sanção da LC 200/2023',
    url_fonte = 'https://www.camara.leg.br/noticias/993734-lei-do-arcabouco-fiscal-e-sancionada-novo-regime-substitui-o-teto-de-gastos-publicos/'
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'lula' AND p.tema = 'teto_gastos';

-- @write tabela=posicoes_declaradas slug=lula tema=transferencia_renda campos=descricao,fonte,url_fonte
UPDATE public.posicoes_declaradas p
SET descricao = 'Em 19 de junho de 2023, sancionou a Lei 14.601/2023, que recriou o Programa Bolsa Família em substituição ao Auxílio Brasil.',
    fonte = 'Planalto, Lei 14.601/2023',
    url_fonte = 'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14601.htm'
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'lula' AND p.tema = 'transferencia_renda';

-- @write tabela=posicoes_declaradas slug=romeu-zema tema=reforma_trabalhista campos=descricao,fonte,url_fonte
UPDATE public.posicoes_declaradas p
SET descricao = 'Em 22 de junho de 2026, em evento da CNI em Brasília, defendeu retomar "no mínimo" as regras da reforma trabalhista de 2017 e disse querer avançar além delas.',
    fonte = 'Poder360, cobertura de evento da CNI (22/06/2026)',
    url_fonte = 'https://www.poder360.com.br/poder-eleicoes/zema-defende-regime-de-trabalho-por-hora-e-critica-clt/'
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'romeu-zema' AND p.tema = 'reforma_trabalhista';

-- @write tabela=posicoes_declaradas slug=romeu-zema tema=teto_gastos campos=descricao,fonte,url_fonte
UPDATE public.posicoes_declaradas p
SET descricao = 'Em 28 de abril de 2026, na Agrishow, citou o Teto de Gastos de 2016 e 2017 como precedente positivo, ao dizer que atacar a "gastança" faria a taxa de juros cair pela metade em seis a doze meses. Nunca foi parlamentar, portanto não votou na Emenda Constitucional 95/2016.',
    fonte = 'InfoMoney, com conteúdo Estadão (28/04/2026)',
    url_fonte = 'https://www.infomoney.com.br/politica/romeu-zema-vou-atacar-gastanca-e-taxa-de-juro-cai-pela-metade-em-6-12-meses/'
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'romeu-zema' AND p.tema = 'teto_gastos';

-- @write tabela=posicoes_declaradas slug=romeu-zema tema=transferencia_renda campos=posicao,descricao,fonte,url_fonte
UPDATE public.posicoes_declaradas p
SET posicao = 'ambiguo',
    descricao = 'Em entrevista publicada em 3 de maio de 2026, disse que manterá programas sociais como o Bolsa Família para quem precisa, e ao mesmo tempo defendeu endurecer regras contra fraude e cortar o benefício de quem recusa emprego formal.',
    fonte = 'Correio Braziliense, entrevista ao Canal Livre (03/05/2026)',
    url_fonte = 'https://www.correiobraziliense.com.br/politica/2026/05/7411360-criando-uma-geracao-de-imprestaveis-diz-zema-sobre-auxilios.html'
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'romeu-zema' AND p.tema = 'transferencia_renda';

-- @write tabela=posicoes_declaradas slug=ronaldo-caiado tema=reforma_trabalhista campos=descricao,fonte,url_fonte
UPDATE public.posicoes_declaradas p
SET descricao = 'Como senador por Goiás, votou a favor do texto-base da reforma trabalhista (PLC 38/2017) na sessão do Senado de 11 de julho de 2017, aprovada por 50 votos a 26.',
    fonte = 'g1 Goiás, como votaram os senadores goianos (12/07/2017)',
    url_fonte = 'https://g1.globo.com/goias/noticia/veja-como-votaram-os-senadores-de-goias-na-sessao-que-aprovou-a-reforma-trabalhista.ghtml'
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'ronaldo-caiado' AND p.tema = 'reforma_trabalhista';

-- @write tabela=posicoes_declaradas slug=ronaldo-caiado tema=teto_gastos campos=descricao,fonte,url_fonte
UPDATE public.posicoes_declaradas p
SET descricao = 'Como senador por Goiás, votou a favor da PEC 55/2016, o Teto de Gastos, no segundo turno do Senado em 13 de dezembro de 2016. A proposta foi promulgada como Emenda Constitucional 95/2016.',
    fonte = 'Senado Notícias, como votaram os senadores na PEC do Teto (13/12/2016)',
    url_fonte = 'https://www12.senado.leg.br/noticias/materias/2016/12/13/veja-como-votaram-os-senadores-na-aprovacao-da-pec-do-teto-de-gastos'
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'ronaldo-caiado' AND p.tema = 'teto_gastos';

-- @write tabela=posicoes_declaradas slug=ronaldo-caiado tema=transferencia_renda campos=posicao,descricao,fonte,url_fonte
UPDATE public.posicoes_declaradas p
SET posicao = 'ambiguo',
    descricao = 'Em entrevista de 21 de janeiro de 2026, disse que manteria o Bolsa Família, com mudanças voltadas a tornar o benefício transitório e ligado a qualificação profissional. Nenhuma fonte localizada sustenta oposição ao mecanismo de transferência de renda.',
    fonte = 'Poder360, entrevista sobre escala 6x1, Bolsa Família e reformas (21/01/2026)',
    url_fonte = 'https://www.poder360.com.br/poder-eleicoes/saiba-o-que-caiado-diz-sobre-escala-6-x-1-bolsa-familia-e-reformas/'
FROM public.candidatos c
WHERE c.id = p.candidato_id AND c.slug = 'ronaldo-caiado' AND p.tema = 'transferencia_renda';;
