-- Fecha somente achados com identidade forte da continuacao de 05/08.
--
-- Fontes:
--   * consulta_cand_2020.zip, SQ 200000998862, para CPF e UF de nascimento
--     de Cadu Xavier;
--   * pacotes rede_social_candidato de 2018/2020/2022/2024/2026 para a
--     rechecagem dos 22 publicaveis sem rede;
--   * perfis abertos em navegador autenticado para as nove pistas manuais.
--   * decisao editorial de 05/08 para a foto atual de Marcus Sodre e o cargo
--     disputado por Marcio Franca.
--
-- A migration e fill-only. Pistas sem bio confirmatoria ficam apenas no log
-- como indeterminadas e nunca entram em candidatos.redes_sociais.

BEGIN;

DO $$
DECLARE
  alvos integer;
BEGIN
  SELECT count(*) INTO alvos
  FROM public.candidatos
  WHERE slug IN ('cadu-xavier', 'henrique-areas');

  IF alvos <> 2 THEN
    RAISE EXCEPTION 'Pre-condicao: esperados 2 candidatos, encontrados %', alvos;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.candidatos
    WHERE slug = 'cadu-xavier'
      AND cpf IS NOT NULL
      AND cpf <> '07908568408'
  ) THEN
    RAISE EXCEPTION 'Pre-condicao: cadu-xavier ja tem outro CPF';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.candidatos
    WHERE slug = 'cadu-xavier'
      AND naturalidade IS NOT NULL
      AND naturalidade <> 'Rio Grande do Norte'
  ) THEN
    RAISE EXCEPTION 'Pre-condicao: cadu-xavier ja tem outra naturalidade';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.candidatos
    WHERE slug = 'henrique-areas'
      AND redes_sociais ? 'facebook'
      AND redes_sociais->>'facebook' <> 'henrique29pco'
  ) THEN
    RAISE EXCEPTION 'Pre-condicao: henrique-areas ja tem outro Facebook';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.candidatos WHERE slug = 'marcus-sodre')
     OR NOT EXISTS (SELECT 1 FROM public.candidatos WHERE slug = 'marcio-franca') THEN
    RAISE EXCEPTION 'Pre-condicao: Marcus Sodre ou Marcio Franca ausente';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.candidatos
    WHERE slug = 'marcus-sodre'
      AND foto_url IS NOT NULL
      AND foto_url <> '/candidates/marcus-sodre.jpg'
  ) THEN
    RAISE EXCEPTION 'Pre-condicao: marcus-sodre ja tem outra foto';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.candidatos
    WHERE slug = 'marcio-franca'
      AND cargo_disputado NOT IN ('Governador', 'Vice-Governador')
  ) THEN
    RAISE EXCEPTION 'Pre-condicao: marcio-franca tem cargo inesperado';
  END IF;

  IF (
    SELECT count(*) FROM public.candidatos
    WHERE slug IN ('aecio-neves', 'eduardo-leite', 'ricardo-nunes')
      AND publicavel = false
  ) <> 3 THEN
    RAISE EXCEPTION 'Pre-condicao: acervo inativo nao esta integralmente excluido';
  END IF;
END $$;

-- SQ exato do seed: consulta_cand_2020, Carlos Eduardo Xavier, RN, DEM,
-- Vereador, SQ 200000998862. O CPF passou no digito verificador.
-- @write tabela=candidatos slug=cadu-xavier campos=cpf,naturalidade
UPDATE public.candidatos
SET cpf = COALESCE(cpf, '07908568408'),
    naturalidade = COALESCE(naturalidade, 'Rio Grande do Norte'),
    ultima_atualizacao = now()
WHERE slug = 'cadu-xavier'
  AND (cpf IS NULL OR naturalidade IS NULL);

-- Bio visivel em facebook.com/henrique29pco: nome Henrique Areas, militante e
-- membro da direcao nacional do PCO. E a primeira rede pessoal confirmada da
-- ficha; os pacotes do TSE traziam apenas o site do partido.
-- @write tabela=candidatos slug=henrique-areas campos=redes_sociais
UPDATE public.candidatos
SET redes_sociais = jsonb_set(
      COALESCE(redes_sociais, '{}'::jsonb),
      '{facebook}',
      to_jsonb('henrique29pco'::text),
      true
    ),
    ultima_atualizacao = now()
WHERE slug = 'henrique-areas'
  AND NOT (COALESCE(redes_sociais, '{}'::jsonb) ? 'facebook');

-- Foto atual fornecida por Thiago em 05/08, enquadrada de 1200x675 para
-- 600x800. A origem tecnica local nao afirma autoria nem licenca.
-- @write tabela=candidatos slug=marcus-sodre campos=foto_url
UPDATE public.candidatos
SET foto_url = '/candidates/marcus-sodre.jpg',
    ultima_atualizacao = now()
WHERE slug = 'marcus-sodre'
  AND foto_url IS NULL;

-- Haddad anunciou Marcio Franca como vice de sua chapa em 25/06/2026.
-- @write tabela=candidatos slug=marcio-franca campos=cargo_disputado
UPDATE public.candidatos
SET cargo_disputado = 'Vice-Governador',
    ultima_atualizacao = now()
WHERE slug = 'marcio-franca'
  AND cargo_disputado = 'Governador';

-- @write tabela=coleta_log ref=lacunas-publicaveis-20260805-continuacao campos=fonte,escopo,alvo,candidato_id,resultado,volume,detalhe,url,execucao
WITH tentativas(fonte, slug, alvo, resultado, volume, detalhe, url) AS (
  VALUES
    ('tse-cpf', 'cadu-xavier', 'cadu-xavier:cpf', 'encontrado', 1,
      'consulta_cand_2020, SQ 200000998862: identidade exata por SQ do seed; NM_CANDIDATO=CARLOS EDUARDO XAVIER, SG_UF=RN, SG_PARTIDO=DEM, DS_CARGO=VEREADOR; NR_CPF_CANDIDATO=07908568408 com digito verificador valido.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2020.zip'),
    ('naturalidade', 'cadu-xavier', 'cadu-xavier:naturalidade', 'encontrado', 1,
      'consulta_cand_2020, SQ 200000998862: SG_UF_NASCIMENTO=RN. O pacote nao publica municipio para esta linha; gravado em nivel de UF como Rio Grande do Norte, mesma convencao usada nas lacunas TSE de 2026.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2020.zip'),

    ('tse-rede-social', 'aroldo-felix', 'aroldo-felix:rede-social', 'vazio_confirmado', 0,
      'Rechecagem dos pacotes oficiais 2018/2020/2022/2024/2026. O SQ 260001617899 de 2022 declara Facebook numerico sem identidade verificavel e Instagram da Unidade Popular de Sergipe, nao uma conta pessoal confirmada.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2022.zip'),
    ('tse-rede-social', 'catherine-teles', 'catherine-teles:rede-social', 'vazio_confirmado', 0,
      'Rechecagem oficial por SQ 60002533730. O pacote 2026 declara apenas a conta da cabeca de chapa e a conta do partido; nenhuma rede pessoal.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2026.zip'),
    ('tse-rede-social', 'preta-lu', 'preta-lu:rede-social', 'vazio_confirmado', 0,
      'Rechecagem oficial por SQ 100002534191. O pacote 2026 declara apenas Instagram, Facebook e site do PSTU Maranhao; nenhuma rede pessoal.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2026.zip'),
    ('tse-rede-social', 'henrique-areas', 'henrique-areas:rede-social', 'vazio_confirmado', 0,
      'Rechecagem oficial por SQ 250000615443 (2018) e 250001172315 (2020). Os dois pacotes declaram somente pco.org.br, site do partido.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2020.zip'),
    ('tse-rede-social', 'guilherme-fonseca', 'guilherme-fonseca:rede-social', 'vazio_confirmado', 0,
      'Rechecagem oficial por identidade exata no registro 2026, SQ 170002536575. O pacote declara apenas @PSTU.PE, conta do partido.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2026.zip'),
    ('tse-rede-social', 'luan-monteiro', 'luan-monteiro:rede-social', 'vazio_confirmado', 0,
      'Rechecagem oficial por SQ 190001092078 de 2020. O pacote declara somente pco.org.br, site do partido.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2020.zip'),

    ('tse-rede-social', 'gilberto-vasconcelos', 'gilberto-vasconcelos:rede-social', 'vazio_confirmado', 0,
      'Rechecagem oficial por SQ 40002535267 no registro 2026. O candidato nao tem linha de rede social no pacote.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2026.zip'),
    ('tse-rede-social', 'jose-estevao', 'jose-estevao:rede-social', 'vazio_confirmado', 0,
      'Rechecagem oficial por identidade exata no registro 2026, SQ 50002536579. O candidato nao tem linha de rede social no pacote.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2026.zip'),
    ('tse-rede-social', 'jeremias-cosmo', 'jeremias-cosmo:rede-social', 'vazio_confirmado', 0,
      'Rechecagem oficial por SQs 170000607399 (2018), 170000735134 (2020) e 170002143292 (2024). Nenhum deles declara rede social.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2024.zip'),
    ('tse-rede-social', 'mauricio-coelho', 'mauricio-coelho:rede-social', 'vazio_confirmado', 0,
      'Rechecagem oficial por SQ 110000951550 de 2020. O candidato nao tem linha de rede social no pacote; o SQ de 2012 fica fora da serie disponivel indicada para esta rodada.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2020.zip'),
    ('tse-rede-social', 'ze-batista', 'ze-batista:rede-social', 'vazio_confirmado', 0,
      'Rechecagem oficial por SQs 60001133056 (2020) e 60001608950 (2022). Nenhum deles declara rede social.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2022.zip'),

    ('tse-rede-social', 'andre-luis', 'andre-luis:rede-social', 'vazio_confirmado', 0,
      'Pacotes oficiais 2018/2020/2022/2024/2026 rechecados. Ate 05/08 nao existe SQ exato no seed nem registro 2026 por identidade exata; sem rota oficial de rede pessoal.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2026.zip'),
    ('tse-rede-social', 'camila-falcao', 'camila-falcao:rede-social', 'vazio_confirmado', 0,
      'Pacotes oficiais 2018/2020/2022/2024/2026 rechecados. Ate 05/08 nao existe SQ exato no seed nem registro 2026 por identidade exata; sem rota oficial de rede pessoal.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2026.zip'),
    ('tse-rede-social', 'dr-helton-monteiro', 'dr-helton-monteiro:rede-social', 'vazio_confirmado', 0,
      'Pacotes oficiais 2018/2020/2022/2024/2026 rechecados. Ate 05/08 nao existe SQ exato no seed nem registro 2026 por identidade exata; sem rota oficial de rede pessoal.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2026.zip'),
    ('tse-rede-social', 'elisson-ferreira', 'elisson-ferreira:rede-social', 'vazio_confirmado', 0,
      'Pacotes oficiais 2018/2020/2022/2024/2026 rechecados. Ate 05/08 nao existe SQ exato no seed nem registro 2026 por identidade exata; sem rota oficial de rede pessoal.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2026.zip'),
    ('tse-rede-social', 'eudo-raffael', 'eudo-raffael:rede-social', 'vazio_confirmado', 0,
      'Pacotes oficiais 2018/2020/2022/2024/2026 rechecados. Ate 05/08 nao existe SQ exato no seed nem registro 2026 por identidade exata; sem rota oficial de rede pessoal.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2026.zip'),
    ('tse-rede-social', 'gisvaldo-oliveira', 'gisvaldo-oliveira:rede-social', 'vazio_confirmado', 0,
      'Pacotes oficiais 2018/2020/2022/2024/2026 rechecados. Ate 05/08 nao existe SQ exato no seed nem registro 2026 por identidade exata; sem rota oficial de rede pessoal.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2026.zip'),
    ('tse-rede-social', 'jarir-pereira', 'jarir-pereira:rede-social', 'vazio_confirmado', 0,
      'Pacotes oficiais 2018/2020/2022/2024/2026 rechecados. Ate 05/08 nao existe SQ exato no seed nem registro 2026 por identidade exata; sem rota oficial de rede pessoal.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2026.zip'),
    ('tse-rede-social', 'lais-chaud', 'lais-chaud:rede-social', 'vazio_confirmado', 0,
      'Pacotes oficiais 2018/2020/2022/2024/2026 rechecados. Ate 05/08 nao existe SQ exato no seed nem registro 2026 por identidade exata; sem rota oficial de rede pessoal.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2026.zip'),
    ('tse-rede-social', 'marcus-sodre', 'marcus-sodre:rede-social', 'vazio_confirmado', 0,
      'Pacotes oficiais 2018/2020/2022/2024/2026 rechecados. O seed so tem SQ de 2014, fora da serie indicada para esta rodada, e nao ha registro 2026 por identidade exata; sem rota oficial de rede pessoal.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2026.zip'),
    ('tse-rede-social', 'witer-naves', 'witer-naves:rede-social', 'vazio_confirmado', 0,
      'Pacotes oficiais 2018/2020/2022/2024/2026 rechecados. Ate 05/08 nao existe SQ exato no seed nem registro 2026 por identidade exata; sem rota oficial de rede pessoal.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2026.zip'),
    ('tse-rede-social', 'yuri-ezequiel', 'yuri-ezequiel:rede-social', 'vazio_confirmado', 0,
      'Pacotes oficiais 2018/2020/2022/2024/2026 rechecados. Ate 05/08 nao existe SQ exato no seed nem registro 2026 por identidade exata; sem rota oficial de rede pessoal.',
      'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_2026.zip'),

    ('busca-redes-manual', 'yuri-ezequiel', 'instagram:yuriezequiel_80', 'indeterminado', 0,
      'Navegador autenticado: o Instagram respondeu pagina indisponivel, sem bio. A pista nao foi gravada.',
      'https://www.instagram.com/yuriezequiel_80/'),
    ('busca-redes-manual', 'dr-helton-monteiro', 'instagram:heltonmonteirosindimed', 'indeterminado', 0,
      'Navegador autenticado: o Instagram respondeu pagina indisponivel, sem bio. A pista nao foi gravada.',
      'https://www.instagram.com/heltonmonteirosindimed/'),
    ('busca-redes-manual', 'witer-naves', 'instagram:witernaves', 'indeterminado', 0,
      'Navegador autenticado: o Instagram respondeu pagina indisponivel, sem bio. A pista nao foi gravada.',
      'https://www.instagram.com/witernaves/'),
    ('busca-redes-manual', 'luiz-carlos-teodoro', 'instagram:luizcarlosteodoro.teodoro', 'indeterminado', 0,
      'Navegador autenticado: perfil privado visivel como Luiz Carlos Teodoro Teodoro, sem bio e sem sinal de RO, advocacia ou candidatura. A identidade nao foi confirmada e a conta nao foi gravada; mantida a conta advogadluiz declarada ao TSE.',
      'https://www.instagram.com/luizcarlosteodoro.teodoro/'),
    ('busca-redes-manual', 'aroldo-felix', 'instagram:aroldodiasfelix', 'indeterminado', 0,
      'Navegador autenticado: perfil visivel como Aroldo Felix, mas sem bio, localidade, partido ou candidatura. O nome sozinho nao resolve a divergencia de identidade; a conta nao foi gravada.',
      'https://www.instagram.com/aroldodiasfelix/'),
    ('busca-redes-manual', 'ravenna-castro', 'instagram:ravennacastrothe', 'indeterminado', 0,
      'Navegador autenticado: o Instagram respondeu pagina indisponivel, sem bio. Nenhuma nova gravacao; a conta ja existente permanece por ter sido declarada pela propria candidata ao TSE em 2024, SQ 180001905550.',
      'https://www.instagram.com/ravennacastrothe/'),
    ('busca-redes-manual', 'henrique-areas', 'facebook:henrique29pco', 'encontrado', 1,
      'Bio visivel confirmou Henrique Areas como militante e membro da direcao nacional do PCO. Nome e vinculo partidario confirmam a identidade; primeira rede pessoal gravada na ficha.',
      'https://www.facebook.com/henrique29pco'),
    ('busca-redes-manual', 'laudicerio-aguiar', 'facebook:drlaudicerio', 'encontrado', 1,
      'Bio visivel confirmou Laudicerio Machado, candidato politico, em Cuiaba (MT). Nenhuma sobrescrita: drlaudicerio ja estava gravado por declaracao do proprio candidato ao TSE.',
      'https://www.facebook.com/drlaudicerio'),
    ('busca-redes-manual', 'ravenna-castro', 'facebook:DraRavennaCastro', 'encontrado', 1,
      'Pagina visivel como Ravenna Castro, categoria blog pessoal, com conteudo de advocacia e referencia a Teresina. Nenhuma sobrescrita: ravennacastroadvocacia ja estava gravado por declaracao ao TSE em 2022.',
      'https://www.facebook.com/DraRavennaCastro'),
    ('foto-curadoria', 'marcus-sodre', 'marcus-sodre:foto', 'encontrado', 1,
      'Decisao editorial de Thiago em 05/08/2026: usar a imagem atual fornecida por ele em vez do retrato TSE de 2004. Fonte 1200x675 sha256 ff60f997a98d59351fe54923cdc9f80f8d7e8b04d524f5ee019402737ca5edc3; arquivo local 600x800 sha256 890c5a9d9ada31583e74674e8dff7d778c61b0f3e3f04bb9017ccb1a99248754. A origem tecnica local nao afirma autoria nem licenca.',
      NULL),
    ('curadoria-cargo', 'marcio-franca', 'marcio-franca:cargo_disputado', 'encontrado', 1,
      'Decisao editorial de Thiago em 05/08/2026, apoiada no anuncio de 25/06/2026: Marcio Franca e vice de Fernando Haddad na disputa pelo Governo de Sao Paulo.',
      'https://noticias.uol.com.br/politica/ultimas-noticias/2026/06/25/haddad-anuncia-vice.amp.htm')
), resolvidas AS (
  SELECT
    t.fonte,
    'candidato'::text AS escopo,
    t.alvo,
    c.id AS candidato_id,
    t.resultado,
    t.volume,
    t.detalhe,
    t.url,
    'manual:lacunas-publicaveis-20260805-continuacao'::text AS execucao
  FROM tentativas t
  JOIN public.candidatos c ON c.slug = t.slug
)
INSERT INTO public.coleta_log (
  fonte, escopo, alvo, candidato_id, resultado, volume, detalhe, url, execucao
)
SELECT
  r.fonte, r.escopo, r.alvo, r.candidato_id, r.resultado, r.volume,
  r.detalhe, r.url, r.execucao
FROM resolvidas r
WHERE NOT EXISTS (
  SELECT 1
  FROM public.coleta_log l
  WHERE l.execucao = r.execucao
    AND l.fonte = r.fonte
    AND l.alvo = r.alvo
);

DO $$
DECLARE
  cpf_atual text;
  naturalidade_atual text;
  facebook_atual text;
  foto_atual text;
  cargo_atual text;
  inativos_excluidos integer;
  logs integer;
BEGIN
  SELECT cpf, naturalidade
    INTO cpf_atual, naturalidade_atual
  FROM public.candidatos
  WHERE slug = 'cadu-xavier';

  SELECT redes_sociais->>'facebook'
    INTO facebook_atual
  FROM public.candidatos
  WHERE slug = 'henrique-areas';

  SELECT foto_url INTO foto_atual
  FROM public.candidatos
  WHERE slug = 'marcus-sodre';

  SELECT cargo_disputado INTO cargo_atual
  FROM public.candidatos
  WHERE slug = 'marcio-franca';

  SELECT count(*) INTO inativos_excluidos
  FROM public.candidatos
  WHERE slug IN ('aecio-neves', 'eduardo-leite', 'ricardo-nunes')
    AND publicavel = false;

  SELECT count(*) INTO logs
  FROM public.coleta_log
  WHERE execucao = 'manual:lacunas-publicaveis-20260805-continuacao';

  IF cpf_atual <> '07908568408'
     OR naturalidade_atual <> 'Rio Grande do Norte'
     OR facebook_atual <> 'henrique29pco'
     OR foto_atual <> '/candidates/marcus-sodre.jpg'
     OR cargo_atual <> 'Vice-Governador'
     OR inativos_excluidos <> 3
     OR logs <> 35 THEN
    RAISE EXCEPTION 'Pos-condicao falhou: cpf=%, naturalidade=%, facebook=%, foto=%, cargo=%, inativos=%, logs=%',
      cpf_atual, naturalidade_atual, facebook_atual, foto_atual, cargo_atual,
      inativos_excluidos, logs;
  END IF;
END $$;

COMMIT;
