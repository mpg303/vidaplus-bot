// ============================================================
// Pruebas de la RONDA 29 — parte B (regla del dueño, 2026-11-03
// 09:57): «Está bien si el cliente se va y regresar antes de
// 30 min. Puede seguir con la order, pero si no [regresa antes
// de 30 min], tiene que olvidar y comenzar de nuevo» / «Ya
// cuando pasa tanto tiempo se tiene que hacer una nueva
// conversación». Si desde el ÚLTIMO mensaje del cliente pasaron
// MÁS de 30 minutos, el flujo a medias se olvida completo y el
// mensaje se procesa como conversación nueva. Antes de 30 min
// el flujo sigue donde quedó. Las órdenes ya completadas viven
// en el registro de órdenes y no se tocan. Un flujo viejo sin
// marca de actividad y sin historial legible NUNCA caduca.
// (La parte A de la ronda — validar la fecha al capturarla —
// ya la cubre la ronda 28: ver tests/fecha-invalida.test.js.)
// Correr: node tests/caducidad-flujo.test.js
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jmp-caducidad-test-'));
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.SUPABASE_ANON_KEY;

const db = require('../src/db');
const bot = require('../src/services/autoReply');

let ok = 0;
let total = 0;
const fallos = [];
function check(nombre, cond, extra = '') {
  total++;
  if (cond) ok++;
  else fallos.push(`${nombre}${extra ? ` — ${extra}` : ''}`);
}
function turno(conv, texto) {
  const d = bot.decidirRespuesta(conv, texto);
  return { d, conv: db.getConversation(conv.id) || conv };
}
function nuevaConv(waId, name) {
  return db.upsertConversation(waId, name);
}
/** Lleva una conversación nueva hasta el paso de la fecha (ES). */
function hastaFecha(waId) {
  let conv = nuevaConv(waId, 'Cliente Caducidad');
  let r = turno(conv, 'Hola, quiero cotizar concreto'); conv = r.conv;
  r = turno(conv, '10 yardas'); conv = r.conv;
  r = turno(conv, '3500 psi'); conv = r.conv;
  r = turno(conv, 'No aire'); conv = r.conv;
  r = turno(conv, 'No pompa'); conv = r.conv;
  r = turno(conv, '4215 N Beltwood Dallas Tx'); conv = r.conv;
  return conv;
}
/** Envejece la marca de actividad del flujo de la conversación. */
function envejecer(conv, minutos) {
  const flow = conv.flow;
  flow.ultimoMensajeClienteEn = new Date(Date.now() - minutos * 60000).toISOString();
  db.setConversationFlow(conv.id, flow);
  return db.getConversation(conv.id) || conv;
}

// ---------------------------------------------------------------
// (1) VUELVE ANTES DE 30 MIN (20 min): el flujo sigue donde
// quedó — la fecha se anota sobre el MISMO flujo (yardas y
// dirección intactas) y la marca de actividad se renueva.
// ---------------------------------------------------------------
{
  let conv = hastaFecha('20000002001');
  conv = envejecer(conv, 20);
  let r = turno(conv, '31 de diciembre'); conv = r.conv;
  check('R29-1a: a los 20 min el flujo CONTINÚA: la fecha se anota',
    conv.flow && conv.flow.datos.fecha === '31 de diciembre', JSON.stringify(conv.flow && conv.flow.datos.fecha));
  check('R29-1b: los datos previos siguen (10 yardas, dirección)',
    conv.flow.datos.yardas && conv.flow.datos.yardas.cantidad === '10' &&
    conv.flow.datos.direccion === '4215 N Beltwood Dallas Tx',
    JSON.stringify(conv.flow.datos));
  check('R29-1c: la marca de actividad se renovó a «ahora»',
    Math.abs(Date.now() - Date.parse(conv.flow.ultimoMensajeClienteEn)) < 60000,
    conv.flow.ultimoMensajeClienteEn);
}

// ---------------------------------------------------------------
// (2) VUELVE DESPUÉS DE 30 MIN (31 min) con un «Hola»: el flujo
// se OLVIDA completo — nada de los datos viejos sobrevive y la
// respuesta es la de una conversación nueva, no la continuación
// del paso pendiente. El registro de órdenes no se toca.
// ---------------------------------------------------------------
{
  let conv = hastaFecha('20000002002');
  const ordenesAntes = db.listOrders().length;
  conv = envejecer(conv, 31);
  let r = turno(conv, 'Hola'); conv = r.conv;
  check('R29-2a: a los 31 min el flujo se olvidó (sin datos viejos)',
    !conv.flow || !conv.flow.datos || !conv.flow.datos.yardas,
    JSON.stringify(conv.flow && conv.flow.datos));
  check('R29-2b: la respuesta NO continúa el paso pendiente del día',
    !(r.d.texto || '').includes('anotado el día') &&
    !(r.d.texto || '').includes('¿A qué hora lo necesita en la obra?'),
    r.d.texto);
  check('R29-2c: el registro de órdenes quedó intacto',
    db.listOrders().length === ordenesAntes, `${ordenesAntes} -> ${db.listOrders().length}`);
}

// ---------------------------------------------------------------
// (3) VUELVE AL DÍA SIGUIENTE con datos NUEVOS: arranca un flujo
// limpio con SOLO lo nuevo — nada del flujo viejo se mezcla.
// ---------------------------------------------------------------
{
  let conv = hastaFecha('20000002003');
  conv = envejecer(conv, 60 * 26);
  let r = turno(conv, 'Quiero 20 yardas de 4000 psi'); conv = r.conv;
  check('R29-3a: el flujo nuevo trae las 20 yardas y el 4000 psi',
    conv.flow && conv.flow.datos.yardas && conv.flow.datos.yardas.cantidad === '20' &&
    /4000/.test(String(conv.flow.datos.mix || '')),
    JSON.stringify(conv.flow && conv.flow.datos));
  check('R29-3b: la dirección vieja NO se mezcló en el flujo nuevo',
    !conv.flow.datos.direccion, JSON.stringify(conv.flow.datos.direccion));
}

// ---------------------------------------------------------------
// (4) FLUJO VIEJO SIN MARCA (guardado por una versión anterior)
// y sin historial legible: NUNCA caduca por falta de reloj —
// el flujo sigue donde quedó.
// ---------------------------------------------------------------
{
  let conv = hastaFecha('20000002004');
  const flow = conv.flow;
  delete flow.ultimoMensajeClienteEn;
  db.setConversationFlow(conv.id, flow);
  conv = db.getConversation(conv.id) || conv;
  let r = turno(conv, '31 de diciembre'); conv = r.conv;
  check('R29-4a: sin marca ni historial, el flujo continúa y anota la fecha',
    conv.flow && conv.flow.datos.fecha === '31 de diciembre',
    JSON.stringify(conv.flow && conv.flow.datos));
}

console.log(`\ncaducidad-flujo: ${ok}/${total}`);
if (fallos.length) {
  console.log('FALLOS:');
  for (const f of fallos) console.log(' -', f);
  process.exit(1);
}
