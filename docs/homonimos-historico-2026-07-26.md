# Histórico político contaminado por homônimo

**Data:** 26 de julho de 2026
**Origem:** apuração da pendência 1 do fechamento da
[auditoria de integridade](auditoria-integridade-2026-07-24.md) ("CPF divergente
de `jeronimo`"), que o laudo registrou sem descrever o efeito.
**Acesso ao banco:** somente leitura. Nenhuma linha foi alterada.

## O que o laudo não dizia

O laudo apontou o CPF divergente e o caminho de correção (reancorar e
reprocessar), mas não registrou **o que o CPF errado produziu na ficha**. Produziu
isto: seis candidaturas a Vereador atribuídas a Jerônimo Rodrigues, cada uma por
um partido diferente.

| Ano | Cargo | Partido | Observação gravada |
|---|---|---|---|
| 2000 | Vereador | PHS | Candidatura: SUPLENTE (TSE 2000) |
| 2004 | Vereador | PSDB | Candidatura: SUPLENTE (TSE 2004) |
| 2008 | Vereador | DEM | Candidatura: SUPLENTE (TSE 2008) |
| 2012 | Vereador | PTN | Candidatura: SUPLENTE (TSE 2012) |
| 2012 | Vice-Prefeito | **PT** | Candidatura: NÃO ELEITO (TSE 2012) |
| 2016 | Vereador | PMN | Candidatura municipal de 2016 pelo PMN |
| 2020 | Vereador | MDB | Candidatura: NÃO ELEITO (TSE 2020) |

As linhas em PT (Vice-Prefeito 2012, Secretário de Desenvolvimento Rural
2015-2018, Secretário de Educação 2019-2022, Governador desde 2023) são
coerentes entre si e com a trajetória pública do candidato.

## Por que isto não é troca de partido

Troca de partido é comum e não seria achado. O que descarta essa leitura:

1. **Colisão lógica em 2012.** A mesma pessoa aparece como candidata a
   Vice-Prefeito pelo PT e a Vereador pelo PTN na mesma eleição. Não é possível.
2. **Seis siglas em vinte anos**, todas fora do campo do PT (PHS, PSDB, DEM,
   PTN, PMN, MDB), para um quadro que ocupou duas secretarias em governos do PT
   na Bahia e se elegeu governador pelo partido.
3. **O padrão do resolver.** `scripts/lib/tse-resolver.ts` casa linha do TSE por
   `SQ_CANDIDATO`, depois por CPF, e só então por nome. Com o CPF divergente, o
   segundo degrau falha e a linha cai no casamento por nome, que junta homônimos.

Ou seja: o CPF errado não é um campo cosmético errado. Ele desliga a âncora que
separa pessoas com o mesmo nome, e o resultado é candidatura de terceiro exibida
na ficha de quem está no ar.

## O achado é da classe, não de um candidato

A mesma consulta sobre os publicados devolve oito fichas com duas ou mais
candidaturas a Vereador em sigla diferente da atual:

| Slug | Partido hoje | Linhas | Siglas no histórico |
|---|---|---|---|
| `jeronimo` | PT | 6 | DEM, MDB, PHS, PMN, PSDB, PTN |
| `cleitinho` | REPUBLICANOS | 4 | AVANTE, PP, PT DO B |
| `marcos-rogerio` | PL | 3 | PDT, PPS, PTB |
| `maria-da-consolacao` | PSOL | 2 | PSB, PT DO B |
| `adailton-furia` | PSD | 2 | PRB, PSDB |
| `professora-dorinha` | UNIAO | 2 | PMDB, PPB |
| `clecio-luis` | UNIAO | 2 | PSOL, PT |
| `dr-daniel` | PODEMOS | 2 | PSDB |

**A lista é indício, não veredito.** Vários desses casos podem ser troca de
partido real, e a consulta não distingue. O que ela mostra é onde olhar. Só o
`jeronimo` tem, hoje, a colisão lógica que fecha o diagnóstico sem depender de
julgamento.

## Por que nada foi corrigido aqui

Apagar linha de histórico é afirmar que uma candidatura não é daquela pessoa.
Errar nessa direção também é errar sobre pessoa real, e no sentido oposto:
esconder mandato ou candidatura verdadeira. A correção exige, por candidato:

1. Obter o CPF oficial na fonte (TSE), confirmar a divergência e corrigir
   `candidatos.cpf`.
2. Reprocessar com o CPF certo, para o resolver reancorar por CPF em vez de por
   nome. O pipeline é idempotente; financiamento e patrimônio aceitam recorte
   por slug (`PF_TSE_FINANCIAMENTO_SLUGS`, `PF_TSE_PATRIMONIO_SLUGS`), histórico
   não tem esse recorte hoje.
3. Conferir linha a linha o que sai e o que fica, com a evidência registrada,
   como foi feito nas migrations de 25/07.

Enquanto isso não acontece, a ficha do `jeronimo` exibe candidaturas que quase
certamente são de outra pessoa.

## Sugestão de guard-rail

Existe `scripts/lib/historico-homonym-signals.ts`, que já emite
`cpf_obs_incompativel` quando um CPF citado em observação diverge do CPF do
candidato. O sinal que falta é o inverso: **linha de histórico cuja âncora foi
resolvida por nome, e não por SQ nem por CPF**, deveria nascer marcada e ficar
fora da superfície pública até revisão. Hoje o degrau de nome é silencioso, e é
justamente ele que produziu a tabela acima.
