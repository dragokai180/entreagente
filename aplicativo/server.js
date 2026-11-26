'use strict';

const path = require('node:path');
const { createApplication } = require('./lib/app');
const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);
const file = path.resolve(process.env.DATA_FILE || path.join(__dirname,'entreagente-data.json'));
createApplication({file, secureCookie:process.env.COOKIE_SECURE === '1'}).listen(port,host,function () {
  console.log('EntreAgente em http://' + host + ':' + this.address().port);
});
