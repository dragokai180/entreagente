# entreagente

Mockup de indicações para comunidades. O servidor usa apenas o Node.js, sem instalação de dependências.

## Compartilhar entre dispositivos

1. No computador que ficará ligado, abra um terminal nesta pasta e execute npm start.
2. Nesse computador, acesse http://localhost:3000.
3. Nos outros dispositivos da mesma rede, acesse http://IP-DO-COMPUTADOR:3000, substituindo pelo endereço de rede do computador que executa o servidor.
4. Se a conexão for bloqueada, libere a porta 3000 no firewall da rede local.

Os dados compartilhados ficam em entreagente-data.json, criado automaticamente na primeira alteração. O cadastro de profissionais é compartilhado entre comunidades. Ao indicar, o morador escolhe um profissional cadastrado e registra sua experiência. Imagens JPG, PNG ou WebP de até 2 MB ficam em entreagente-images/ no servidor. Ambos os caminhos são ignorados pelo Git.

Cada morador pode excluir suas próprias experiências pelo perfil do profissional. Convites aparecem nas notificações do destinatário quando ele entra com o número informado. A página consulta novidades a cada três segundos. Dados locais desta nova versão são importados uma vez ao abrir a página pelo servidor; os registros da versão anterior foram descartados.

Abrir o arquivo HTML diretamente mantém o modo local e não compartilha dados. O servidor precisa continuar ligado para os outros dispositivos acessarem o aplicativo. Este protótipo identifica pessoas apenas pelo telefone informado, sem verificar a posse do número; não use dados reais nem exponha o servidor à internet.

Para verificar a sincronização: npm test.
