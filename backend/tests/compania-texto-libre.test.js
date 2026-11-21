// ============================================================
// Pruebas de regresión — FALLA REAL del 2026-11-21 (~3:32 PM):
// en el paso de la compañía, el cliente respondió «Jmp» tres
// veces y el bot repitió la misma pregunta para siempre. La
// interpretación general clasificaba la respuesta corta sin
// palabras de giro como NOMBRE; como el nombre ya estaba
// anotado, el dato se perdía y el flujo ni avanzaba ni
// escalaba. La compañía es TEXTO LIBRE: la respuesta al paso
// de la compañía ES la compañía. También se rescata el valor
// dentro de una queja de repetición («ya le he dicho 3 veces
// jmp»). «particular»/«no tengo» siguen dando «Particular» y
// «especialista» jamás se anota como compañía.
// Correr: node tests/compania-texto-libre.test.js
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jmp-compania-test-'));
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
/** Lleva una conversación nueva hasta el paso de la compañía (ES). */
function hastaCompania(waId) {
  let conv = db.upsertConversation(waId, 'Cliente Compania');
  for (const t of [
    'Hola, quiero cotizar concreto',
    '10 yardas',
    '3500 psi',
    'No aire',
    'No pompa',
    '4215 N Beltwood Dallas Tx',
    '31 de diciembre a las 7 am',
    'Jesús Morillo',
  ]) {
    conv = turno(conv, t).conv;
  }
  return conv;
}

// ---------------------------------------------------------------
// (1) LA CONVERSACIÓN EXACTA DE LA FALLA: nombre «Jesús
// Morillo» → compañía «Jmp». Debe aceptarse A LA PRIMERA,
// confirmarse como compañía y avanzar al paso del pago (nunca
// repetir la pregunta de la compañía).
// ---------------------------------------------------------------
{
  let conv = hastaCompania('30000000001');
  check('C1-0: el flujo llegó al paso de la compañía sin compañía',
    conv.flow && conv.flow.datos.nombre === 'Jesús Morillo' && !conv.flow.datos.compania,
    JSON.stringify(conv.flow && conv.flow.datos));
  const r = turno(conv, 'Jmp'); conv = r.conv;
  check('C1-a: «Jmp» se anota como compañía a la primera',
    conv.flow.datos.compania === 'Jmp', JSON.stringify(conv.flow.datos.compania));
  check('C1-b: el nombre NO se tocó',
    conv.flow.datos.nombre === 'Jesús Morillo', JSON.stringify(conv.flow.datos.nombre));
  check('C1-c: el bot confirma la compañía y avanza al pago',
    /anotada la compañía: \*Jmp\*/.test(r.d.texto || '') &&
      /¿Cómo va a pagar/.test(r.d.texto || ''),
    (r.d.texto || '').replace(/\n/g, ' | '));
  check('C1-d: la respuesta NO repite la pregunta de la compañía',
    !/¿Y cuál es el nombre de su compañía\?/.test(r.d.texto || ''),
    (r.d.texto || '').replace(/\n/g, ' | '));
}

// ---------------------------------------------------------------
// (2) VARIANTES de compañía corta / de una palabra: todas se
// aceptan a la primera en el paso de la compañía.
// ---------------------------------------------------------------
for (const [waId, valor] of [
  ['30000000002', 'JMP'],
  ['30000000003', 'jmp'],
  ['30000000004', 'ABC'],
  ['30000000005', 'jmp concrete'],
  ['30000000006', 'Morillo Construction'],
]) {
  let conv = hastaCompania(waId);
  const r = turno(conv, valor); conv = r.conv;
  check(`C2: «${valor}» se acepta como compañía`,
    conv.flow.datos.compania === valor, JSON.stringify(conv.flow.datos.compania));
  check(`C2: tras «${valor}» el flujo avanza al pago`,
    /¿Cómo va a pagar/.test(r.d.texto || ''), (r.d.texto || '').replace(/\n/g, ' | '));
}

// ---------------------------------------------------------------
// (3) QUEJA DE REPETICIÓN: el cliente, ya en el paso de la
// compañía, escribe «Ya le he dicho 3 veces jmp». El bot debe
// aceptar el valor que ya dio («jmp») y avanzar — jamás
// repetir la pregunta de la compañía ni guardar la frase
// entera como compañía.
// ---------------------------------------------------------------
{
  let conv = hastaCompania('30000000007');
  const r = turno(conv, 'Ya le he dicho 3 veces jmp'); conv = r.conv;
  check('C3-a: la queja rescata el valor «jmp» como compañía',
    conv.flow.datos.compania === 'jmp', JSON.stringify(conv.flow.datos.compania));
  check('C3-b: tras la queja el flujo avanza al pago',
    /¿Cómo va a pagar/.test(r.d.texto || ''), (r.d.texto || '').replace(/\n/g, ' | '));
  check('C3-c: la respuesta NO repite la pregunta de la compañía',
    !/¿Y cuál es el nombre de su compañía\?/.test(r.d.texto || ''),
    (r.d.texto || '').replace(/\n/g, ' | '));
}
{
  let conv = hastaCompania('30000000008');
  const r = turno(conv, 'ya te dije: JMP'); conv = r.conv;
  check('C3-d: «ya te dije: JMP» rescata «JMP» y avanza',
    conv.flow.datos.compania === 'JMP' && /¿Cómo va a pagar/.test(r.d.texto || ''),
    JSON.stringify(conv.flow.datos.compania));
}

// ---------------------------------------------------------------
// (4) SIN COMPAÑÍA: «particular», «no tengo compañía» y
// «no tengo» siguen funcionando como antes (compañía
// «Particular» y el flujo avanza).
// ---------------------------------------------------------------
for (const [waId, valor] of [
  ['30000000009', 'particular'],
  ['30000000010', 'no tengo compañía'],
  ['30000000011', 'no tengo'],
]) {
  let conv = hastaCompania(waId);
  const r = turno(conv, valor); conv = r.conv;
  check(`C4: «${valor}» queda como Particular`,
    conv.flow.datos.compania === 'Particular', JSON.stringify(conv.flow.datos.compania));
  check(`C4: tras «${valor}» el flujo avanza al pago`,
    /¿Cómo va a pagar/.test(r.d.texto || ''), (r.d.texto || '').replace(/\n/g, ' | '));
}

// ---------------------------------------------------------------
// (5) PALABRA DE TRASPASO: «especialista» en el paso de la
// compañía NUNCA se anota como nombre de compañía.
// ---------------------------------------------------------------
{
  let conv = hastaCompania('30000000012');
  const r = turno(conv, 'especialista'); conv = r.conv;
  check('C5: «especialista» NO queda anotado como compañía',
    !conv.flow.datos.compania, JSON.stringify(conv.flow.datos.compania));
}

// ---------------------------------------------------------------
// (6) UNIDADES: la captura en el paso de la compañía y el
// paso del nombre quedan como deben.
// ---------------------------------------------------------------
{
  check('C6-a: extraerDatos(«Jmp», «compania») da la compañía',
    bot.extraerDatos('Jmp', 'compania').compania === 'Jmp',
    JSON.stringify(bot.extraerDatos('Jmp', 'compania')));
  check('C6-b: extraerDatos(«Ya le he dicho 3 veces jmp», «compania») rescata «jmp»',
    bot.extraerDatos('Ya le he dicho 3 veces jmp', 'compania').compania === 'jmp',
    JSON.stringify(bot.extraerDatos('Ya le he dicho 3 veces jmp', 'compania')));
  check('C6-c: en el paso del nombre, «Jesús Morillo» sigue siendo el nombre',
    bot.extraerDatos('Jesús Morillo', 'nombre').nombre === 'Jesús Morillo',
    JSON.stringify(bot.extraerDatos('Jesús Morillo', 'nombre')));
  check('C6-d: valorCompaniaSuelta(«especialista») es null',
    bot.valorCompaniaSuelta('especialista') === null);
  check('C6-e: valorCompaniaSuelta(«no tengo») es null (manda «sin compañía»)',
    bot.valorCompaniaSuelta('no tengo') === null);
}

console.log(`\ncompania-texto-libre: ${ok}/${total}`);
if (fallos.length) {
  console.log('FALLOS:');
  for (const f of fallos) console.log(' -', f);
  process.exit(1);
}
