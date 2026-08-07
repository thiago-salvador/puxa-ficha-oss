BEGIN;

-- Ausência de mandato é um fato neutro de trajetória, não alerta editorial.
-- Fila A1 fechada: exatamente cinco pontos ainda estavam visíveis.
CREATE TEMP TABLE _pf_no_mandate_alerts (
  slug text NOT NULL,
  titulo text NOT NULL,
  PRIMARY KEY (slug, titulo)
) ON COMMIT DROP;

-- @write tabela=_pf_no_mandate_alerts ref=A1-sem-mandato-20260807 campos=slug,titulo
INSERT INTO _pf_no_mandate_alerts (slug, titulo)
SELECT slug, titulo
FROM (VALUES
  ('cadu-xavier', 'Trajetória em cargos de governo, sem mandato eletivo'),
  ('hertz-dias', 'Trajetória eleitoral sem mandato eletivo'),
  ('maria-do-carmo', 'Sem mandato eletivo federal ou estadual registrado'),
  ('ronaldo-mansur', 'Sem mandato eletivo federal ou estadual registrado'),
  ('samara-martins', 'Trajetória eleitoral sem mandato eletivo')
) AS source(slug, titulo)
WHERE 'A1-sem-mandato-20260807' = 'A1-sem-mandato-20260807';

DO $guard$
DECLARE
  matched integer;
BEGIN
  SELECT count(*) INTO matched
  FROM _pf_no_mandate_alerts d
  JOIN public.candidatos c ON c.slug = d.slug
  JOIN public.pontos_atencao p
    ON p.candidato_id = c.id
   AND p.titulo = d.titulo
   AND p.visivel = true;

  IF matched <> 5 THEN
    RAISE EXCEPTION 'A1 alertas sem mandato: somente % de 5 correspondem ao banco', matched;
  END IF;
END
$guard$;

-- @write tabela=pontos_atencao ref=A1-sem-mandato-20260807 campos=visivel,despublicacao_motivo,despublicado_em
UPDATE public.pontos_atencao p
SET visivel = false,
    despublicacao_motivo = 'Ausencia de mandato e um dado neutro de trajetoria e nao deve ser publicada como alerta editorial.',
    despublicado_em = COALESCE(p.despublicado_em, now())
FROM _pf_no_mandate_alerts d
JOIN public.candidatos c ON c.slug = d.slug
WHERE p.candidato_id = c.id
  AND p.titulo = d.titulo
  AND p.visivel = true
  AND 'A1-sem-mandato-20260807' = 'A1-sem-mandato-20260807';

COMMIT;
