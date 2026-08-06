import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"

import {
  renderHtml,
  type EvidenciaRelatorio
} from "../scripts/audit/coverage-report"
import type { CandidatoCoverage } from "../scripts/audit/lib/coverage-model"

function candidato(over: Partial<CandidatoCoverage> = {}): CandidatoCoverage {
  return {
    slug: "fulano",
    nome_urna: "Fulano",
    partido_sigla: "XPTO",
    cargo_disputado: "Governador",
    estado: "SP",
    foto: false,
    bio: false,
    redes: false,
    idade: null,
    naturalidade: null,
    formacao: null,
    profissao: null,
    historico: [],
    temSqNoSeed: false,
    temIdCamaraNoSeed: false,
    temIdSenadoNoSeed: false,
    mudancas: 0,
    patrimonioAnos: [],
    patrimonioAnosComBens: [],
    financiamentoAnos: [],
    financiamentoAnosComDoadores: [],
    votos: 0,
    contradicoes: 0,
    processos: 0,
    alertas: 0,
    projetos: 0,
    destaquesVisiveis: 0,
    destaquesTotais: 0,
    gastosAnos: [],
    legislacaoExecutivo: 0,
    noticias: 0,
    posicoesTemasVerificados: [],
    posicoesTemasPendentes: [],
    sancoes: 0,
    itensRevisar: [],
    coletas: {},
    ...over
  }
}

function evidenciaBase(): EvidenciaRelatorio {
  return {
    verificado_em: "05/08/2026 22:00:00 -03",
    regua: {
      candidatos_antes: 194,
      candidatos_depois: 194,
      total_celulas_alteradas: 12,
      por_coluna: { contradicoes: 12 },
      passou: true
    },
    dom: {
      total_legenda: 23,
      total_dom: 23,
      por_estado: { zero: { legenda: 9, dom: 9 } },
      passou: true
    },
    fontes: [
      {
        slug: "fulano",
        nome_urna: "Fulano",
        linhas_select: 2,
        linhas_relatorio: 2,
        divergencias: 0,
        passou: true
      }
    ],
    mobile: {
      viewport_largura: 375,
      document_scroll_width: 360,
      document_client_width: 360,
      tabelas_com_overflow: 2,
      passou: true
    }
  }
}

test("relatório antigo continua renderizando sem exigir reconciliação", () => {
  const html = renderHtml([candidato()], [], evidenciaBase())
  assert.match(html, /Evidências de verificação/)
  assert.doesNotMatch(html, /id="reconciliacao"/)
})

test("reconciliação mostra somente números fornecidos, sete resíduos e controles Aplicar", () => {
  const evidencia = evidenciaBase()
  evidencia.reconciliacao = {
    passou: false,
    totais: {
      antes: { nunca_verificados: 276, zeros_comprovados: 161 },
      depois: { nunca_verificados: 31, zeros_comprovados: 179 }
    },
    resumo: {
      zerou: ["Nenhuma métrica zerou."],
      mudou_categoria: ["Doze células mudaram apenas de categoria."],
      depende_aprovacao: ["Três itens aguardam decisão."],
      continua_impossivel: ["Uma identidade continua sem prova."]
    },
    por_coluna: [
      { chave: "contradicoes", antes: 194, depois: 12, categoria: "mudança de categoria" }
    ],
    por_celula: Array.from({ length: 55 }, (_, indice) => ({
      chave: `fulano::coluna-${indice}`,
      antes: "nunca verificado",
      depois: "busca esgotada no escopo",
      proxima_acao: "preservar o limite da busca"
    })),
    residuos: {
      "aguardando aprovação": {
        total: 3,
        proxima_acao: "Revisar a fila editorial.",
        itens: [{ chave: "fulano::item-1", detalhe: "Fato esperando decisão." }]
      },
      "identidade sem prova": {
        total: 1,
        motivo: "A fonte não liga o registro à pessoa certa.",
        proxima_acao: "Buscar identificador oficial."
      }
    },
    proximas_acoes: [
      { id: "aguardar", rotulo: "Aguardar nova fonte" },
      { id: "revisar", rotulo: "Revisar aprovações", recomendada: true }
    ]
  }

  const html = renderHtml([candidato()], [], evidencia)
  assert.match(html, /id="reconciliacao"/)
  assert.match(html, /276/)
  assert.match(html, /179/)
  assert.match(html, /O que apenas mudou de categoria/)
  assert.match(html, /data-categoria="N\/A"/)
  assert.match(html, /erro de código ainda aberto/)
  assert.match(html, /Sem registro nesta categoria na evidência/)
  assert.match(html, /id="aguardando-aprovacao-c7"/)
  assert.match(html, /value="revisar" checked/)
  assert.match(html, /fetch\('\/aplicar'/)
  assert.match(html, /data-page-size="50"/)
  assert.match(html, /\.recon-table-wrap \{[\s\S]*?overflow:auto/)
  assert.match(html, /html, body \{[\s\S]*?overflow-x:hidden/)
})

async function portaLivre(): Promise<number> {
  const servidor = createServer()
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve))
  const endereco = servidor.address()
  assert.ok(endereco && typeof endereco === "object")
  const porta = endereco.port
  await new Promise<void>((resolve, reject) => servidor.close((erro) => (erro ? reject(erro) : resolve())))
  return porta
}

test("review-server grava /aplicar no JSONL e permanece ativo", { timeout: 10_000 }, async () => {
  const temporario = await mkdtemp(join(tmpdir(), "puxa-ficha-c7-server-"))
  const saida = join(temporario, "decisoes.jsonl")
  const porta = await portaLivre()
  await writeFile(join(temporario, "index.html"), "<!doctype html><title>teste</title>")
  const processo = spawn(
    "python3",
    ["scripts/audit/review-server.py", String(porta), temporario, saida],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
  )

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("servidor não iniciou")), 4_000)
      processo.once("exit", (codigo) => reject(new Error(`servidor encerrou com ${codigo}`)))
      processo.stdout.on("data", (parte) => {
        if (String(parte).includes("servindo")) {
          clearTimeout(timer)
          resolve()
        }
      })
    })

    for (const id of ["primeira", "segunda"]) {
      const resposta = await fetch(`http://127.0.0.1:${porta}/aplicar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "c7_proxima_acao",
          opcoes: [{ id }],
          instrucoes: "Manter bloqueios explícitos.",
          contexto: { relatorio: "/index.html" }
        })
      })
      assert.equal(resposta.status, 200)
      assert.equal((await resposta.json()).gravados, 1)
      assert.equal(processo.exitCode, null, "o servidor não pode encerrar após /aplicar")
    }

    const linhas = (await readFile(saida, "utf8")).trim().split("\n").map((linha) => JSON.parse(linha))
    assert.equal(linhas.length, 2)
    assert.deepEqual(
      linhas.map((linha) => linha.tipo),
      ["aplicar", "aplicar"]
    )
    assert.equal(linhas[1].opcoes[0].id, "segunda")
  } finally {
    processo.kill("SIGTERM")
    await new Promise<void>((resolve) => processo.once("exit", () => resolve()))
    await rm(temporario, { recursive: true, force: true })
  }
})
