# EntreAgente

Aplicativo de serviços e indicações em condomínios. O morador pode cadastrar profissionais, relatar experiências e publicar fotos e vídeos no feed. O prestador tem acesso próprio para apresentar sua trajetória e publicar trabalhos. Cada recomendação fica ligada ao morador que a escreveu, à ficha do profissional e ao condomínio.

Para abrir o projeto no Visual Studio ou no VS Code e acompanhar o cadastro no código, leia o [guia da estrutura](docs/estrutura.md).

## Rodar no Windows

Use Git e uma versão LTS do Node.js. A implementação foi testada com Node.js 24. O aplicativo e os testes usam módulos nativos do Node.

```powershell
node --version
git --version
npm.cmd test
npm.cmd start
```

Abra **http://localhost:3000**. Deixe esse terminal aberto enquanto usa o aplicativo. Para encerrar, pressione **Ctrl+C**. Outros dispositivos da mesma rede de testes podem acessar a porta 3000 pelo IP do computador que executa o servidor. Use dados fictícios no teste por HTTP. Para uso com dados reais, sirva por HTTPS e configure `COOKIE_SECURE=1` no servidor.

## Experimentar com duas contas

1. Em **Criar conta**, informe nome e uma senha de 15 a 128 caracteres. Na tela **Escolha seu tipo de perfil**, guarde o ID gerado, selecione **Morador** e clique em **Continuar**. O ID também aparece em **Minha conta**, no botão com seu nome. Nos próximos acessos use o ID e a senha.
2. Como Ana, crie o condomínio Palmeiras. Em **Cadastrar profissional**, registre Carlos Silva, categoria Elétrica. A ficha passa a aparecer no catálogo, com zero relatos.
3. Em **Moradores → Convidar morador → Gerar código de convite**, copie o código. Ele vale por 24 horas e admite uma entrada. Se Bruno já tiver uma conta, você também pode convidá-lo pelo ID de acesso.
4. Abra uma janela anônima ou um segundo navegador. Crie a conta de Bruno, escolha **Morador** e abra **Usar código de convite**. Convites enviados pelo ID aparecem em **Convites**.
5. Como Bruno, escolha **Indicar profissional**, busque Carlos e continue. Informe o serviço realizado, a nota e o relato. Marque **Recomendo este profissional** e publique.
6. Abra **Feed → Ver perfil** e depois **Minhas indicações**. O relato aparece nas três telas. Na janela de Ana, o feed também é atualizado. Em **Minhas indicações** de Ana, a lista continua vazia até que ela publique uma recomendação própria.

Em **Indicar profissional**, a opção **Cadastrar e voltar à indicação** abre o cadastro e retorna ao formulário de relato com a nova ficha selecionada. Se o morador publicar uma experiência com a opção de recomendar desmarcada, o relato e a nota aparecem apenas no perfil. Os favoritos são privados e usam o ID da ficha. Criador e moderadores podem corrigir uma ficha. A indicação sempre pertence ao morador que publicou o relato.

## Publicar fotos e vídeos como morador

No **Feed**, escolha **Publicar no feed**, selecione uma ou mais mídias e, se quiser, escreva uma legenda. Confira a prévia, remova ou acrescente arquivos e publique. Para associar as fotos ou os vídeos a um serviço, abra a ficha do profissional e escolha **Registrar experiência**. Marque **Recomendo este profissional** para que o relato também apareça no feed.

Cada publicação aceita até quatro arquivos e 48 MiB no total. Os formatos de foto são JPG, PNG e WebP, com até 8 MiB por arquivo. Para vídeos, use MP4 ou WebM com até 32 MiB por arquivo.

## Entrar como prestador e montar o perfil

1. Abra **Criar conta**, informe nome e senha e confirme o cadastro. A página **Escolha seu tipo de perfil** mostra seu ID. Guarde-o, selecione **Prestador de serviços** e clique em **Continuar**. Nos próximos acessos, entre com esse ID e a senha. Se sair antes de confirmar a escolha, a página aparecerá ao entrar de novo.
2. No painel do prestador, abra **Editar perfil**. Inclua uma foto, título profissional, região de atendimento, apresentação, competências e experiências. O botão **Adicionar experiência** permite registrar função, empresa ou projeto, período e atividades.
3. Em **Portfólio → Publicar trabalho**, informe o título e acrescente uma descrição, fotos ou vídeos. Em **Onde publicar**, **Portfólio do perfil** exibe o trabalho em todas as fichas vinculadas. Até o primeiro vínculo, só o prestador vê o portfólio.
4. Para conectar o perfil a um condomínio, o criador ou moderador abre a ficha do profissional no catálogo, escolhe **Vincular prestador** e informa o ID de acesso do prestador. Se a ficha ainda não existir, use **Cadastrar profissional**. O prestador abre seu painel e escolhe **Aceitar vínculo**.
5. Depois do aceite, em **Publicar trabalho → Onde publicar**, aparece a opção **Feed de [condomínio]**. Um trabalho publicado ali aparece no feed e na ficha daquele condomínio. Os moradores encontram o perfil, o portfólio e as avaliações ao abrir a ficha. Apenas os relatos dos moradores entram na média de notas e na contagem de recomendações.

Quem criou um ID numa versão anterior e caiu na área de morador sem entrar em um condomínio verá a escolha de perfil ao entrar com a conta existente. Prestadores já cadastrados e moradores que já participam de um condomínio continuam em suas áreas.

Se a moderação remover o vínculo, os trabalhos destinados àquele condomínio ficam visíveis apenas ao prestador. As avaliações dos moradores continuam disponíveis na ficha.

## Entender a implementação

| Onde começar | O que acompanhar |
| --- | --- |
| `lib/model.js` e `lib/store.js` | `newUser` gera um ID interno e um login legível. `catalogFor`, `profileFor` e `feedFor` são leituras diferentes dos mesmos registros. `openStore` carrega o JSON, migra a versão anterior e grava cada alteração por substituição de arquivo. |
| `lib/auth.js` e `lib/app.js` | Cadastro, login e sessão. A senha é derivada com scrypt e sal individual. O servidor entrega o cookie de sessão e resolve o usuário a cada chamada. |
| `lib/community.js` | `createProfessional` cria a ficha. `addReview` liga o relato a `authorId`, `professionalId` e `communityId`. A verificação de participação e papel acontece no servidor. |
| `lib/providers.js` e `public/provider-ui.js` | Edição do perfil, convite e aceite de vínculo, portfólio e publicação de trabalhos. |
| `lib/media.js` e `public/uploads.js` | Seleção e prévia de arquivos, limites de envio, armazenamento e leitura de mídia autorizada. |
| `public/index.html`, `public/app.js`, `public/app.css` | Acesso, navegação, formulários e atualização da tela. Procure por `showPicker`, `showProfessional`, `showReview`, `feedHtml` e `profileHtml`. |
| `tests/` | `model.test.js` cobre a migração. `api.test.js` cobre cadastro, escolha do perfil, indicações, portfólio e permissões. `server.test.js` inicia o servidor real. `client.test.js` conserva os testes da demonstração local antiga. |

### Seguir uma indicação do navegador ao feed

Em `public/app.js`, o envio de **Registrar experiência** faz um `POST` para `/api/communities/{condominio}/professionals/{ficha}/reviews`. O formulário envia serviço, nota, relato, a escolha de recomendar e uma chave por envio. A API lê o autor da sessão e gera a data. Repetir o mesmo envio com a mesma chave devolve o relato já criado. O catálogo e o perfil consultam a mesma ficha mesmo quando existem dois profissionais chamados Carlos Silva.

| Ação | Rota |
| --- | --- |
| Abrir conta e entrar | `POST /api/auth/register` e `POST /api/auth/login` |
| Confirmar o tipo de perfil depois do cadastro | `PUT /api/me/account-type` |
| Consultar a conta e os condomínios | `GET /api/me` |
| Cadastrar e procurar fichas | `POST` e `GET /api/communities/{condominio}/professionals` |
| Abrir a ficha | `GET /api/communities/{condominio}/professionals/{ficha}` |
| Publicar uma experiência | `POST /api/communities/{condominio}/professionals/{ficha}/reviews` |
| Publicar mídia no feed como morador | `POST /api/communities/{condominio}/posts` |
| Consultar o feed do condomínio | `GET /api/communities/{condominio}/feed` |
| Consultar o painel e editar o perfil do prestador | `GET /api/provider` e `PATCH /api/provider/profile` |
| Convidar um prestador e responder ao vínculo | `POST /api/communities/{condominio}/professionals/{ficha}/provider` e `POST /api/provider/links/{ficha}` |
| Publicar um trabalho | `POST /api/provider/posts` |
| Abrir uma mídia ou carregar um trecho de vídeo | `GET /api/media/{id}` |

O feed começa pela publicação mais recente e identifica indicações, postagens de moradores e trabalhos de prestadores. O perfil inclui todas as experiências e calcula a média das notas. Duas recomendações do mesmo morador geram dois relatos e contam como um morador que recomenda. A tela de catálogo permite encontrar profissionais homônimos pela categoria e pelo identificador curto da ficha.

## Dados do protótipo anterior

O servidor usa `entreagente-data.json` na pasta do projeto, ou o caminho informado na variável `DATA_FILE`. Os arquivos de mídia ficam ao lado, na pasta de mesmo nome com o sufixo `.media` (por padrão, `entreagente-data.json.media`). Para fazer uma cópia consistente ou mover sua instalação, encerre o servidor e copie juntos o JSON e a pasta de mídia. Mantenha um processo de servidor por arquivo. Os testes usam diretórios temporários próprios.

- **Base existente no servidor.** Ao iniciar esta versão, a migração guarda uma cópia integral em `entreagente-data.json.v1.bak`, atribui IDs e preserva comunidades, convites, moderação, relatos e favoritos identificáveis. Um arquivo já migrado conserva seus IDs nas próximas inicializações.
- **Dados antigos apenas no navegador.** Se o protótipo era aberto por HTTP, abra a versão anterior uma vez pelo mesmo endereço e navegador para concluir a importação antiga antes de migrar o arquivo do servidor. Se era aberto como arquivo, use a cópia de `entreagente_mockup.html` desta versão **no mesmo caminho e navegador**, entre no modo local e clique em **Exportar dados locais**. Para testar essa exportação em uma base separada, use os comandos abaixo. A demonstração que abre com duplo clique conserva o fluxo antigo.
- **Ativar um morador migrado.** O responsável pelo arquivo confirma com quem está falando, obtém o código local e o entrega em particular. O morador escolhe **Ativar cadastro antigo**, informa o código e define nome e senha. Criar uma conta nova com o mesmo nome produz uma conta independente.
- **Histórico incerto.** Relatos antigos aparecem no perfil como **Histórico sem data**. Quando há mais de uma ficha compatível com o mesmo nome, as identidades ambíguas ficam sinalizadas para revisão. Favoritos antigos ambíguos ficam em `unresolvedSaves`, e o morador pode salvar a ficha correta. A cópia original preserva todos os registros.

Para gerar o código usando o arquivo padrão, depois da primeira inicialização da nova versão, abra outro PowerShell na pasta do projeto.

```powershell
npm.cmd run ativar -- "TELEFONE_ANTIGO_OU_ID"
```

Para experimentar uma exportação do navegador em outro arquivo, encerre o servidor da porta 3000 e faça uma cópia com um nome novo em Downloads.

```powershell
$origem = Join-Path $HOME 'Downloads\entreagente-legado.json'
$copia = Join-Path $HOME ('Downloads\entreagente-teste-' + [guid]::NewGuid() + '.json')
Copy-Item -LiteralPath $origem -Destination $copia
$env:DATA_FILE = $copia
npm.cmd start
```

Se usar `DATA_FILE`, defina o mesmo caminho no terminal que executará `npm.cmd run ativar`. Para voltar ao arquivo padrão, encerre o servidor e execute `Remove-Item Env:DATA_FILE` no terminal em que definiu a variável. A reinicialização do servidor encerra as sessões de acesso. As contas, fichas e indicações permanecem no arquivo.
