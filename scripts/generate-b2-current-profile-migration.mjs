import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

const sourcePath = resolve(process.argv[2] ?? "")
const outputPath = resolve(process.argv[3] ?? "")
if (!process.argv[2] || !process.argv[3]) {
  throw new Error("uso: node scripts/generate-b2-current-profile-migration.mjs <proposals.jsonl> <migration.sql>")
}

const source = readFileSync(sourcePath, "utf8")
const profiles = source.trim().split(/\r?\n/).map((line) => JSON.parse(line))
const byField = (profile, field) => profile.proposals.filter((item) => item.field === field)
const selected = (profile, field, states) =>
  byField(profile, field).find((item) => states.includes(item.proposed_state)) ?? null

function normalizeUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null
  let value = raw.trim().replace(/^HTTPS?:/i, (match) => match.toLowerCase())
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  try {
    const url = new URL(value)
    return url.toString()
  } catch {
    return null
  }
}

function platformFor(url) {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "")
  if (host.includes("instagram.com")) return "instagram"
  if (host.includes("facebook.com")) return "facebook"
  if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube"
  if (host.includes("tiktok.com")) return "tiktok"
  if (host === "x.com" || host.endsWith(".x.com") || host.includes("twitter.com")) return "twitter"
  if (host.includes("linkedin.com")) return "linkedin"
  if (host === "t.me" || host.endsWith(".t.me") || host.includes("telegram.")) return "telegram"
  if (host.includes("kwai.com")) return "kwai"
  return "site_oficial"
}

function socialMap(proposal) {
  const out = {}
  for (const item of proposal?.proposed_value ?? []) {
    const url = normalizeUrl(item.url)
    if (!url) continue
    out[platformFor(url)] ??= url
  }
  return out
}

const data = profiles.map((profile) => {
  const registration = selected(
    profile,
    "current_candidacy_status",
    ["official_registration_found_not_equivalent_to_approval"],
  )?.proposed_value ?? null
  const socialProposal = selected(
    profile,
    "social_networks",
    ["official_self_declared_merge_fill_only"],
  )
  const siteProposal = selected(
    profile,
    "campaign_site",
    ["materialize_existing_site_oficial", "official_self_declared_website_for_review"],
  )
  const profession = selected(profile, "profession", ["official_2026_value_for_review"])
    ?.proposed_value ?? null
  const education = selected(profile, "education", ["official_2026_value_for_review"])
    ?.proposed_value ?? null
  const verification = selected(
    profile,
    "source_verification_dates",
    ["metadata_ready_for_field_level_storage"],
  )?.proposed_value ?? {}
  const networks = socialMap(socialProposal)
  const officialSocialRecord = socialProposal != null
  const site = normalizeUrl(siteProposal?.proposed_value)
  delete networks.site_oficial

  return {
    slug: profile.candidate_slug,
    registration,
    officialSocialRecord,
    networks,
    site,
    profession,
    education,
    verification,
  }
})

const count = (predicate) => data.filter(predicate).length
const counts = {
  profiles: data.length,
  registrations: count((row) => row.registration),
  official_social_records: count((row) => row.officialSocialRecord),
  social_profiles: count((row) => Object.keys(row.networks).length > 0),
  sites: count((row) => row.site),
  professions: count((row) => row.profession),
  education: count((row) => row.education),
  verification: count((row) => Object.keys(row.verification).length > 0),
}
const expected = {
  profiles: 194,
  registrations: 45,
  official_social_records: 43,
  social_profiles: 40,
  sites: 24,
  professions: 45,
  education: 45,
  verification: 194,
}
if (JSON.stringify(counts) !== JSON.stringify(expected)) {
  throw new Error(`fila inesperada: ${JSON.stringify(counts)}`)
}

const candidatesPath = fileURLToPath(new URL("../data/candidatos.json", import.meta.url))
const candidates = JSON.parse(readFileSync(candidatesPath, "utf8"))
const canonicalBySlug = new Map(
  candidates.map((candidate) => [candidate.slug, candidate.ids?.tse_sq_candidato?.["2026"]]),
)
const registrationMismatches = data.filter(
  (row) => row.registration &&
    String(canonicalBySlug.get(row.slug) ?? "") !== String(row.registration.sq_candidato),
)
if (registrationMismatches.length > 0) {
  throw new Error(
    `SQ 2026 ausente ou divergente no seed: ${registrationMismatches.map((row) => row.slug).join(", ")}`,
  )
}

const quote = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`
const json = (value) => `${quote(JSON.stringify(value))}::jsonb`
const cargo = (role) => ({
  PRESIDENTE: "Presidente",
  GOVERNADOR: "Governador",
  "VICE-GOVERNADOR": "Vice-Governador",
}[role] ?? null)

const values = data.map((row) => `  (${[
  quote(row.slug),
  quote(row.registration?.sq_candidato),
  quote(cargo(row.registration?.role)),
  quote(row.registration?.uf),
  quote(row.registration?.party),
  quote(row.registration?.judgment),
  quote(row.registration?.accepted_at),
  row.officialSocialRecord ? "true" : "false",
  json(row.networks),
  quote(row.site),
  quote(row.profession),
  quote(row.education),
  json(row.verification),
].join(", ")})`).join(",\n")

const sourceHash = createHash("sha256").update(source).digest("hex")
const sql = `BEGIN;

-- Atualizacao de perfil baseada no TSE 2026 e no readback publico da fila fechada.
-- Execucao: pf-completeness-20260807T022551Z
-- SHA-256 do ledger B2: ${sourceHash}
-- Registros encontrados aguardam julgamento; nao sao apresentados como deferidos.

ALTER TABLE public.candidatos
  ADD COLUMN IF NOT EXISTS verificacao_campos jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TEMP TABLE _pf_current_profile (
  slug text PRIMARY KEY,
  sq_candidato text,
  cargo_disputado text,
  uf text,
  partido text,
  julgamento text,
  recebido_em timestamp,
  registro_social_oficial boolean NOT NULL,
  redes jsonb NOT NULL,
  site text,
  profissao text,
  formacao text,
  verificacao_campos jsonb NOT NULL
) ON COMMIT DROP;

-- @write tabela=_pf_current_profile ref=B2-perfis-20260807 campos=perfil,redes,site,profissao,formacao,verificacao
INSERT INTO _pf_current_profile
SELECT *
FROM (VALUES
${values}
) AS source(
  slug, sq_candidato, cargo_disputado, uf, partido, julgamento, recebido_em,
  registro_social_oficial, redes, site, profissao, formacao, verificacao_campos
)
WHERE 'B2-perfis-20260807' = 'B2-perfis-20260807';

CREATE OR REPLACE FUNCTION pg_temp.pf_social_has_value(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE jsonb_typeof(value)
    WHEN 'string' THEN btrim(value #>> '{}') <> ''
    WHEN 'number' THEN true
    WHEN 'boolean' THEN true
    WHEN 'array' THEN jsonb_array_length(value) > 0
    WHEN 'object' THEN EXISTS (
      SELECT 1 FROM jsonb_each(value) item
      WHERE pg_temp.pf_social_has_value(item.value)
    )
    ELSE false
  END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.pf_merge_social(existing jsonb, proposed jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(jsonb_object_agg(keys.key,
    CASE
      WHEN pg_temp.pf_social_has_value(COALESCE(existing, '{}'::jsonb) -> keys.key)
        OR NOT COALESCE(proposed, '{}'::jsonb) ? keys.key
      THEN COALESCE(existing, '{}'::jsonb) -> keys.key
      ELSE proposed -> keys.key
    END
  ), '{}'::jsonb)
  FROM jsonb_object_keys(COALESCE(existing, '{}'::jsonb) || COALESCE(proposed, '{}'::jsonb)) keys(key)
$fn$;

DO $guard$
BEGIN
  IF (SELECT count(*) FROM _pf_current_profile) <> 194 THEN
    RAISE EXCEPTION 'B2 perfil: cardinalidade diferente de 194';
  END IF;
  IF (SELECT count(*) FROM _pf_current_profile WHERE sq_candidato IS NOT NULL) <> 45 THEN
    RAISE EXCEPTION 'B2 perfil: registros TSE diferentes de 45';
  END IF;
  IF (SELECT count(*) FROM _pf_current_profile WHERE registro_social_oficial) <> 43 THEN
    RAISE EXCEPTION 'B2 perfil: registros sociais TSE diferentes de 43';
  END IF;
  IF (SELECT count(*) FROM _pf_current_profile WHERE site IS NOT NULL) <> 24 THEN
    RAISE EXCEPTION 'B2 perfil: sites materializaveis diferentes de 24';
  END IF;
  IF EXISTS (
    SELECT 1 FROM _pf_current_profile d
    LEFT JOIN public.candidatos c ON c.slug = d.slug
    WHERE c.id IS NULL
  ) THEN
    RAISE EXCEPTION 'B2 perfil: slug sem candidato correspondente';
  END IF;
END
$guard$;

-- @write tabela=candidatos ref=B2-perfis-20260807 campos=status,situacao_candidatura,cargo_disputado,estado,partido_sigla,partido_atual,redes_sociais,site_campanha,profissao_declarada,formacao,fonte_dados,ultima_atualizacao,verificacao_campos
UPDATE public.candidatos c
SET
  status = CASE WHEN d.sq_candidato IS NOT NULL THEN 'candidato' ELSE c.status END,
  situacao_candidatura = CASE
    WHEN d.sq_candidato IS NOT NULL THEN 'aguardando julgamento'
    ELSE c.situacao_candidatura
  END,
  cargo_disputado = COALESCE(d.cargo_disputado, c.cargo_disputado),
  estado = COALESCE(d.uf, c.estado),
  partido_sigla = COALESCE(d.partido, c.partido_sigla),
  partido_atual = COALESCE(d.partido, c.partido_atual),
  redes_sociais = pg_temp.pf_merge_social(c.redes_sociais, d.redes),
  site_campanha = CASE
    WHEN COALESCE(btrim(c.site_campanha), '') = '' THEN d.site
    ELSE c.site_campanha
  END,
  profissao_declarada = CASE
    WHEN COALESCE(btrim(c.profissao_declarada), '') = '' OR c.profissao_declarada ~ '^Q[0-9]+$'
      THEN COALESCE(d.profissao, c.profissao_declarada)
    ELSE c.profissao_declarada
  END,
  formacao = CASE
    WHEN COALESCE(btrim(c.formacao), '') = '' THEN COALESCE(d.formacao, c.formacao)
    ELSE c.formacao
  END,
  fonte_dados = ARRAY(
    SELECT DISTINCT source
    FROM unnest(
      COALESCE(c.fonte_dados, ARRAY[]::text[]) ||
      CASE
        WHEN d.sq_candidato IS NOT NULL
          THEN ARRAY['TSE consulta_cand 2026 SQ ' || d.sq_candidato]
        ELSE ARRAY[]::text[]
      END ||
      CASE
        WHEN d.registro_social_oficial THEN ARRAY['TSE redes sociais 2026']
        ELSE ARRAY[]::text[]
      END
    ) AS source
  ),
  ultima_atualizacao = now(),
  verificacao_campos = COALESCE(c.verificacao_campos, '{}'::jsonb) || d.verificacao_campos
FROM _pf_current_profile d
WHERE c.slug = d.slug
  AND 'B2-perfis-20260807' = 'B2-perfis-20260807';

-- @write tabela=historico_politico ref=B2-perfis-20260807 campos=tipo_evento,cargo,cargo_canonico,estado,periodo_inicio,periodo_fim,partido,eleito_por,observacoes,proveniencia
INSERT INTO public.historico_politico (
  candidato_id, tipo_evento, cargo, cargo_canonico, estado,
  periodo_inicio, periodo_fim, partido, eleito_por, observacoes, proveniencia
)
SELECT
  c.id, 'candidatura', d.cargo_disputado, d.cargo_disputado, d.uf,
  2026, 2026, d.partido, 'pedido de registro no TSE',
  'Pedido de registro de candidatura no TSE; aguardando julgamento em 06/08/2026.',
  'TSE'
FROM _pf_current_profile d
JOIN public.candidatos c ON c.slug = d.slug
WHERE d.sq_candidato IS NOT NULL
  AND 'B2-perfis-20260807' = 'B2-perfis-20260807'
ON CONFLICT (candidato_id, cargo_canonico, periodo_inicio)
WHERE periodo_inicio IS NOT NULL AND cargo_canonico IS NOT NULL
DO UPDATE SET
  tipo_evento = EXCLUDED.tipo_evento,
  cargo = EXCLUDED.cargo,
  estado = EXCLUDED.estado,
  periodo_fim = EXCLUDED.periodo_fim,
  partido = EXCLUDED.partido,
  eleito_por = EXCLUDED.eleito_por,
  observacoes = EXCLUDED.observacoes,
  proveniencia = EXCLUDED.proveniencia;

GRANT SELECT (verificacao_campos) ON TABLE public.candidatos TO anon, authenticated;

CREATE OR REPLACE VIEW public.candidatos_publico
WITH (security_invoker = true) AS
 SELECT id,
    nome_completo,
    nome_urna,
    slug,
    data_nascimento,
    COALESCE(idade, EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, data_nascimento::timestamp with time zone))::integer) AS idade,
    naturalidade,
    formacao,
    profissao_declarada,
    genero,
    estado_civil,
    cor_raca,
    partido_atual,
    partido_sigla,
    cargo_atual,
    cargo_disputado,
    estado,
    status,
    situacao_candidatura,
    biografia,
    foto_url,
    site_campanha,
    redes_sociais,
    (SELECT array_agg(f.valor ORDER BY f.ord)
       FROM unnest(c.fonte_dados) WITH ORDINALITY AS f(valor, ord)
      WHERE f.valor NOT LIKE 'interno:%') AS fonte_dados,
    ultima_atualizacao,
    verificacao_campos
   FROM public.candidatos c
  WHERE status <> 'removido'::text AND publicavel = true;

GRANT SELECT ON public.candidatos_publico TO anon, authenticated;

COMMIT;
`

writeFileSync(outputPath, sql)
console.log(JSON.stringify({ source_sha256: sourceHash, counts, output: outputPath }))
