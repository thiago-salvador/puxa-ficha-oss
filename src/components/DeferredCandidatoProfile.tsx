import type { FichaCandidato } from "@/lib/types"
import type { CandidatoProfileTabId } from "@/lib/candidato-profile-tabs"
import { hasWideManualOverlappingSegmentedMandates } from "@/lib/historico-dedupe"
import { hasSameYearPartyReversal } from "@/lib/party-switches"
import {
  mudancasPartidoLinhasPublicas,
  prepareHistoricoPoliticoPublicDisplayList,
} from "@/lib/trajetoria-public-display"
import { DeferredCandidatoProfileClient } from "@/components/DeferredCandidatoProfileClient"

export function DeferredCandidatoProfile({
  ficha,
  initialTab,
}: {
  ficha: FichaCandidato
  initialTab?: CandidatoProfileTabId
}) {
  const historico = ficha.historico ?? []
  const mudancas = ficha.mudancas_partido ?? []
  const trajectoryCountValue = !hasWideManualOverlappingSegmentedMandates(historico)
    ? prepareHistoricoPoliticoPublicDisplayList(historico).length
    : null
  const partySwitchCountValue =
    (mudancas.length > 0 || Boolean(ficha.partido_sigla) || Boolean(ficha.partido_atual)) &&
    !hasSameYearPartyReversal(mudancas)
      ? mudancasPartidoLinhasPublicas(mudancas)
      : null
  const patrimonioMaisRecente = [...(ficha.patrimonio ?? [])]
    .sort((a, b) => Number(b.ano_eleicao) - Number(a.ano_eleicao))[0]

  return (
    <>
      {historico.length > 0 && trajectoryCountValue !== null && (
        <span hidden aria-hidden="true" data-pf-trajetoria-count={trajectoryCountValue} />
      )}
      {partySwitchCountValue !== null && (
        <span hidden aria-hidden="true" data-pf-partidos-count={partySwitchCountValue} />
      )}
      <DeferredCandidatoProfileClient
        slug={ficha.slug}
        initialTab={initialTab}
        overview={{
          processos: ficha.total_processos ?? 0,
          patrimonio: patrimonioMaisRecente?.valor_total ?? null,
          mudancas: ficha.total_mudancas_partido ?? 0,
        }}
      />
    </>
  )
}
