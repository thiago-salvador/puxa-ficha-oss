import Link from "next/link"
import type { FichaCandidato } from "@/lib/types"
import { formatDate } from "@/lib/utils"

export function ProfileSourceFooter({
  ficha,
}: {
  ficha: Pick<FichaCandidato, "fonte_dados" | "ultima_atualizacao">
}) {
  const profileSources = (ficha.fonte_dados ?? []).join(", ") || "TSE"

  return (
    <aside
      className="mx-auto max-w-7xl px-5 py-5 md:px-12"
      aria-label="Fontes e aviso legal da ficha"
      data-pf-profile-server-disclosure=""
    >
      <p
        className="break-words text-[length:var(--text-eyebrow)] font-semibold text-muted-foreground [overflow-wrap:anywhere]"
        data-pf-profile-source-footer=""
        data-pf-profile-sources={profileSources}
        data-pf-profile-updated-at={ficha.ultima_atualizacao}
      >
        Fontes: {profileSources}. Atualizado em {formatDate(ficha.ultima_atualizacao)}. Consulte a{" "}
        <Link className="underline" href="/metodologia">
          metodologia
        </Link>
        .
      </p>
      <p
        className="mt-2 max-w-3xl text-[length:var(--text-eyebrow)] leading-relaxed text-muted-foreground"
        data-pf-profile-legal-disclaimer=""
      >
        Dados públicos sobre pré-candidato mapeado para 2026. Não é recomendação de voto.
        Investigações sem condenação não implicam culpa. Para correção, escreva para{" "}
        <a
          className="underline"
          href="mailto:contato@puxaficha.com.br?subject=Retificação de ficha"
        >
          contato@puxaficha.com.br
        </a>{" "}
        com o assunto Retificação de ficha.
      </p>
    </aside>
  )
}
