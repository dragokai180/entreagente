# Entendendo o EntreAgente pelo cadastro de um profissional

Abra a pasta que contém `package.json` e `server.js`. No ZIP, ela se chama **aplicativo**. Essa é a raiz do projeto. O EntreAgente tem uma interface em HTML, CSS e JavaScript, um servidor Node.js e um arquivo JSON para persistir os dados.

## Abrir no editor

| Editor no Windows | Como começar |
| --- | --- |
| Visual Studio | Use **Arquivo → Abrir → Pasta** e selecione **aplicativo**. Os arquivos aparecem no Gerenciador de Soluções. Com a carga de trabalho **Desenvolvimento para Node.js**, o menu de contexto de `package.json` também permite executar scripts npm. |
| Visual Studio Code | Use **Arquivo → Abrir Pasta** e selecione **aplicativo**. Na área **Executar e Depurar**, a configuração **EntreAgente - servidor** inicia `server.js` com **F5**. |

Para iniciar pelo terminal de qualquer um dos editores, abra o PowerShell na raiz e rode os comandos abaixo. Os testes usam dados temporários. O comando `start` inicia o servidor com os cadastros dessa instalação.

```powershell
npm.cmd test
npm.cmd start
```

Com o servidor em execução, abra [o aplicativo local](http://localhost:3000). Para interromper pelo terminal, use **Ctrl+C**. No depurador do VS Code, use **Shift+F5**.

## O que cada parte faz

| Local | Quando abrir |
| --- | --- |
| [package.json](../package.json) | Para descobrir qual comando roda o projeto. O script `start` chama `node server.js`. |
| [server.js](../server.js) | Para ver onde o programa começa. Ele define o endereço, a porta e o caminho dos dados e inicia a aplicação. |
| [public/](../public/) | Para mudar o que a pessoa vê no navegador. `index.html` contém formulários e telas, `app.css` define a aparência e `app.js` trata os cliques, a navegação e as chamadas à API. |
| [public/provider-ui.js](../public/provider-ui.js) | Para alterar o formulário **Editar perfil**, o portfólio ou a apresentação do prestador. |
| [lib/app.js](../lib/app.js) | Para descobrir qual módulo recebe uma requisição HTTP. É aqui que o servidor encaminha as chamadas da interface. |
| [lib/auth.js](../lib/auth.js) e [lib/community.js](../lib/community.js) | O primeiro cuida da conta, sessão e escolha do tipo de perfil. O segundo cuida das rotas da conta e das comunidades, fichas e indicações. |
| [lib/providers.js](../lib/providers.js) | Para mudar as regras de edição de um perfil profissional, de publicação de trabalhos ou de vínculo com um condomínio. |
| [lib/model.js](../lib/model.js) e [lib/store.js](../lib/store.js) | O primeiro define como gerar IDs e montar as informações exibidas nas consultas. O segundo lê e grava o arquivo de dados. |
| [public/uploads.js](../public/uploads.js) e [lib/media.js](../lib/media.js) | O primeiro mostra a prévia de fotos e vídeos no navegador. O segundo valida, grava e entrega os arquivos pelo servidor. |
| [tests/](../tests/) | Para verificar uma mudança. `api.test.js` testa os fluxos, `model.test.js` cobre a migração de dados, `server.test.js` inicia o servidor e `client.test.js` cobre a demonstração antiga. |
| [.vscode/launch.json](../.vscode/launch.json) e [.editorconfig](../.editorconfig) | O primeiro configura a execução do servidor pelo VS Code. O segundo registra as convenções de formatação do projeto, como UTF-8 e recuo de dois espaços. |

**Os dados ficam fora do código.** Na configuração padrão, o servidor grava as contas em `entreagente-data.json` e os arquivos enviados em `entreagente-data.json.media/`, ao lado de `server.js`. Esses itens surgem com o uso e ficam fora do Git. O arquivo `entreagente_mockup.html` na raiz conserva a demonstração antiga para quem precisa exportar dados locais.

## Acompanhar o cadastro do José no código

| O que José faz | O que acontece no projeto |
| --- | --- |
| **1. Cria a conta** com nome e senha. | O formulário de `public/index.html` dispara o envio em `public/app.js`. A chamada `POST /api/auth/register` chega a `lib/auth.js`, que usa `newUser` de `lib/model.js` para gerar o ID. `lib/store.js` grava a conta com a escolha de perfil pendente. |
| **2. Escolhe Prestador de serviços** e clica em **Continuar**. | `public/app.js` envia `PUT /api/me/account-type`. A rota em `lib/community.js` chama `chooseAccountType` em `lib/auth.js`. O servidor registra a escolha na mesma conta. |
| **3. Abre o painel.** | A interface consulta `GET /api/me`. Para o prestador, carrega os dados de `GET /api/provider` e monta **Meu perfil profissional**. A opção **Morador** leva à área de comunidades. |
| **4. Altera o título profissional** e salva. | O formulário de `public/provider-ui.js` envia `PATCH /api/provider/profile`. A função `updateProfile` em `lib/providers.js` valida os campos. A gravação passa por `lib/store.js`. |

**Primeiro exercício no editor.** Procure por `function chooseAccountType` em `lib/auth.js`. No VS Code, clique na margem ao lado da primeira instrução dentro da função e inicie o servidor com **F5**. No navegador, crie uma conta de teste, marque **Prestador de serviços** e clique em **Continuar**. Quando a execução pausar, veja a variável `type`, que contém `provider`. Pressione **F5** para continuar e abrir o painel.

Para rodar apenas o teste que acompanha esse fluxo, use o comando abaixo na raiz.

```powershell
node --test --test-name-pattern="escolha após o cadastro" tests/api.test.js
```

## Onde fazer a próxima alteração

Para mudar o texto da opção **Morador**, edite `public/index.html`. Para acrescentar um campo ao perfil profissional, trabalhe nas duas pontas. O formulário em `public/provider-ui.js` coleta o valor, e `lib/providers.js` o valida e o devolve quando o perfil é consultado. Em `tests/api.test.js`, verifique que o valor salvo reaparece na próxima consulta.

Consulte também a documentação dos editores. [Visual Studio para projetos JavaScript em pasta](https://learn.microsoft.com/pt-br/visualstudio/javascript/develop-javascript-code-without-solutions-projects) · [Depuração de Node.js no VS Code](https://code.visualstudio.com/docs/nodejs/nodejs-debugging)
