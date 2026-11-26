'use strict';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function requireThat(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}
function field(value, label, min, max) {
  if (value == null && min === 0) return '';
  requireThat(typeof value === 'string', 400, 'Confira o campo ' + label + '.');
  const text = value.trim();
  requireThat(text.length >= min && text.length <= max, 400,
    label + ' deve ter entre ' + min + ' e ' + max + ' caracteres.');
  return text;
}
function requestKey(body) {
  requireThat(typeof body.requestId === 'string' && /^[a-zA-Z0-9-]{12,80}$/.test(body.requestId),
    400, 'Reabra o formulário para iniciar um novo envio.');
  return body.requestId;
}
module.exports = { HttpError, requireThat, field, requestKey };
