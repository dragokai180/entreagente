# EntreAgente

Aplicativo de indicações de serviços para condomínios. No cadastro, a pessoa recebe um ID de acesso e escolhe **Morador** ou **Prestador de serviços**. Moradores encontram e indicam profissionais. Prestadores editam o perfil, publicam trabalhos e aceitam convites para vincular seu perfil às fichas dos condomínios.

## Executar

Com o Node.js instalado, abra o terminal na raiz do repositório. O projeto e os testes usam os módulos que acompanham o Node. A versão usada para validação foi o Node.js 24.

```sh
npm test
npm start
```

Abra [o EntreAgente local](http://localhost:3000). O comando `npm start` também funciona na pasta `aplicativo/`. No PowerShell do Windows, você pode usar `npm.cmd test` e `npm.cmd start`.

## Onde trabalhar

| Local | Conteúdo |
| --- | --- |
| [aplicativo/public](aplicativo/public/) | Telas, estilos e eventos do navegador. |
| [aplicativo/lib](aplicativo/lib/) | Regras de contas, condomínios, prestadores, mídia e persistência. |
| [aplicativo/tests](aplicativo/tests/) | Testes de conta, perfil, indicações, dados e inicialização. |
| [versao-email](versao-email/) | Versão anterior com login por e-mail, seu código e seus testes. |

Para desenvolver no Visual Studio ou no VS Code, abra a pasta `aplicativo/`. O [guia da estrutura](aplicativo/docs/estrutura.md) acompanha o cadastro desde o formulário até a gravação do perfil. O [README do aplicativo](aplicativo/README.md) explica como testar o feed, o portfólio e os convites.

## Usar os cadastros existentes

| Versão | Comando na raiz | Dados na configuração padrão |
| --- | --- | --- |
| Login por ID | `npm start` | `aplicativo/entreagente-data.json` e `aplicativo/entreagente-data.json.media/`. |
| Login por e-mail | `npm run start:email` | `entreagente-data.json`, `entreagente-auth.json` e `entreagente-images/` na raiz histórica do repositório. |

Quem já usava o pacote com login por ID pode trazer as contas e mídias para a nova instalação. Com o servidor parado, copie o arquivo de dados e a pasta de mídias da instalação por ID para `aplicativo/`. Quem usava o login por e-mail continua acessando essas contas com `npm run start:email`. Cada versão usa sua própria base.

Se a instalação usa `DATA_FILE`, a variável define o caminho do arquivo de dados. Confira o caminho ao alternar de versão. Os dois comandos usam a porta 3000 por padrão. Encerre o processo com **Ctrl+C** antes de iniciar o outro na mesma porta.
