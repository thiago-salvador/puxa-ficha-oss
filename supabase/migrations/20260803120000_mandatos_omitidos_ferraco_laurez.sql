-- =====================================================================
-- Duas claims NO AR que contam menos mandatos do que a fonte que elas
-- mesmas citam documenta. NAO APLICADA ainda: preparada para revisao.
--
-- Nao e caso de fonte fraca nem de acusacao sem lastro. Nos dois casos a
-- fonte oficial ja esta citada na propria claim, e e ela que lista os
-- mandatos que o texto publicado deixou de fora. O defeito e de contagem,
-- e a correcao nao precisa de fonte nova.
--
-- ricardo-ferraco: o texto diz 4 mandatos e lista Vereador, Deputado
--   Estadual, Vice-Governador e Governador. Faltam Deputado Federal e
--   Senador (2011-2019). O perfil do Senado em dados abertos ja consta nas
--   fontes da claim, e a biografia oficial do governo do ES cita "vereador
--   entre 1982 e 1988 e posterior eleicao como deputado federal (1999-2003)
--   e senador da Republica (2011-2019)".
--
-- laurez-moreira: o texto diz 3 mandatos e lista Deputado Estadual,
--   Prefeito e Vereador. Falta Deputado Federal. A unica fonte da claim e a
--   biografia da Camara, que diz literalmente: "Renunciou ao mandato de
--   Deputado Federal, na Legislatura 2011-2015, para assumir o mandato de
--   Prefeito do Municipio de Gurupi". Ou seja, a fonte citada documenta
--   justamente o mandato ausente.
--
-- CONTAGEM: mandatos por CARGO DISTINTO, que e o criterio ja usado nas duas
-- claims. Reeleicao e segundo periodo no mesmo cargo nao viram unidade nova,
-- senao a correcao trocaria um numero errado por outro.
--
-- EFEITO NO SITE: as duas continuam no ar. Muda o numero no titulo e a lista
-- na descricao. `visivel`, `verificado` e `fontes` nao sao tocados.
--
-- FORA DESTA MIGRATION, DE PROPOSITO: a claim do romeu-zema sobre o acordo
-- de Brumadinho (8f3ed1f8-bda6-4039-a079-6b1e1eced551). O fact-check sugeriu
-- despublicar por atribuir protagonismo a ele, mas o texto publicado credita
-- "a Vale e o governo de Minas Gerais" e marca o superlativo como
-- "apresentado pelo governo estadual como", que e atribuicao correta. Os
-- fatos conferem na fonte. Despublicar claim factualmente correta e decisao
-- editorial do Thiago, nao consequencia do fact-check.
-- =====================================================================

BEGIN;

-- @write tabela=pontos_atencao slug=ricardo-ferraco campos=titulo,descricao
UPDATE public.pontos_atencao pa
SET titulo = 'Carreira política: 6 mandato(s) registrado(s)',
    descricao = 'Ricardo de Rezende Ferraço (MDB) possui 6 mandato(s) registrado(s): Vereador (Cachoeiro de Itapemirim), Deputado Estadual (Espírito Santo), Deputado Federal, Vice-Governador (Espírito Santo), Senador (Espírito Santo, 2011-2019), Governador (Espírito Santo).'
FROM public.candidatos c
WHERE c.id = pa.candidato_id
  AND c.slug = 'ricardo-ferraco'
  AND pa.id = '337bc0e5-614c-433d-8da9-584e3fee29f7'
  AND pa.visivel = true;

-- @write tabela=pontos_atencao slug=laurez-moreira campos=titulo,descricao
UPDATE public.pontos_atencao pa
SET titulo = 'Carreira política: 4 mandato(s) registrado(s)',
    descricao = 'Laurez da Rocha Moreira (PSD) possui 4 mandato(s) registrado(s): Vereador (TO), Deputado Estadual (TO), Deputado Federal (TO), Prefeito (Gurupi). Renunciou ao mandato de Deputado Federal, na legislatura 2011-2015, para assumir a Prefeitura de Gurupi.'
FROM public.candidatos c
WHERE c.id = pa.candidato_id
  AND c.slug = 'laurez-moreira'
  AND pa.id = 'a9530d43-5506-49cd-b316-ae174335aefe'
  AND pa.visivel = true;

COMMIT;
