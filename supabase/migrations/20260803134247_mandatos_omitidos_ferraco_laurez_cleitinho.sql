-- Tres claims NO AR que contam mandatos errado.
-- Aprovado por Thiago em 2026-08-03 (payload cruzamento-factchecks, acao B=aplicar).
-- Criterio: cargo eletivo distinto. Nomeacao nao conta, e sucessao tambem nao.

-- @write tabela=pontos_atencao slug=ricardo-ferraco campos=titulo,descricao
UPDATE public.pontos_atencao pa
SET titulo = 'Carreira política: 5 cargo(s) eletivo(s) registrado(s)',
    descricao = 'Ricardo de Rezende Ferraço (MDB) possui 5 cargo(s) eletivo(s) registrado(s): Vereador (Cachoeiro de Itapemirim), Deputado Estadual (ES, dois mandatos), Deputado Federal (ES, 1999-2003), Vice-Governador (ES, dois mandatos) e Senador (ES, 2011-2019). Assumiu o governo do Espírito Santo em 2 de abril de 2026 por sucessão, sem ter sido eleito para o cargo.'
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

-- @write tabela=pontos_atencao slug=cleitinho campos=titulo,descricao
UPDATE public.pontos_atencao pa
SET titulo = 'Carreira política: 3 mandato(s) registrado(s)',
    descricao = 'Cleitinho Azevedo (REPUBLICANOS) possui 3 mandato(s) registrado(s): Vereador (Divinópolis), Deputado Estadual (MG, 2019-2023) e Senador (MG). A página oficial da Assembleia Legislativa de Minas Gerais registra o mandato estadual como efetivo, encerrado para assumir o Senado.'
FROM public.candidatos c
WHERE c.id = pa.candidato_id
  AND c.slug = 'cleitinho'
  AND pa.id = '07fc71d4-ad3a-4acd-ac99-222f5d94a2f8'
  AND pa.visivel = true;;
