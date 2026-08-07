# Workflows

## Mudança de código

1. Comece do `main` atual e limpo na pasta canônica.
2. Crie uma branch `codex/<objetivo>` quando a mudança precisar de isolamento.
3. Inspecione chamadores, schema, contrato público e testes antes de editar.
4. Faça a menor mudança que corrija a causa compartilhada.
5. Rode os gates proporcionais e um teste que falharia sem a correção.
6. Faça commit com Thiago Salvador como autor principal. Quando um agente
   produzir a mudança, registre-o em um trailer `Co-Authored-By` válido.
7. Abra PR sem fazer merge, salvo autorização explícita.
8. Depois do merge/deploy, confirme commit, deployment e comportamento público.

## Atualização de dados

1. Defina o universo por `SQ_CANDIDATO` ou outro identificador oficial aceito.
2. Declare fonte, escopo, resultado possível e política de erro.
3. Execute dry-run e confira cardinalidade, duplicatas e identidade.
4. Persista em lote fechado. Casos ambíguos vão para quarentena.
5. Registre a tentativa em `coleta_log`, inclusive falha ou ausência confirmada.
6. Leia o banco diretamente e compare totais, somas e amostras.
7. Revalide apenas as tags públicas afetadas.
8. Leia a API e a ficha pública.
9. Rode `npm run audit:cobertura` e registre a nova lacuna ou ganho.

Esse fluxo é indivisível para a definição de concluído. Um pipeline funcional
que não altera a ficha é um pipeline ainda não integrado.

## Migrations

- Migrations são sequenciais e nunca devem reescrever o histórico já aplicado.
- Antes de `db push`, compare os ledgers local e remoto.
- Use allowlist fechada das migrations esperadas.
- Dados e schema devem ter dry-run ou consulta equivalente antes da escrita.
- Pare diante de migration inesperada, identidade ambígua ou mudança de
  cardinalidade fora do planejado.
- Depois da aplicação, confira ledger, tabelas/views e superfície pública.

## Curadoria editorial

Pesquisa, classificação, aprovação, aplicação e publicação são etapas distintas.
Nenhum item vai ao ar sem um `sim` explícito e individual quando a frente exigir
curadoria. A decisão deve preservar fontes por afirmação e o escopo pesquisado.

Use os comandos versionados de curadoria. Eles são dry-run por padrão e só
escrevem com `--apply`.

## Cobertura total do universo

Toda correção descoberta por amostragem deve virar uma consulta sobre as 194
fichas atuais, ou sobre o universo vigente quando ele mudar. O objetivo não é
corrigir o candidato que revelou o bug, mas a regra compartilhada e todos os
registros afetados.

Divida a execução por frentes independentes, como identidade, patrimônio,
histórico, justiça e renderização, quando elas não disputarem os mesmos arquivos
ou migrations. Integre e valide o conjunto no final.

## PR, Vercel e lançamento

- Repositório: `thiago-salvador/puxa-ficha-oss`.
- Branch protegida de integração: `main`.
- Projeto Vercel: `puxa-ficha`, região `gru1`, Node 24.x.
- Domínio canônico: `https://puxaficha.com.br`.

Antes de lançar:

```text
CI verde -> PR revisada -> merge conhecido -> deployment Ready
-> /api/deployment-info no commit esperado
-> APIs públicas -> páginas reais -> cobertura e smoke
```

Um status Ready sem readback é apenas prova de infraestrutura.

## Fechamento

Atualize `Settings/STATUS.md` quando houver mudança relevante de produção,
cobertura, automação, fonte ou risco. Registre trabalho significativo no log
canônico do projeto, quando existir, e na Daily Note operacional.
