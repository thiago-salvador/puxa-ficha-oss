# Fontes e dados

## Registro canônico

`src/data/methodology-sources.ts` é o catálogo público de fontes. Ele só deve
conter uma fonte quando o projeto já possui dado publicado e uma superfície que
o mostra. `docs/cobertura-de-dados.md` define a única régua de cobertura válida.

## Fontes em uso

| Grupo | Fontes | Uso principal | Cadência real em 06/08/2026 |
|---|---|---|---|
| Eleitoral | TSE e histórico eleitoral do TSE | Identidade, candidaturas, patrimônio, financiamento e trajetória | Sob demanda e por ciclo eleitoral |
| Legislativo | Câmara dos Deputados e Senado Federal | Votos, projetos, mandatos e gastos | Semanal |
| Transparência e controle | Portal da Transparência, Cadastros de Sanções da CGU, TCU e CEAPS | Gastos, sanções, processos de controle e cota parlamentar | Sob demanda |
| Filiação | TSE: Filiação Partidária | Filiação e desfiliação | Sob demanda |
| Enriquecimento | Wikipedia e Wikidata | Bio, foto, redes e complemento de trajetória | Sob demanda e com curadoria |
| Notícias | Google News | Notícias recentes cujo título cita o candidato | Diária |
| Indicadores estaduais | IBGE/SIDRA, Ipeadata, Atlas da Violência, IDEB, CAPAG e Siconfi | Contexto econômico, social, fiscal, educacional e de segurança por UF | Sob demanda |

Descrição, URL, tipos de dado, natureza, cadência e curadoria de cada uma das 17
fontes ficam no registro canônico. Não copie detalhes divergentes para outros
arquivos.

## Hierarquia e prova

- Prefira base oficial para fatos eleitorais, patrimoniais, legislativos,
  judiciais e administrativos.
- Fonte pública complementar pode enriquecer bio, foto, redes e contexto, mas
  não derruba um dado oficial mais forte.
- Cada afirmação editorial precisa de fonte que sustente a frase e identidade
  suficiente para excluir homônimos.
- Links quebrados, páginas genéricas ou resultados de busca não são prova final.
- O CPF é chave de cruzamento exclusivamente no servidor e nunca dado de saída.

## Identidade

`SQ_CANDIDATO` confirmado é a chave eleitoral de persistência. Um nome igual ou
parecido nunca autoriza merge. Quando a fonte não oferece `SQ_CANDIDATO`, o
pipeline deve usar um gate documentado de identidade e mandar a dúvida para
quarentena ou revisão.

Filiação contínua também não pode ser fabricada. Se várias candidaturas oficiais
mostram o mesmo partido e não existe evento de desfiliação no acervo consultado,
o site pode apresentar os fatos conhecidos e a ausência de ruptura registrada,
mas deve distinguir isso de uma certidão completa de filiação entre as datas.

## Estados da coleta

O vocabulário operacional inclui `encontrado`, `vazio_confirmado`,
`sem_achado_no_escopo`, `indeterminado`, `erro` e `nao_aplicavel`. O relatório
de cobertura traduz esses resultados para estados de célula sem apagar a
procedência.

Regras:

- `vazio_confirmado` exige consulta aplicável concluída em todas as fontes
  obrigatórias da frente.
- `sem_achado_no_escopo` descreve curadoria limitada, não ausência absoluta.
- `indeterminado` e `erro` não fecham cobertura.
- Fonte não consultada continua pendente.
- `nao_aplicavel` exige uma regra comprovável, não conveniência de UI.

## Cobertura versus completude

O índice atual mede 15 frentes visíveis e usa aplicabilidade. Campos de achado,
como processos ou sanções, ficam fora do índice porque ter um achado não torna a
ficha mais completa. O índice é diagnóstico, não permissão para abandonar
lacunas. Mesmo uma ficha com 100% pode exigir correção de procedência, qualidade
de foto, detalhes pessoais ou estado visual.

O comando canônico é:

```bash
npm run audit:cobertura
```

O snapshot lê produção em modo somente leitura. Relatórios avulsos, planilhas ou
contagens diretas da tabela `candidatos` não substituem essa régua.

## Regra de chegada ao frontend

Para cada frente, mantenha um mapa explícito:

```text
fonte -> coletor -> tabela/view -> DTO/API -> componente -> cache tag -> teste
```

Uma coluna criada sem DTO, um DTO sem componente ou uma persistência sem
revalidação são implementações incompletas. A tarefa continua aberta até o
readback da ficha pública.
