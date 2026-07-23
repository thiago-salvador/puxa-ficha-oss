/**
 * Contrato local para fontes oficiais permitidas em legislacao_mandato_executivo.
 *
 * Este módulo define:
 * - Estrutura de fonte oficial permitida
 * - Registry de fontes oficiais (fontes federais reais aplicadas em Fase 5B.3;
 *   estaduais SP/PR/RS/GO/CE promovidas a fontes reais em Fluxo 5B expansão estadual)
 * - Função para validar se uma fonte_primaria_url pertence a uma fonte cadastrada
 *
 * Sem consultas à internet. Sem dados reais inseridos no registry além de origins
 * oficiais. Sem adapter remoto.
 */

export type LegislacaoEsfera = "federal" | "estadual" | "municipal"

export interface FonteOficial {
  esfera: LegislacaoEsfera
  uf?: string // Obrigatório para estadual e municipal
  municipio?: string // Obrigatório para municipal; comparado case-insensitive
  padrao_url: string // Origin permitido para validação local (comparação exata de origin)
  nome: string // Nome descritivo da fonte
}

export interface ValidacaoFonteResult {
  valido: boolean
  erro?: string
}

/**
 * Registry de fontes oficiais permitidas.
 *
 * Fontes federais reais aplicadas em Fase 5B.3:
 * - Planalto portal/índice: https://www4.planalto.gov.br
 * - Planalto textos normativos finais: https://www.planalto.gov.br
 * - Diário Oficial da União: https://in.gov.br
 * - Congresso Nacional/Simplificou: https://www.congressonacional.leg.br
 *
 * Fonte estadual SP promovida a real no Fluxo 5B expansão estadual:
 * - Assembleia Legislativa do Estado de São Paulo (repositório de legislação):
 *   https://www.al.sp.gov.br
 *
 * Fonte estadual PR promovida a real no Fluxo 5B expansão factual v2:
 * - Sistema Legislação do Estado do Paraná:
 *   https://www.legislacao.pr.gov.br
 *
 * Fontes estaduais RS promovidas a reais no Fluxo 5B expansão factual RS:
 * - Portal do Estado do Rio Grande do Sul (Atos do Governador/DOE):
 *   https://www.estado.rs.gov.br
 * - Diário Oficial do Estado do Rio Grande do Sul:
 *   https://www.diariooficial.rs.gov.br
 *
 * Fonte estadual GO promovida a real no Fluxo 5B expansão presidencial:
 * - Casa Civil do Estado de Goiás - Legisla Goiás:
 *   https://legisla.casacivil.go.gov.br
 *
 * Fonte estadual CE promovida a real no Fluxo 5B expansão presidencial:
 * - Assembleia Legislativa do Estado do Ceará - Banco Eletrônico de Leis Temáticas:
 *   https://belt.al.ce.gov.br
 *
 * Fonte estadual MA promovida a real no Fluxo 5B full-site Orleans:
 * - Secretaria de Estado de Transparência e Controle do Maranhão - Legisla:
 *   https://app.stc.ma.gov.br
 *
 * Fontes estaduais RR/PA/PB/AC promovidas a reais no Lote C Executivo
 * residuais (2026-05-08):
 * - Portal/API de Transparência do Governo de Roraima:
 *   https://api.transparencia.rr.gov.br
 * - Imprensa Oficial do Estado do Pará:
 *   https://www.ioepa.com.br
 * - Diário Oficial do Estado da Paraíba - A União:
 *   https://auniao.pb.gov.br
 * - Sistema de Legislação do Acre:
 *   https://legis.ac.gov.br
 *
 * Demais UFs estaduais além de SP, PR, RS, GO, CE, MA, RR, PA, PB e AC continuam sem fonte registrada; inclusão
 * exige curadoria específica por UF com fonte primária oficial comprovada.
 *
 * Esfera municipal: o tipo passa a ser aceito após o uplift schema
 * 20260502170000 (aplicada remotamente em 2026-05-02 / Prompt 13).
 *
 * Fonte municipal CE/Fortaleza promovida a real no Prompt 14 (2026-05-02):
 * - SAPL - Sistema de Apoio ao Processo Legislativo da Câmara Municipal de Fortaleza:
 *   https://sapl.fortaleza.ce.leg.br
 *   (subdomínio oficial Interlegis sob o TLD .leg.br atribuído pelo Senado
 *   Federal a casas legislativas; API JSON pública /api/norma/normajuridica/
 *   com URL estável /norma/<id> e identificador canônico SAPL-FOR:<id>).
 *
 * Inclusão de novas fontes municipais (e.g. para mandatos pré-internet de
 * outros candidatos) continua exigindo curadoria específica + prova de URL
 * estável + signatário/autoridade_papel verificáveis por row.
 *
 * Fontes municipais MA/São Pedro dos Crentes e RS/Guaíba promovidas a reais
 * no Lote C Executivo residuais (2026-05-08):
 * - Portal de leis da Prefeitura Municipal de São Pedro dos Crentes:
 *   https://www.saopedrodoscrentes.ma.gov.br
 * - Diário Oficial dos Municípios do Estado do Rio Grande do Sul/FAMURS:
 *   https://www.diariomunicipal.com.br
 */
const REGISTRY_FONTE_OFICIAL: FonteOficial[] = [
  // Federal - Portal da Legislação (Planalto) - portal/índice
  {
    esfera: "federal",
    padrao_url: "https://www4.planalto.gov.br",
    nome: "Portal da Legislação - Presidência da República (índice)",
  },
  // Federal - Portal da Legislação (Planalto) - textos normativos finais
  {
    esfera: "federal",
    padrao_url: "https://www.planalto.gov.br",
    nome: "Portal da Legislação - Presidência da República (textos finais)",
  },
  // Federal - Diário Oficial da União
  {
    esfera: "federal",
    padrao_url: "https://in.gov.br",
    nome: "Diário Oficial da União - Imprensa Nacional",
  },
  // Federal - Congresso Nacional (tramitação)
  {
    esfera: "federal",
    padrao_url: "https://www.congressonacional.leg.br",
    nome: "Congresso Nacional - Portal Simplificou",
  },
  // Estadual SP - ALESP (Assembleia Legislativa do Estado de São Paulo)
  {
    esfera: "estadual",
    uf: "SP",
    padrao_url: "https://www.al.sp.gov.br",
    nome: "Assembleia Legislativa do Estado de São Paulo - Repositório de Legislação",
  },
  // Estadual PR - Sistema Legislação do Estado do Paraná
  {
    esfera: "estadual",
    uf: "PR",
    padrao_url: "https://www.legislacao.pr.gov.br",
    nome: "Sistema Legislação do Estado do Paraná",
  },
  // Estadual RS - Portal do Estado do Rio Grande do Sul (Atos do Governador/DOE)
  {
    esfera: "estadual",
    uf: "RS",
    padrao_url: "https://www.estado.rs.gov.br",
    nome: "Portal do Estado do Rio Grande do Sul - Atos do Governador/DOE",
  },
  // Estadual RS - Diário Oficial do Estado do Rio Grande do Sul
  {
    esfera: "estadual",
    uf: "RS",
    padrao_url: "https://www.diariooficial.rs.gov.br",
    nome: "Diário Oficial do Estado do Rio Grande do Sul",
  },
  // Estadual GO - Casa Civil do Estado de Goiás (Legisla Goiás)
  {
    esfera: "estadual",
    uf: "GO",
    padrao_url: "https://legisla.casacivil.go.gov.br",
    nome: "Casa Civil do Estado de Goiás - Legisla Goiás",
  },
  // Estadual CE - Assembleia Legislativa do Estado do Ceará (Banco Eletrônico de Leis Temáticas)
  {
    esfera: "estadual",
    uf: "CE",
    padrao_url: "https://belt.al.ce.gov.br",
    nome: "Assembleia Legislativa do Estado do Ceará - Banco Eletrônico de Leis Temáticas",
  },
  // Estadual MA - STC/MA Legisla
  {
    esfera: "estadual",
    uf: "MA",
    padrao_url: "https://app.stc.ma.gov.br",
    nome: "Secretaria de Estado de Transparência e Controle do Maranhão - Legisla",
  },
  // Estadual RR - Portal/API de Transparência do Governo de Roraima
  {
    esfera: "estadual",
    uf: "RR",
    padrao_url: "https://api.transparencia.rr.gov.br",
    nome: "Portal/API de Transparência do Governo de Roraima - Legislações",
  },
  // Estadual PA - Imprensa Oficial do Estado do Pará
  {
    esfera: "estadual",
    uf: "PA",
    padrao_url: "https://www.ioepa.com.br",
    nome: "Imprensa Oficial do Estado do Pará - Diário Oficial",
  },
  // Estadual PB - Diário Oficial do Estado da Paraíba (A União)
  {
    esfera: "estadual",
    uf: "PB",
    padrao_url: "https://auniao.pb.gov.br",
    nome: "Diário Oficial do Estado da Paraíba - A União",
  },
  // Estadual AC - Sistema de Legislação do Acre
  {
    esfera: "estadual",
    uf: "AC",
    padrao_url: "https://legis.ac.gov.br",
    nome: "Sistema de Legislação do Acre",
  },
  // Municipal CE/Fortaleza - SAPL da Câmara Municipal de Fortaleza
  {
    esfera: "municipal",
    uf: "CE",
    municipio: "Fortaleza",
    padrao_url: "https://sapl.fortaleza.ce.leg.br",
    nome: "Sistema de Apoio ao Processo Legislativo - Câmara Municipal de Fortaleza (SAPL)",
  },
  // Municipal MA/São Pedro dos Crentes - Portal de leis da prefeitura
  {
    esfera: "municipal",
    uf: "MA",
    municipio: "São Pedro dos Crentes",
    padrao_url: "https://www.saopedrodoscrentes.ma.gov.br",
    nome: "Prefeitura Municipal de São Pedro dos Crentes - Portal de Leis",
  },
  // Municipal RS/Guaíba - Diário Oficial dos Municípios do RS/FAMURS
  {
    esfera: "municipal",
    uf: "RS",
    municipio: "Guaíba",
    padrao_url: "https://www.diariomunicipal.com.br",
    nome: "Diário Oficial dos Municípios do Estado do Rio Grande do Sul - FAMURS",
  },
]

/**
 * Valida se uma fonte_primaria_url pertence a uma fonte oficial cadastrada.
 *
 * @param url - A URL a ser validada
 * @param esfera - A esfera (federal, estadual ou municipal)
 * @param uf_norma - A UF (obrigatória para estadual e municipal, deve ser null para federal)
 * @param municipio_norma - O município (obrigatório para municipal, deve ser null para federal/estadual)
 * @returns Resultado da validação com erro descritivo se inválido
 */
export function validarFonteOficial(
  url: string,
  esfera: LegislacaoEsfera,
  uf_norma: string | null,
  municipio_norma: string | null = null
): ValidacaoFonteResult {
  // Para estadual e municipal, UF é obrigatória
  if (esfera === "estadual" || esfera === "municipal") {
    if (!uf_norma) {
      return {
        valido: false,
        erro: `uf_norma é obrigatório para esfera ${esfera}`,
      }
    }
  }

  // Para municipal, município é obrigatório
  if (esfera === "municipal") {
    if (!municipio_norma || municipio_norma.trim() === "") {
      return {
        valido: false,
        erro: "municipio_norma é obrigatório para esfera municipal",
      }
    }
  }

  // Para federal, UF e município devem ser null
  if (esfera === "federal") {
    if (uf_norma !== null) {
      return {
        valido: false,
        erro: "uf_norma deve ser null para esfera federal",
      }
    }
    if (municipio_norma !== null) {
      return {
        valido: false,
        erro: "municipio_norma deve ser null para esfera federal",
      }
    }
  }

  // Para estadual, município deve ser null
  if (esfera === "estadual" && municipio_norma !== null) {
    return {
      valido: false,
      erro: "municipio_norma deve ser null para esfera estadual",
    }
  }

  // Normaliza UF para uppercase antes de buscar no registry
  const uf_norma_normalizado = uf_norma ? uf_norma.toUpperCase() : null
  const municipio_norma_normalizado = municipio_norma ? municipio_norma.trim().toLowerCase() : null

  // Filtra todas as fontes no registry compatíveis com esfera e UF (se aplicável)
  const fontesCompativeis = REGISTRY_FONTE_OFICIAL.filter((fonte) => {
    if (fonte.esfera !== esfera) {
      return false
    }
    if (esfera === "estadual") {
      return fonte.uf === uf_norma_normalizado
    }
    if (esfera === "municipal") {
      if (fonte.uf !== uf_norma_normalizado) return false
      return (fonte.municipio ?? "").trim().toLowerCase() === municipio_norma_normalizado
    }
    return true // federal não precisa de UF
  })

  if (fontesCompativeis.length === 0) {
    if (esfera === "estadual") {
      return {
        valido: false,
        erro: `não há fonte oficial cadastrada para esfera estadual com UF ${uf_norma_normalizado}`,
      }
    }
    if (esfera === "municipal") {
      return {
        valido: false,
        erro: `não há fonte oficial cadastrada para esfera municipal com UF ${uf_norma_normalizado} e município ${municipio_norma}`,
      }
    }
    return {
      valido: false,
      erro: "não há fonte oficial cadastrada para esfera federal",
    }
  }

  // Parse URL e compara origin exatamente para rejeitar domínios lookalike
  let urlOrigin: string
  try {
    const parsedUrl = new URL(url)
    urlOrigin = parsedUrl.origin
  } catch {
    return {
      valido: false,
      erro: "URL malformada: não foi possível parsear a URL",
    }
  }

  // Verifica se o origin da URL bate com ALGUMA das fontes compatíveis
  for (const fonte of fontesCompativeis) {
    const padraoOrigin = new URL(fonte.padrao_url).origin
    if (urlOrigin === padraoOrigin) {
      return { valido: true }
    }
  }

  // Se chegou aqui, nenhuma fonte compatível bateu com o origin
  const origensEsperadas = fontesCompativeis
    .map((f) => new URL(f.padrao_url).origin)
    .join(", ")
  const ufSuffix = esfera === "estadual"
    ? `/${uf_norma_normalizado}`
    : esfera === "municipal"
      ? `/${uf_norma_normalizado}/${municipio_norma}`
      : ""
  return {
    valido: false,
    erro: `URL não pertence a nenhuma fonte oficial cadastrada para esfera ${esfera}${ufSuffix} (esperados origins: ${origensEsperadas}, recebido: ${urlOrigin})`,
  }
}

/**
 * Lista todas as fontes oficiais cadastradas no registry.
 * Útil para debugging e documentação.
 */
export function listarFontesOficiais(): FonteOficial[] {
  return [...REGISTRY_FONTE_OFICIAL]
}
