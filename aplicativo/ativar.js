'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { activationCode } = require('./lib/auth');
const { phoneDigits } = require('./lib/model');

function main() {
  const input = process.argv[2]?.trim();
  if (!input) throw new Error('Use npm run ativar -- TELEFONE_ANTIGO ou ID_DE_ACESSO.');
  const file = path.resolve(process.env.DATA_FILE || path.join(__dirname,'entreagente-data.json'));
  const state = JSON.parse(fs.readFileSync(file,'utf8'));
  if (state.version !== 2) throw new Error('Inicie a nova versão do servidor uma vez para migrar o arquivo.');
  const pending = state.users.filter(u => u.legacyPhone);
  const isPhone = /^[+()\d .-]+$/.test(input);
  const user = pending.find(u => u.loginId === input.toLowerCase()) ||
    (isPhone && pending.find(u => u.legacyPhone === phoneDigits(input)));
  if (!user || user.passwordHash) throw new Error('Cadastro antigo pendente de ativação não encontrado.');
  console.log('Morador:', user.name, '\nID:', user.loginId, '\nCódigo de ativação (24 horas):', activationCode(state,user));
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
