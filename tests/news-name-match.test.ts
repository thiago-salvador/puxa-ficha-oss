/**
 * Guard de relevancia de noticia (auditoria de integridade 2026-07-24, etapa 1C).
 *
 * Todos os titulos usados aqui sao LINHAS REAIS de `noticias_candidato` no
 * Supabase wskpzsobvqwhnbsdsmok, extraidas por SELECT em 2026-07-25 junto com o
 * `nome_urna`/`nome_completo` do candidato a que estavam associadas. Nenhum
 * titulo foi inventado.
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  newsTitleMentionsCandidate,
  splitNewsByCandidateMention,
} from "@/lib/news/name-match"

const MARIA = { nome_urna: "Maria da Consolação", nome_completo: "Maria da Consolação Soares" }
const JHC = { nome_urna: "JHC", nome_completo: "João Henrique Caldas" }
const LULA = { nome_urna: "Lula", nome_completo: "Luiz Inácio Lula da Silva" }
const CINTIA = { nome_urna: "Cintia Dias", nome_completo: "Cintia Aparecida Dias" }
const CAIUBI = { nome_urna: "Caiubi Kuhn", nome_completo: "Caiubi Emanuel Souza Kuhn" }
const MAINHA = { nome_urna: "Mainha", nome_completo: "Jose de Andrade Maia Filho" }

describe("descarta cobertura do pleito que nao cita o candidato", () => {
  it("titulo generico de disputa estadual nao vale como noticia do candidato", () => {
    assert.equal(
      newsTitleMentionsCandidate(
        "Em meio à indecisão da esquerda, Psol lança pré-candidata ao governo de MG - Estado de Minas",
        MARIA,
      ),
      false,
    )
    assert.equal(
      newsTitleMentionsCandidate(
        "Quem são os possíveis candidatos a governador do Maranhão nas eleições 2026? - JOTA Info",
        { nome_urna: "Enilton Rodrigues", nome_completo: "Enilton Rodrigues" },
      ),
      false,
    )
    assert.equal(
      newsTitleMentionsCandidate(
        "Daniel Vilela lidera cenários de 1º e 2º turnos em Goiás, diz Genial/Quaest - SBT News",
        CINTIA,
      ),
      false,
    )
  })

  it("materia sobre outra pessoa da mesma disputa nao passa", () => {
    assert.equal(
      newsTitleMentionsCandidate(
        "Rafael Fonteles, do PT, tem ampla maioria para governador do Piauí, aponta pesquisa - Revista Fórum",
        MAINHA,
      ),
      false,
    )
    assert.equal(
      newsTitleMentionsCandidate(
        "Eleições 2026: O plano do PT para conter alta de Flávio Bolsonaro nas pesquisas - BBC",
        LULA,
      ),
      false,
    )
  })
})

describe("mantem cobertura que cita o candidato", () => {
  it("nome de urna completo no titulo", () => {
    assert.equal(
      newsTitleMentionsCandidate(
        "PSOL propõe unidade ao PT e a candidatura de Cintia Dias a governadora - O Popular",
        CINTIA,
      ),
      true,
    )
  })

  it("acento diferente entre banco e titulo nao quebra o match", () => {
    // Banco: "Cintia Dias". Titulo publicado: "Cíntia Dias".
    assert.equal(
      newsTitleMentionsCandidate(
        "Plano de governo: Cíntia Dias (Psol) - G1",
        CINTIA,
      ),
      true,
    )
  })

  it("primeiro nome distintivo sozinho conta", () => {
    assert.equal(
      newsTitleMentionsCandidate(
        "Caiubi mira eleitorado de centro-esquerda e vê espaço deixado por Natasha - HiperNotícias",
        CAIUBI,
      ),
      true,
    )
  })

  it("apelido curto de uma palavra conta", () => {
    assert.equal(
      newsTitleMentionsCandidate(
        "Mainha confirma pré-candidatura ao Governo do Piauí - gazeta hora1",
        MAINHA,
      ),
      true,
    )
  })

  it("nome completo casa quando o titulo nao usa o nome de urna", () => {
    assert.equal(
      newsTitleMentionsCandidate(
        "Acompanhe a trajetória de Maria da Consolação Rocha candidato(a) em 2026 - tmc.com.br",
        MARIA,
      ),
      true,
    )
  })
})

describe("sigla curta (caso JHC)", () => {
  it("casa a sigla como palavra inteira, sem o artefato do corte de 4 letras", () => {
    // A regra da auditoria (tokens com 4+ letras) marcava 117 de 117 noticias
    // do JHC como sem match, o que era artefato do corte e nao ruido real.
    assert.equal(
      newsTitleMentionsCandidate("JHC anuncia pré-candidatura ao governo de Alagoas", JHC),
      true,
    )
    assert.equal(
      newsTitleMentionsCandidate(
        "Nordeste: eleição para governador coloca em risco hegemonia petista - congressoemfoco.com.br",
        JHC,
      ),
      false,
    )
  })

  it("nao casa a sigla dentro de outra palavra", () => {
    assert.equal(newsTitleMentionsCandidate("Prefeitura de JHCidade abre concurso", JHC), false)
  })
})

describe("splitNewsByCandidateMention", () => {
  it("separa os dois grupos preservando a ordem", () => {
    const { mencionam, contextoDoPleito } = splitNewsByCandidateMention(
      [
        { titulo: "Mainha confirma pré-candidatura ao Governo do Piauí - gazeta hora1" },
        { titulo: "AtlasIntel: Fonteles vence todos os cenários de 2º turno no PI - CNN Brasil" },
        { titulo: "Mainha avalia desempenho na pesquisa do Instituto GP1" },
      ],
      MAINHA,
    )

    assert.equal(mencionam.length, 2)
    assert.equal(contextoDoPleito.length, 1)
    assert.match(contextoDoPleito[0].titulo, /AtlasIntel/)
  })

  it("titulo vazio nunca conta como mencao", () => {
    assert.equal(newsTitleMentionsCandidate("", LULA), false)
    assert.equal(newsTitleMentionsCandidate(null, LULA), false)
  })
})
