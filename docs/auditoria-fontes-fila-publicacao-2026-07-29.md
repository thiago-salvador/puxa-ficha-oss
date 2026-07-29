# Auditoria das fontes da fila de publicacao (2026-07-29)

## Por que este documento existe

Em 29/07/2026 o workflow `link-check-fontes.yml` rodou pela primeira vez com
credencial de verdade (ate entao os secrets do Supabase nunca tinham sido
configurados nos GitHub Actions, e o job agendado de 27/07 falhou com
`Missing SUPABASE_URL`).

O resultado separou dois mundos:

- **Ficha publica**: nenhuma claim com fonte morta ou sem fonte utilizavel. As
  7 claims publicas reprovadas tinham todas as fontes `indisponivel`, veredito
  temporario (bloqueio de robo, 5xx, vedacao eleitoral).
- **Fila de publicacao** (candidato fora de `candidatos_publico`): 25 claims
  com fonte morta e 63 sem fonte utilizavel.

Dentro da fila, 18 claims sao de gravidade `alta` ou `critica`, todas com
`verificado = true` no banco. Este documento e a triagem dessas 18. Elas nao
estao visiveis hoje, mas estao a um flag de publicacao de virar publicas.

## Metodo

1. Cada afirmacao foi verificada por um agente independente, com instrucao
   explicita de nunca devolver URL nao aberta. Meta declarada: fonte primaria
   oficial (STF, TSE, TRE, Senado, PF) antes de veiculo jornalistico.
2. **Toda URL recomendada foi reverificada por mim** com `probeUrlReal`, o
   mesmo probe que o `link-check` usa em producao. Resultado: **16/16 vivas**,
   todas HTTP 200 com corpo substantivo. Nenhuma URL entrou aqui sem passar
   nesse teste.
3. As tres afirmacoes cujo sentido se INVERTE tiveram o conteudo da pagina
   conferido termo a termo (STF, Poder360, Brasil de Fato).

Limitacao registrada: a skill `firecrawl` estava sem creditos durante a
execucao (`Insufficient credits`), e os agentes usaram WebSearch mais leitura
direta. Alem disso, por vedacao eleitoral, `gov.br`, `agenciabrasil.ebc.com.br`
e portais estaduais estao fora do ar, o que impediu citar fonte primaria
oficial em varios itens de numero (mortes no RS, valores federais). Esses itens
merecem reprocessamento depois de outubro.

## Veredito

**Nenhuma das 18 afirmacoes sobreviveu intacta.** Duas sao factualmente falsas,
uma inverte o sentido do fato, e as demais precisam de correcao material de
numero, data, status processual ou enquadramento.

O padrao de origem e visivel: URLs de `g1.globo.com` e `folha.uol.com.br` com
formato que os proprios veiculos nao usam (ano sem mes e dia), home nua de
portal como "fonte", e ate um `consulta_cand_{ano}.zip` com o placeholder nao
substituido. Descricao e URL parecem ter sido geradas juntas.

---

## 1. Remover ou reescrever antes de qualquer publicacao

### 1.1 `e572f945` pablo-marcal, alta: "Envolvimento com piramide financeira (ABJ Marketing)"

**A empresa "ABJ Marketing" nao existe em fonte alguma.** Busca pelo termo
entre aspas, combinado com o nome dele, com "piramide", com Goias e com
Ministerio Publico, retorna zero ocorrencias.

Nomear uma empresa inexistente e atribuir a ela acusacao de piramide, ligando a
pessoa nomeada, e o pior caso deste documento. **Acao: remover.**

Se a intencao era registrar apuracao financeira real, existem fatos
verificaveis e completamente distintos (relatorio do Coaf, apuracao da PF sobre
caixa 2 e lavagem na campanha de 2022). Nenhum deles e piramide, e nenhum
resultou em condenacao: teria que dizer "investigado", nunca "condenado".

### 1.2 `c52ef3ae` fernando-haddad, alta: "Condenado em 2a instancia por caixa 2"

**O titulo afirma o oposto do que aconteceu.** A segunda instancia nao
condenou: foi ela que absolveu. O TRE-SP absolveu Haddad por unanimidade em
27/07/2021, por inexistencia de provas. A unica condenacao foi de primeira
instancia, em agosto de 2019.

A descricao tambem erra duas vezes: atribui ao TRE-SP a condenacao (o TRE-SP
absolveu) e afirma anulacao "pelo TSE em 2022", que nao se sustentou em
nenhuma fonte. Alem disso absolvicao por falta de provas nao e sinonimo de
anulacao: anulacao sugere vicio processual, absolvicao afirma que nao ha prova.

**Acao: avaliar se o item deve existir.** Se ficar, o titulo tem que declarar o
desfecho. Manter o atual publica uma condenacao que nao existe.

Fonte verificada: https://www.poder360.com.br/justica/tre-de-sao-paulo-absolve-fernando-haddad-de-acusacao-de-caixa-2-eleitoral/

### 1.3 `0be9f284` eduardo-leite, alta: "Gestao da reconstrucao pos-enchentes com reconhecimento federal"

Dois defeitos. **O numero de R$ 85 bilhoes nao existe em fonte publica
nenhuma** (os valores federais reais sao R$ 98,7 bi, R$ 111,6 bi ou R$ 141 bi,
conforme data e criterio). E a atribuicao esta invertida: os recursos foram
destinados pela Uniao, nao articulados por ele, que cobrava publicamente o
governo federal.

Ha um terceiro problema, de criterio: **o item e elogioso e esta classificado
como gravidade alta.** Elogio com gravidade alta corroi o significado da
propria escala de gravidade da plataforma. **Acao: remover.**

### 1.4 `67f26e0e` pablo-marcal, critica: "Patrimonio declarado de R$ 282 milhoes incompativel com historico"

**O valor nao existe.** Conferi a pagina do Brasil de Fato termo a termo: zero
ocorrencias de "282". Os valores declarados sao R$ 96,5 milhoes (2022) e
R$ 193,5 milhoes (2024, o maior ja declarado). Nem somando se chega a 282.

A segunda metade do titulo, "incompativel com historico", e juizo e nao fato, e
a ficha nao diz quem faz esse juizo. **Acao: reescrever com o valor e o ano
corretos**, e trocar a conclusao por fato rastreavel (omissao e divergencia na
declaracao ao TSE, sob apuracao).

Fonte verificada: https://www.brasildefato.com.br/2024/08/08/pablo-marcal-declara-r-193-5-milhoes-em-bens-e-e-o-mais-rico-entre-candidatos-registrados-no-tse/

### 1.5 `291cf694` ciro-gomes, alta: "Nao apoiou Lula no 2o turno de 2018 e 2022"

Falsa nos dois ciclos. Em 2018 o adversario de Bolsonaro no 2o turno era
Haddad, nao Lula, e houve apoio formal do PDT. Em 2022 Ciro declarou apoio a
Lula em video, em 04/10/2022. O que ele recusou em 2018 foi fazer campanha,
viajando a Europa no dia seguinte ao anuncio de apoio.

**Acao: reescrever** para o fato verificavel (nao fez campanha em 2018) ou
remover.

Fonte verificada: https://www.poder360.com.br/eleicoes/ciro-viaja-a-europa-1-dia-apos-anunciar-apoio-a-haddad/

---

## 2. Corrigir numero, data ou status processual

| id | candidato | gravidade | o que corrigir | fonte verificada (HTTP 200) |
|---|---|---|---|---|
| `a1b3850e` | jair-bolsonaro | critica | "Indiciado por tentativa de golpe" ficou **desatualizado para menos**: o STF condenou na AP 2668 (acordao publicado 22/10/2025). Confirmei no texto da pagina do STF. | https://noticias.stf.jus.br/postsnoticias/ap-2668-publicado-acordao-que-condenou-o-ex-presidente-bolsonaro-e-outros-sete-reus-por-tentativa-de-golpe/ |
| `8fb90ea8` | jair-bolsonaro | critica | Indiciamento de jul/2024 confere, mas a PGR pediu arquivamento em mar/2026 e o caso nunca virou denuncia. Publicar como `critica` sem esse contexto e exposicao desnecessaria. | https://agenciabrasil.ebc.com.br/justica/noticia/2026-03/pgr-pede-arquivamento-de-inquerito-sobre-desvio-de-joias-por-bolsonaro |
| `58814104` | jair-bolsonaro | critica | "700 mil mortes" e anacronico: na data do relatorio da CPI (26/10/2021) o Brasil tinha pouco mais de 600 mil. E falta o desfecho, a PGR pediu arquivamento das apuracoes. | https://www12.senado.leg.br/noticias/materias/2021/10/26/apos-seis-meses-cpi-da-pandemia-e-encerrada-com-80-pedidos-de-indiciamento |
| `f2fa7b99` | tarcisio | critica | A ficha **funde duas operacoes**. A Escudo (2023) teve 28 mortes em cerca de 40 dias; as 56 mortes sao da Operacao Verao (dez/2023 a abr/2024). "56 em 5 dias" nao descreve nenhuma. A frase sobre a ONU inverte quem acionou quem. | https://www.hrw.org/pt/report/2023/11/07/386399 |
| `72d7742f` | michelle-bolsonaro | critica | "Pix" e anacronico (Pix so existe desde nov/2020; eram cheques), o periodo e 2011-2016 e nao 2011-2018, o STF arquivou em 2021 por falta de lastro, e ela nao foi indiciada no caso das joias. | https://www.gazetadopovo.com.br/republica/cheques-de-michelle-bolsonaro-stf-forma-maioria-para-arquivar-pedido-de-investigacao/ |
| `6452c61b` | pablo-marcal | critica | A remocao dos videos confere; a **multa nao foi concedida** nessa decisao (o TRE-SP registra deferimento parcial). Nao confundir com a multa de outro processo. | https://www.tre-sp.jus.br/comunicacao/noticias/2024/Outubro/juiz-da-2a-zona-eleitoral-determina-exclusao-de-videos-de-marcal-contra-boulos |
| `f0922bdd` | pablo-marcal | alta | Condenacao de 2010 confere, mas **"pena cumprida" e falso e inverte o fato**: a punicao foi extinta por prescricao em 2018 e ele nunca foi preso. A condenacao tambem nao foi por formacao de quadrilha. | https://www.infomoney.com.br/politica/afinal-pablo-marcal-foi-condenado-por-esquema-de-fraudes-bancarias-entenda-o-caso/ |
| `d470ed69` | tarcisio | alta | Nao foi comicio (era inauguracao de polo universitario) e a ficha omite que o inquerito foi arquivado pela Justica, sem denuncia. | https://www.poder360.com.br/justica/investigacao-em-paraisopolis-nao-identifica-segurancas-de-tarcisio/ |
| `0b67b436` | eduardo-leite | alta | 183 mortes esta desatualizado: o consolidado e 185 obitos e 23 desaparecidos (19/08/2025). "Cortes em investimentos" e impreciso; o documentado e subalocacao e execucao baixa. | https://reporterbrasil.org.br/2024/05/orcamento-contra-desastres-naturais-no-rs-e-so-9-do-anunciado-por-governo-diz-oposicao/ |
| `9faa0f83` | jair-bolsonaro | alta | O cartao corporativo estava classificado como "reservada" (5 anos), nao sob sigilo de 100 anos; o prazo de 100 anos valeu para outros itens (cartao de vacina, visitas ao Planalto). A liberacao cumpriu acordao do TCU. O ponto se sustenta, a redacao nao. | https://apublica.org/2023/01/de-saida-bolsonaro-ocultou-dados-de-cartao-corporativo-e-entradas-no-planalto/ |
| `4ea818c4` | jair-bolsonaro | critica | **Unico item que confere integralmente.** So trocar a home nua do TSE pela noticia especifica. | https://www.tse.jus.br/comunicacao/noticias/2023/Junho/por-maioria-de-votos-tse-declara-bolsonaro-inelegivel-por-8-anos |

---

## 3. Itens de natureza interpretativa

Estes nao sao erro factual, sao enquadramento editorial publicado como "ponto
de atencao" com gravidade alta. Merecem decisao de criterio, nao so de fonte.

| id | candidato | questao |
|---|---|---|
| `647c916d` | ciro-gomes | Ataque verbal a jornalistas esta documentado pela Abraji; **"intimidou fisicamente" nao tem nenhuma fonte**. E o processo judicial citado e de outro episodio, de 2021, nao de evento de campanha. |
| `4ccf2e70` | aldo-rebelo | A trajetoria partidaria e verificavel, mas "aliado de Bolsonaro" nao tem ato concreto (sem apoio declarado a candidatura, sem cargo, sem campanha), e a janela 2018-2022 esta errada: em 2022 ele era candidato pelo PDT. Os atos de aproximacao sao de 2024-2025. |

---

## O que NAO foi feito

Nenhuma escrita no banco. Nenhuma claim despublicada, reescrita ou removida.
Este documento e insumo de decisao editorial, que e humana por desenho, do
mesmo jeito que a despublicacao no `link-check` exige `--apply` rodado a mao.

## Recomendacao de sequencia

1. Resolver a secao 1 (5 itens) antes de publicar qualquer um desses
   candidatos. Dois deles afirmam hoje coisa factualmente falsa sobre pessoa
   nomeada.
2. Rodar a secao 2 como lote de correcao de texto e fonte.
3. Decidir o criterio da secao 3: se "ponto de atencao" admite enquadramento
   politico ou so fato com ato concreto. A resposta muda o produto, nao so
   estas duas fichas.
4. Varrer o resto da fila com o mesmo metodo. As 18 aqui sao so as de gravidade
   alta e critica; sobram 45 claims de gravidade media e baixa sem fonte
   utilizavel.
