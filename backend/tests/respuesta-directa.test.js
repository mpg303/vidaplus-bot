// ============================================================
// RESPUESTA DIRECTA «¿VENDEN CONCRETO?» (orden del dueño,
// 2026-11-04 08:39: «Sí, agrega la respuesta directa de
// "vendemos concreto"»). Hasta hoy la pregunta más básica
// del negocio caía en el respaldo genérico «no le entendí»
// (y tras una orden cerrada, gracias al arreglo anterior,
// salía del post-cierre pero al mismo respaldo). Ahora la
// respuesta es FIJA, palabra por palabra:
//   ES «¡Claro que sí! Vendemos concreto por yarda cúbica
//      en Dallas–Fort Worth. ¿Cuántas yardas necesita?»
//   EN «Yes, we do! We sell concrete by the cubic yard in
//      Dallas–Fort Worth. How many yards do you need?»
// Se da en tres caminos: (a) cliente nuevo sin historial,
// (b) conversación post-cierre, (c) mitad de un flujo, como
// pregunta lateral que responde y retoma el paso.
// CONTINUACIÓN (verificado con sonda sobre la base): la
// captura libre SIN flujo solo anota la cantidad cuando el
// mensaje trae la unidad («10 yardas» abre cotización por
// abreFlujo); un «10» pelón caía en el respaldo. Por eso la
// respuesta directa, en los caminos sin flujo, ABRE la
// cotización en el paso de las yardas (patrón de la pregunta
// del aire suelta y de la cobertura por ciudad): la
// respuesta misma pregunta las yardas y el paso captura
// «10» y «10 yardas» por igual. Con flujo abierto, la
// caducidad de 30 min aplica como a cualquier flujo.
// Correr: node tests/respuesta-directa.test.js
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jmp-directa-test-'));
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
  db.addMessage({ conversationId: conv.id, waId: conv.waId, sender: 'CLIENTE', text: texto });
  const d = bot.decidirRespuesta(db.getConversation(conv.id) || conv, texto);
  if (d.responder && d.texto) {
    db.addMessage({
      conversationId: conv.id,
      waId: conv.waId,
      sender: 'BOT',
      text: d.texto,
      flags: { intent: d.intent, auto: true },
    });
  }
  if (d.confirmacionArmada) {
    db.addMessage({
      conversationId: conv.id,
      waId: conv.waId,
      sender: 'BOT',
      text: d.confirmacionArmada,
      flags: { tipo: 'confirmacion_armada', auto: true },
    });
    db.setNeedsHuman(conv.id, true);
  }
  return { d, conv: db.getConversation(conv.id) || conv };
}

const DIRECTA_ES =
  '¡Claro que sí! Vendemos concreto por yarda cúbica en Dallas–Fort Worth. ¿Cuántas yardas necesita?';
const DIRECTA_EN =
  'Yes, we do! We sell concrete by the cubic yard in Dallas–Fort Worth. How many yards do you need?';
const NOTA_ES = 'quedó anotado para el especialista';

function ordenCerrada(waId, nombre) {
  let conv = db.upsertConversation(waId, nombre);
  let r;
  for (const paso of [
    'Hola, necesito concreto', '7 yds', '3000 psi', 'Aire', 'No',
    '3069 forest ln Dallas tx', 'Mañana', '10:00', 'Am', 'Jesús Morillo', 'No tengo', 'Efectivo',
  ]) {
    r = turno(conv, paso);
    conv = r.conv;
  }
  return { conv, cierre: r.d };
}

// ---------- Detector: formas que SÍ son la pregunta ----------
for (const [txt] of [
  ['Venden concreto?'], ['¿Vendes concreto?'], ['Tienen concreto?'],
  ['¿Ofrecen concreto?'], ['¿Ustedes venden concreto?'],
  ['Do you sell concrete?'], ['you sell concrete?'], ['sell concrete'],
]) {
  check(`detector SÍ: «${txt}»`, bot.esPreguntaVendenConcreto(txt) === true);
}
// ---------- Detector: lo que NO es la pregunta ----------
for (const [txt] of [
  ['Quiero cambiar el concreto de mi orden'],
  ['¿Venden concreto para mi orden?'],
  ['Just a note on my order: do you sell concrete?'],
  ['¿Cuánto cuesta el concreto que venden?'],
  ['Necesito concreto'],
  ['¿Venden pompa?'],
  ['10 yardas'],
]) {
  check(`detector NO: «${txt}»`, bot.esPreguntaVendenConcreto(txt) === false);
}

// ---------- (a) Cliente nuevo: directa exacta + flujo en yardas ----------
{
  const conv = db.upsertConversation('15553330001', 'Nuevo');
  const r = turno(conv, 'Venden concreto?');
  check('nuevo: respuesta EXACTA del dueño (ES)', r.d.texto === DIRECTA_ES, r.d.texto);
  check('nuevo: intent «venden_concreto» (la IA no la pisa)',
    r.d.intent === 'venden_concreto', r.d.intent);
  check('nuevo: la cotización quedó abierta en el paso de yardas',
    !!r.conv.flow && !r.conv.flow.datos.yardas, JSON.stringify(r.conv.flow && r.conv.flow.datos));
  // Continuación con número pelón: el paso lo captura.
  const r2 = turno(r.conv, '10');
  check('nuevo: tras la directa, «10» se captura como yardas',
    !!r2.conv.flow && !!r2.conv.flow.datos.yardas && r2.conv.flow.datos.yardas.cantidad === '10',
    JSON.stringify(r2.conv.flow && r2.conv.flow.datos.yardas));
  check('nuevo: tras «10» el flujo sigue (pregunta el mix)',
    (r2.d.texto || '').includes('mix'), r2.d.texto);
}

// ---------- (a2) Cliente nuevo: continuación con «10 yardas» ----------
{
  const conv = db.upsertConversation('15553330002', 'NuevoYds');
  let r = turno(conv, 'Venden concreto?');
  r = turno(r.conv, '10 yardas');
  check('nuevo: tras la directa, «10 yardas» también se captura',
    !!r.conv.flow && !!r.conv.flow.datos.yardas && r.conv.flow.datos.yardas.cantidad === '10',
    JSON.stringify(r.conv.flow && r.conv.flow.datos.yardas));
}

// ---------- (a3) Cliente nuevo EN: directa exacta ----------
{
  const conv = db.upsertConversation('15553330003', 'NewEn');
  const r = turno(conv, 'Do you sell concrete?');
  check('nuevo EN: respuesta EXACTA del dueño (EN)', r.d.texto === DIRECTA_EN, r.d.texto);
  const r2 = turno(r.conv, '10 yards');
  check('nuevo EN: tras la directa, «10 yards» se captura',
    !!r2.conv.flow && !!r2.conv.flow.datos.yardas && r2.conv.flow.datos.yardas.cantidad === '10',
    JSON.stringify(r2.conv.flow && r2.conv.flow.datos.yardas));
}

// ---------- (b) Captura exacta del dueño: orden cerrada → «Hola» → pregunta ----------
{
  const { conv } = ordenCerrada('15553330004', 'CapturaDirecta');
  let r = turno(conv, 'Hola');
  r = turno(r.conv, 'Venden concreto?');
  check('captura: respuesta EXACTA del dueño tras la orden cerrada',
    r.d.texto === DIRECTA_ES, r.d.texto);
  check('captura: NO es nota del especialista ni postcierre',
    !(r.d.texto || '').includes(NOTA_ES) && r.d.intent === 'venden_concreto', r.d.intent);
  const r2 = turno(r.conv, '10');
  check('captura: tras la directa, «10» abre la cotización nueva con la cantidad',
    !!r2.conv.flow && !!r2.conv.flow.datos.yardas && r2.conv.flow.datos.yardas.cantidad === '10',
    JSON.stringify(r2.conv.flow && r2.conv.flow.datos.yardas));
  const ordenes = db.listOrders().filter((o) => o.conversationId === conv.id).length;
  check('captura: la orden vieja sigue siendo UNA en Orders (la cotización nueva no la toca)',
    ordenes === 1, String(ordenes));
}

// ---------- Guarda: la pregunta pegada a la orden NO es directa ----------
{
  const { conv } = ordenCerrada('15553330005', 'GuardaOrden');
  const r = turno(conv, '¿Venden concreto para mi orden?');
  check('guarda: «¿Venden concreto para mi orden?» sigue post-cierre (no directa)',
    r.d.intent === 'postcierre' && !(r.d.texto || '').includes('¡Claro que sí!'), r.d.texto);
}

// ---------- Guarda: la pregunta de precio NO es directa ----------
{
  const conv = db.upsertConversation('15553330006', 'GuardaPrecio');
  const r = turno(conv, '¿Cuánto cuesta el concreto que venden?');
  check('guarda: «¿Cuánto cuesta el concreto que venden?» NO recibe la directa',
    r.d.texto !== DIRECTA_ES && !(r.d.texto || '').includes('¡Claro que sí!'), r.d.texto);
}

// ---------- (c) Mitad de flujo, paso de yardas: directa pura y el flujo sigue ----------
{
  let conv = db.upsertConversation('15553330007', 'FlujoYardas');
  let r = turno(conv, 'Hola, necesito concreto');
  check('flujo: el pedido abrió en el paso de yardas', !!r.conv.flow && !r.conv.flow.datos.yardas);
  r = turno(r.conv, 'Venden concreto?');
  check('flujo yardas: la respuesta es la directa EXACTA (ya trae la pregunta del paso)',
    r.d.texto === DIRECTA_ES, r.d.texto);
  check('flujo yardas: el flujo sigue vivo y sin datos movidos',
    !!r.conv.flow && !r.conv.flow.datos.yardas && r.conv.flow.tipo === 'pedido',
    JSON.stringify(r.conv.flow && r.conv.flow.datos));
  r = turno(r.conv, '10');
  check('flujo yardas: tras la lateral, «10» se captura y el flujo avanza al mix',
    !!r.conv.flow && !!r.conv.flow.datos.yardas && r.conv.flow.datos.yardas.cantidad === '10' &&
      (r.d.texto || '').includes('mix'),
    r.d.texto);
}

// ---------- (c2) Mitad de flujo, paso de dirección: directa + se retoma el paso ----------
{
  let conv = db.upsertConversation('15553330008', 'FlujoDireccion');
  let r;
  for (const paso of ['Hola, necesito concreto', '7 yds', '3000 psi', 'Aire', 'No']) {
    r = turno(conv, paso);
    conv = r.conv;
  }
  check('flujo dir: el flujo quedó en el paso de dirección',
    !!conv.flow && !!conv.flow.datos.yardas && !conv.flow.datos.direccion,
    JSON.stringify(conv.flow && conv.flow.datos));
  r = turno(conv, 'Venden concreto?');
  check('flujo dir: la respuesta ABRE con la directa exacta',
    (r.d.texto || '').startsWith(DIRECTA_ES), r.d.texto);
  check('flujo dir: al final se retoma la pregunta del paso (dirección)',
    (r.d.texto || '').includes('dirección'), r.d.texto);
  check('flujo dir: los datos ya capturados NO se movieron',
    !!r.conv.flow && r.conv.flow.datos.yardas.cantidad === '7' && r.conv.flow.datos.mix === '3000 psi' &&
      !r.conv.flow.datos.direccion,
    JSON.stringify(r.conv.flow && r.conv.flow.datos));
  r = turno(r.conv, '3069 forest ln Dallas tx');
  check('flujo dir: tras la lateral, la dirección se captura y el flujo continúa',
    !!r.conv.flow && !!r.conv.flow.datos.direccion, JSON.stringify(r.conv.flow && r.conv.flow.datos));
}

console.log(`\nrespuesta-directa: ${ok}/${total} OK`);
if (fallos.length) {
  console.log('FALLOS:');
  for (const f of fallos) console.log(' -', f);
  process.exit(1);
}
