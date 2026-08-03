-- Correção local pendente: bens declarados por Thor Dantas no TSE 2022.
-- Fonte: TSE Dados Abertos bem_candidato_2022_AC.csv e BRASIL.csv,
-- SQ_CANDIDATO 10001649411. O pacote contém 11 linhas; a migration anterior
-- materializou apenas o valor agregado e deixou bens como [] por engano.

-- @write tabela=patrimonio slug=thor-dantas ano=2022 campos=bens,fonte
UPDATE public.patrimonio p
SET
  bens = '[
    {"tipo":"Veículo automotor terrestre: caminhão, automóvel, moto, etc.","descricao":"TOYTOTA ETIOS HB CROSS ANO 2017/2018","valor":60000.00},
    {"tipo":"Quotas ou quinhões de capital","descricao":"QUOTA DE CAPITAL DA EMPRESA LAGE E DANTAS, SOCIEDADE SIMPLES 50% DO CAPITAL","valor":1000.00},
    {"tipo":"Quotas ou quinhões de capital","descricao":"QUOTA DE CAPITAL DA EMPRESA LAGE E DANTAS EDUCAÇÃO MÉDICA 50% DO CAPITAL","valor":1000.00},
    {"tipo":"Caderneta de poupança","descricao":"POUPANÇA","valor":0.06},
    {"tipo":"Caderneta de poupança","descricao":"POUPANÇA","valor":324.16},
    {"tipo":"Aplicação de renda fixa (CDB, RDB e outros)","descricao":"AÇÕES TECNOLOGIA BDR","valor":1000.00},
    {"tipo":"Aplicação de renda fixa (CDB, RDB e outros)","descricao":"AÇÕES SMALL CAPS","valor":1000.00},
    {"tipo":"Aplicação de renda fixa (CDB, RDB e outros)","descricao":"RF LP HIGH","valor":99596.71},
    {"tipo":"Aplicação de renda fixa (CDB, RDB e outros)","descricao":"BB AMERICANAS PERSONAL MONKEY MARKET","valor":22524.90},
    {"tipo":"Depósito bancário em conta corrente no País","descricao":"CONTA BANCO DO BRASIL","valor":16950.92},
    {"tipo":"Crédito decorrente de empréstimo","descricao":"EMPRESTIMO CONCEDIDO","valor":50000.00}
  ]'::jsonb,
  fonte = 'TSE Dados Abertos bem_candidato_2022_AC.csv e BRASIL.csv, SQ 10001649411'
FROM public.candidatos c
WHERE p.candidato_id = c.id
  AND c.slug = 'thor-dantas'
  AND p.ano_eleicao = 2022;
