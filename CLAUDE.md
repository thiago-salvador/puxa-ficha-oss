# Puxa Ficha

Leia [Settings/README.md](Settings/README.md) antes de trabalhar neste projeto.
Esse diretório contém objetivo, arquitetura, dados, fontes, workflows,
automações, ambientes, versões, comportamento esperado e status atual.

Não crie uma segunda camada de regras. Atualize `Settings/` quando o contrato do
projeto mudar.

## Claude Code

O que segue não duplica `Settings/`: são as quatro coisas que os gates cobram e
que aquele diretório não documenta.

**Rodar um teste só.** A suíte usa o runner nativo do Node com `tsx`, não jest
nem vitest:

```bash
node --import tsx --test tests/party-switches.test.ts
```

Filtrar dentro do arquivo: acrescente `--test-name-pattern="<regex>"`.

**`npm run check:dead-code` é gate de CI e reprova com uma issue só.** É `knip`
com `--max-issues 0`. Export que ficou sem consumidor derruba o PR, então
remover código morto faz parte da mudança, não de uma limpeza futura.

**Migration de dados exige a anotação `-- @write`.** Todo `INSERT`, `UPDATE` ou
`DELETE` leva `-- @write` na linha acima, conferida por
`npm run audit:cobertura:allowlist` contra a allowlist do recorte. Statement sem
anotação é escrita invisível para o gate e reprova. A janela `--desde`/`--ate` é
comparação de prefixo do nome do arquivo, e `--ate` é obrigatório: sem teto, uma
janela correta hoje quebra quando alguém criar a próxima migration.

**Armadilha do `unstable_cache` em `src/lib/api.ts`.** O TTL é de 3600s. Nunca
retorne `degradedResource` nem lista vazia de dentro do cache numa falha: o valor
errado congela por uma hora. Lance, porque rejeição não entra no cache.
