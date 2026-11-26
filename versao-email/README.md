# entreagente

Mockup de indicações para comunidades. O servidor usa apenas o Node.js, sem instalação de dependências.

## Compartilhar entre dispositivos

1. No computador que ficará ligado, abra um terminal na raiz do repositório e execute `npm run start:email`.
2. Nesse computador, acesse http://localhost:3000.
3. Nos outros dispositivos da mesma rede, acesse http://IP-DO-COMPUTADOR:3000, substituindo pelo endereço de rede do computador que executa o servidor.
4. Se a conexão for bloqueada, libere a porta 3000 no firewall da rede local.

Os dados compartilhados ficam em `entreagente-data.json` na raiz do repositório. Contas e sessões ficam em `entreagente-auth.json`, na mesma pasta, com senhas protegidas por hash. O cadastro permite criar uma conta de morador ou profissional. O login usa e-mail e senha. O nome no topo abre a edição ou exclusão da conta.

Os profissionais cadastrados aparecem para indicação em qualquer comunidade. Ao indicar, o morador escolhe um profissional e registra sua experiência. Imagens JPG, PNG ou WebP de até 2 MB ficam em entreagente-images/ no servidor. Esses arquivos são ignorados pelo Git.

Cada morador pode excluir suas próprias experiências pelo perfil do profissional. Convites aparecem nas notificações da conta com o email informado. A página consulta novidades a cada três segundos. Os registros locais da versão anterior são descartados ao abrir a página atualizada.

O cadastro e o login exigem que a página seja aberta pelo servidor; abrir o HTML diretamente não permite entrar. O servidor precisa continuar ligado para os outros dispositivos acessarem o aplicativo. A conexão HTTP local não criptografa senhas em trânsito e o email não é verificado: use apenas em uma rede de teste confiável, sem dados reais, e não exponha o servidor à internet. Para uso público, configure HTTPS, verificação de email e controles de acesso no servidor.

Para verificar a sincronização: npm test.
