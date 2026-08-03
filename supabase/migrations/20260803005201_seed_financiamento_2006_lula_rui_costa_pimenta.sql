-- Financiamento de campanha 2006: lula e rui-costa-pimenta.
-- Fonte: cdn.tse.jus.br/estatistica/sead/odsele/prestacao_contas/prestacao_contas_2006.zip
-- membro prestacao_contas_2006/2006/Candidato/Receita/ReceitaCandidato.csv (layout legado).
-- Identidade confirmada em consulta_cand_2006_BR.csv: lula SEQUENCIAL 23, rui-costa-pimenta 27,
-- filtrando tambem DESCRICAO_CARGO = 'Presidente'. Detalhe completo em
-- supabase/migrations/20260802120000_seed_financiamento_2006_lula_rui_costa_pimenta.sql

INSERT INTO public.financiamento (
  candidato_id, ano_eleicao, total_arrecadado, total_fundo_partidario,
  total_fundo_eleitoral, total_pessoa_fisica, total_recursos_proprios,
  maiores_doadores, fonte
)
SELECT c.id, 2006,
       81188298.01, 13850429.29,
       0.00, 159362.75,
       0.00,
       '[{"nome": "COMITÊ FINANCEIRO NACIONAL PARA PRESIDENTE DA REPÚBLICA PT-DF", "valor": 51355307.57, "tipo": "PJ"}, {"nome": "DIRETÓRIO NACIONAL PT-BR", "valor": 11505187.3, "tipo": "fundo_partidario"}, {"nome": "COMITÊ FINANCEIRO NACIONAL PARA PRESIDENTE DA REPÚBLICA PT-BR", "valor": 9950000, "tipo": "PJ"}, {"nome": "COMITÊ FINANCEIRO NACIONAL PARA PRESIDENTE DA REPÚBLICA PT-", "valor": 1650000, "tipo": "PJ"}, {"nome": "COMITÊ FINANCEIRO ÚNICO PT-DF", "valor": 1483375.64, "tipo": "PJ", "cnpj": "08142719000179"}, {"nome": "DIRETÓRIO REGIONAL PT-SP", "valor": 1002421.46, "tipo": "fundo_partidario"}, {"nome": "CARIOCA CHRISTIANI NIELSEN ENGENHARIA S A", "valor": 500000, "tipo": "PJ", "cnpj": "40450769000126"}, {"nome": "JAQUES WAGNER 13-BA", "valor": 420806, "tipo": "PJ"}, {"nome": "DIRETÓRIO REGIONAL PT-MG", "valor": 291068.82, "tipo": "fundo_partidario"}, {"nome": "DIRETÓRIO REGIONAL PT-PR", "valor": 287059.87, "tipo": "fundo_partidario"}]'::jsonb,
       'TSE'
FROM public.candidatos c
WHERE c.slug = 'lula'
  AND NOT EXISTS (
    SELECT 1 FROM public.financiamento f
    WHERE f.candidato_id = c.id AND f.ano_eleicao = 2006
  );

INSERT INTO public.financiamento (
  candidato_id, ano_eleicao, total_arrecadado, total_fundo_partidario,
  total_fundo_eleitoral, total_pessoa_fisica, total_recursos_proprios,
  maiores_doadores, fonte
)
SELECT c.id, 2006,
       11000.00, 11000.00,
       0.00, 0.00,
       0.00,
       '[{"nome": "DIRETÓRIO NACIONAL PCO-BR", "valor": 11000, "tipo": "fundo_partidario"}]'::jsonb,
       'TSE'
FROM public.candidatos c
WHERE c.slug = 'rui-costa-pimenta'
  AND NOT EXISTS (
    SELECT 1 FROM public.financiamento f
    WHERE f.candidato_id = c.id AND f.ano_eleicao = 2006
  );;
