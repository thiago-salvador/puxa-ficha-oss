-- Snapshot de cobertura por candidato (somente leitura), 2026-08-02.
--
-- Devolve UMA linha, UMA coluna (`snapshot`), com o array JSON que
-- `scripts/audit/coverage-report.ts --from-snapshot=PATH` consome. Existe para
-- que o relatório possa ser gerado em ambiente sem SUPABASE_SERVICE_ROLE_KEY na
-- máquina (o script também sabe ler o banco direto quando as credenciais estão
-- presentes; o resultado é o mesmo).
--
-- Rodar com: psql, o SQL editor do Supabase, ou o MCP do Supabase, e salvar o
-- valor da coluna `snapshot` num arquivo .json.
--
-- Fonte da idade: a view pública `candidatos_publico`, que faz
-- COALESCE(idade, extract(year from age(data_nascimento))). A coluna crua
-- `candidatos.idade` é NULL para todo mundo e subcontaria "dados pessoais".

select jsonb_agg(linha order by linha->>'slug') as snapshot
from (
  select jsonb_build_object(
    'slug', c.slug,
    'nome_urna', coalesce(c.nome_urna, c.slug),
    'partido_sigla', c.partido_sigla,
    'cargo_disputado', c.cargo_disputado,
    'estado', c.estado,
    'foto', c.foto_url is not null,
    'bio', c.biografia is not null,
    'redes', coalesce(c.redes_sociais, '{}'::jsonb) <> '{}'::jsonb
             and coalesce(c.redes_sociais, '[]'::jsonb) <> '[]'::jsonb,
    'idade', c.idade,
    'naturalidade', c.naturalidade,
    'formacao', c.formacao,
    'profissao', c.profissao_declarada,
    'historico', coalesce((
      select jsonb_agg(jsonb_build_object(
        'cargo_canonico', h.cargo_canonico,
        'tipo_evento', h.tipo_evento,
        'periodo_inicio', h.periodo_inicio,
        'periodo_fim', h.periodo_fim))
      from historico_politico h where h.candidato_id = c.id), '[]'::jsonb),
    'mudancas', (select count(*) from mudancas_partido m where m.candidato_id = c.id),
    'patrimonioAnos', coalesce((
      select jsonb_agg(p.ano_eleicao) from patrimonio p where p.candidato_id = c.id), '[]'::jsonb),
    'patrimonioAnosComBens', coalesce((
      select jsonb_agg(p.ano_eleicao) from patrimonio p
      where p.candidato_id = c.id and jsonb_typeof(p.bens) = 'array'
        and jsonb_array_length(p.bens) > 0), '[]'::jsonb),
    'financiamentoAnos', coalesce((
      select jsonb_agg(f.ano_eleicao) from financiamento f where f.candidato_id = c.id), '[]'::jsonb),
    'financiamentoAnosComDoadores', coalesce((
      select jsonb_agg(f.ano_eleicao) from financiamento f
      where f.candidato_id = c.id and jsonb_typeof(f.maiores_doadores) = 'array'
        and jsonb_array_length(f.maiores_doadores) > 0), '[]'::jsonb),
    'votos', (select count(*) from votos_candidato v where v.candidato_id = c.id),
    'contradicoes', (
      select count(*) from pontos_atencao pa
      where pa.candidato_id = c.id and pa.visivel
        and translate(pa.categoria, 'áéíóúãõçâêô', 'aeiouaocaeo') in ('contradicao', 'mudanca_posicao')),
    'processos', (select count(*) from processos pr where pr.candidato_id = c.id),
    'alertas', (
      select count(*) from pontos_atencao pa
      where pa.candidato_id = c.id and pa.visivel and pa.categoria <> 'feito_positivo'),
    'projetos', (select count(*) from projetos_lei pl where pl.candidato_id = c.id),
    'destaques', (select count(*) from projetos_lei pl where pl.candidato_id = c.id and pl.destaque),
    'gastosAnos', coalesce((
      select jsonb_agg(g.ano) from gastos_parlamentares g where g.candidato_id = c.id), '[]'::jsonb),
    'legislacaoExecutivo', (
      select count(*) from legislacao_mandato_executivo l where l.candidato_id = c.id),
    'noticias', (select count(*) from noticias_candidato n where n.candidato_id = c.id),
    'posicoesTemas', coalesce((
      select jsonb_agg(distinct pd.tema) from posicoes_declaradas pd where pd.candidato_id = c.id), '[]'::jsonb),
    'sancoes', (select count(*) from sancoes_administrativas s where s.candidato_id = c.id)
  ) as linha
  from candidatos_publico c
) t;
