import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  ANOS_VARRIDOS,
  chaveNomeNascimento,
  converterDataBR,
  decidirCpfDoCandidato,
  montarMapaNomeNascimento,
  type AlvoBackfill,
  type HitCpf,
} from "../scripts/backfill-cpf-tse"

function hit(overrides: Partial<HitCpf>): HitCpf {
  return {
    cpf: "52998224725",
    metodo: "sq",
    ano: 2022,
    uf: "SP",
    cargo: "DEPUTADO FEDERAL",
    sq: "250001234567",
    nomeCsv: "FULANO DE TAL",
    ...overrides,
  }
}

describe("converterDataBR", () => {
  it("converte DD/MM/YYYY para ISO", () => {
    assert.equal(converterDataBR("07/09/1959"), "1959-09-07")
    assert.equal(converterDataBR("1/2/1980"), "1980-02-01")
  })

  it("rejeita formato inválido, vazio e valores fora de faixa", () => {
    assert.equal(converterDataBR(""), "")
    assert.equal(converterDataBR("#NULO#"), "")
    assert.equal(converterDataBR("1959-09-07"), "")
    assert.equal(converterDataBR("32/01/1980"), "")
    assert.equal(converterDataBR("01/13/1980"), "")
  })
})

describe("chaveNomeNascimento", () => {
  it("normaliza acento e caixa, e exige as duas partes", () => {
    assert.equal(chaveNomeNascimento("José da Silva", "1960-01-02"), "JOSE DA SILVA|1960-01-02")
    assert.equal(chaveNomeNascimento("", "1960-01-02"), "")
    assert.equal(chaveNomeNascimento("José", ""), "")
  })
})

describe("decidirCpfDoCandidato", () => {
  it("sem hits: nenhum", () => {
    assert.deepEqual(decidirCpfDoCandidato([]), { decisao: "nenhum" })
  })

  it("rota sq única persiste, mesmo com vários anos concordando", () => {
    const decisao = decidirCpfDoCandidato([
      hit({ ano: 2022 }),
      hit({ ano: 2018, sq: "250009999999" }),
    ])
    assert.equal(decisao.decisao, "persistir")
    if (decisao.decisao === "persistir") {
      assert.equal(decisao.cpf, "52998224725")
      assert.equal(decisao.metodo, "sq")
      assert.equal(decisao.evidencias.length, 2)
    }
  })

  it("rota sq com CPFs distintos entre anos é conflito", () => {
    const decisao = decidirCpfDoCandidato([
      hit({ ano: 2022, cpf: "52998224725" }),
      hit({ ano: 2018, cpf: "15350946056" }),
    ])
    assert.equal(decisao.decisao, "conflito")
  })

  it("sq e nome-nascimento divergindo é conflito, não escolha", () => {
    const decisao = decidirCpfDoCandidato([
      hit({ metodo: "sq", cpf: "52998224725" }),
      hit({ metodo: "nome-nascimento", cpf: "15350946056" }),
    ])
    assert.equal(decisao.decisao, "conflito")
  })

  it("sq com nome-nascimento concordando persiste via sq", () => {
    const decisao = decidirCpfDoCandidato([
      hit({ metodo: "sq", cpf: "52998224725" }),
      hit({ metodo: "nome-nascimento", cpf: "52998224725", ano: 2014 }),
    ])
    assert.equal(decisao.decisao, "persistir")
    if (decisao.decisao === "persistir") assert.equal(decisao.metodo, "sq")
  })

  it("só nome-nascimento NUNCA persiste: vira revisão humana (caso jarbas-soares)", () => {
    // Regressão do incidente de 2026-08-05: a data de nascimento do banco pode
    // ter vindo do mesmo casamento por nome que a rota estaria confirmando
    // (validação circular). Sem SQ, o CPF é sugestão para humano, não escrita.
    const decisao = decidirCpfDoCandidato([
      hit({ metodo: "nome-nascimento", cpf: "15350946056", ano: 2014 }),
      hit({ metodo: "nome-nascimento", cpf: "15350946056", ano: 2010 }),
    ])
    assert.equal(decisao.decisao, "revisao")
    if (decisao.decisao === "revisao") {
      assert.equal(decisao.evidencias.length, 2)
    }
  })

  it("homônimo com mesma data de nascimento (CPFs distintos) é conflito", () => {
    const decisao = decidirCpfDoCandidato([
      hit({ metodo: "nome-nascimento", cpf: "52998224725" }),
      hit({ metodo: "nome-nascimento", cpf: "15350946056" }),
    ])
    assert.equal(decisao.decisao, "conflito")
  })
})

describe("montarMapaNomeNascimento", () => {
  const alvo = (slug: string, nome: string, nasc: string | null): AlvoBackfill => ({
    slug,
    nome_completo: nome,
    data_nascimento: nasc,
    estado: null,
  })

  it("indexa quem tem nome e nascimento, ignora quem não tem", () => {
    const { mapa, colididos } = montarMapaNomeNascimento([
      alvo("a", "Ana Souza", "1980-01-01"),
      alvo("b", "Beto Lima", null),
    ])
    assert.equal(mapa.size, 1)
    assert.equal(mapa.get("ANA SOUZA|1980-01-01"), "a")
    assert.deepEqual(colididos, [])
  })

  it("colisão interna derruba os dois lados da chave", () => {
    const { mapa, colididos } = montarMapaNomeNascimento([
      alvo("a", "Ana Souza", "1980-01-01"),
      alvo("b", "ANA SOUZA", "1980-01-01"),
      alvo("c", "Caio Melo", "1990-05-05"),
    ])
    assert.equal(mapa.size, 1)
    assert.equal(mapa.get("CAIO MELO|1990-05-05"), "c")
    assert.deepEqual(colididos, ["a", "b"])
  })
})

describe("ANOS_VARRIDOS", () => {
  it("não desce de 2010: até 2008 o SQ é sequencial por UF e colide", () => {
    assert.ok(Math.min(...ANOS_VARRIDOS) >= 2010)
    assert.ok(ANOS_VARRIDOS.includes(2026))
  })
})
