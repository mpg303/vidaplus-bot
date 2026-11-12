// ============================================================
// CORRECCIÓN 2026-11-12 (caso real Alejandro Maita; política
// final del dueño con precisión de las 16:26): el cliente
// preguntó dos veces «Si solo quiero el delivery ustedes me
// lo hacen?» y el bot no entendió ninguna. Arreglo: detector
// nuevo de SOLO DELIVERY / SOLO ENTREGA que responde con la
// política final — SÍ se puede hacer solo el delivery aunque
// el cliente tenga su concreto por otro lado, y ese
// servicio tiene un COSTO APARTE según la dirección de
// entrega; si el concreto lo compra con JMP, JMP responde
// por la calidad. Sin
// flujo la respuesta abre la cotización en las yardas; a
// mitad del flujo responde y retoma el paso, sin capturar la
// pregunta como dato. Trampas: dar la dirección de entrega,
// preguntar la hora/día de SU entrega o confirmar datos del
// pedido NO disparan el detector.
// Correr: node tests/solo-delivery.test.js
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jmp-delivery-test-'));
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
  return { d, conv: db.getConversation(conv.id) || conv };
}

const FRASE =
  'Sí, claro: también le podemos hacer solo el delivery y entregarle el concreto en su obra. El delivery tiene un costo aparte, que depende de la dirección de entrega. Eso sí, si el concreto lo compra con nosotros, respondemos por su calidad.';
const FRASE_EN =
  'Yes, of course: we can also do delivery only and bring the concrete to your job site. Delivery has a separate cost, which depends on the delivery address. That said, if you buy the concrete from us, we stand behind its quality.';
const PREG_YARDAS = '¿Cuántas yardas necesita?';

// La política final (precisión del dueño 2026-11-12 16:26)
// manda en la propia frase: SÍ se hace solo el delivery,
// con costo aparte según la dirección; y si el concreto
// lo compra con JMP, JMP responde por su calidad.
check('frase: abre confirmando que sí se hace solo el delivery',
  FRASE.startsWith('Sí, claro: también le podemos hacer solo el delivery'));
check('frase: el delivery tiene costo aparte', /costo aparte/.test(FRASE));
check('frase: JMP responde por la calidad si el concreto es de JMP',
  /respondemos por su calidad/.test(FRASE));
check('frase: NO dice que solo venden el concreto ellos',
  !/Preferiblemente le vendemos/.test(FRASE));

// ---------- Unidades: detector de solo delivery ----------
{
  check('delivery: frase exacta de Alejandro',
    bot.esPreguntaSoloDelivery('Si solo quiero el delivery ustedes me lo hacen?'));
  check('delivery: «solo quiero el delivery»',
    bot.esPreguntaSoloDelivery('solo quiero el delivery'));
  check('delivery: «solo el delivery»',
    bot.esPreguntaSoloDelivery('solo el delivery, nada más'));
  check('delivery: «nomás la entrega»',
    bot.esPreguntaSoloDelivery('nomás la entrega ocupo'));
  check('delivery: «solo necesito la entrega»',
    bot.esPreguntaSoloDelivery('yo solo necesito la entrega'));
  check('delivery: «la entrega nomás»',
    bot.esPreguntaSoloDelivery('la entrega nomás, yo pongo mi gente'));
  check('delivery: «¿ustedes hacen el delivery?»',
    bot.esPreguntaSoloDelivery('¿ustedes hacen el delivery?'));
  check('delivery: «¿Ustedes hacen entregas?»',
    bot.esPreguntaSoloDelivery('¿Ustedes hacen entregas?'));
  check('delivery: error de dedo «solo kiero el delivery» NO exige «quiero»',
    bot.esPreguntaSoloDelivery('solo ocupo el delibery'));
  check('delivery EN: «delivery only»',
    bot.esPreguntaSoloDelivery('delivery only, please'));
  check('delivery EN: «just the delivery»',
    bot.esPreguntaSoloDelivery('I just need the delivery'));
  check('delivery EN: «I only need the delivery»',
    bot.esPreguntaSoloDelivery('I only need the delivery, I have my own crew'));
  check('delivery EN: «Do you deliver?»',
    bot.esPreguntaSoloDelivery('Do you deliver?'));
  check('delivery EN: «do you do delivery?»',
    bot.esPreguntaSoloDelivery('Do you guys do delivery too?'));
  // Trampas: el flujo normal usa «entrega»/«delivery» sin
  // que sea esta pregunta.
  check('delivery: NO dispara dando la dirección de entrega',
    !bot.esPreguntaSoloDelivery('La dirección de entrega es 123 Main St, Dallas, TX'));
  check('delivery: NO dispara con «my delivery address is…»',
    !bot.esPreguntaSoloDelivery('my delivery address is 456 Oak Ave'));
  check('delivery: NO dispara preguntando la hora de SU entrega',
    !bot.esPreguntaSoloDelivery('¿A qué hora es la entrega?'));
  check('delivery: NO dispara confirmando el día de entrega',
    !bot.esPreguntaSoloDelivery('la entrega queda el viernes a las 9'));
  check('delivery: NO dispara hablando de la orden',
    !bot.esPreguntaSoloDelivery('quiero cambiar el delivery de mi orden'));
  check('delivery: NO dispara con el precio',
    !bot.esPreguntaSoloDelivery('¿cuánto cuesta la yarda?'));
  check('delivery: NO dispara con la pregunta de planta',
    !bot.esPreguntaSoloDelivery('¿De qué planta traen el cemento?'));
  check('delivery: NO dispara con la pregunta de garantía',
    !bot.esPreguntaSoloDelivery('¿Ustedes me dan garantía por su cemento?'));
  check('delivery: NO dispara con «¿venden concreto?»',
    !bot.esPreguntaSoloDelivery('¿Venden concreto?'));
}

// ---------- Solo delivery SIN flujo (la frase exacta de Alejandro) ----------
{
  const conv = db.upsertConversation('15553340001', 'Alejandro');
  const r = turno(conv, 'Si solo quiero el delivery ustedes me lo hacen?');
  check('sin flujo: responde la política EXACTA del dueño',
    (r.d.texto || '').includes(FRASE), r.d.texto);
  check('sin flujo: nada de «no entendí»',
    !/no (le )?entend/i.test(r.d.texto || ''), r.d.texto);
  check('sin flujo: sale con intent «solo_delivery»',
    r.d.intent === 'solo_delivery', r.d.intent);
  check('sin flujo: abre la cotización preguntando las yardas',
    (r.d.texto || '').includes(PREG_YARDAS), r.d.texto);
  const r2 = turno(r.conv, '10 yardas');
  check('sin flujo: el flujo sigue y captura las yardas',
    r2.conv.flow && r2.conv.flow.datos.yardas && r2.conv.flow.datos.yardas.cantidad === '10',
    JSON.stringify(r2.conv.flow && r2.conv.flow.datos));
}

// ---------- Inglés SIN flujo ----------
{
  const conv = db.upsertConversation('15553340002', 'English Delivery');
  const r = turno(conv, 'Do you deliver?');
  check('EN sin flujo: responde la política en inglés',
    (r.d.texto || '').includes(FRASE_EN), r.d.texto);
  const conv2 = db.upsertConversation('15553340003', 'English Delivery Only');
  const r2 = turno(conv2, 'I only need the delivery');
  check('EN sin flujo (only): responde la política en inglés',
    (r2.d.texto || '').includes(FRASE_EN), r2.d.texto);
}

// ---------- Saludo UNIDO a la pregunta ----------
{
  const conv = db.upsertConversation('15553340004', 'Saludo Delivery');
  const r = turno(conv, 'Hola, ¿ustedes hacen el delivery?');
  check('saludo+pregunta: responde la política EXACTA del dueño',
    (r.d.texto || '').includes(FRASE), r.d.texto);
}

// ---------- Solo delivery A MITAD del flujo (paso del mix) ----------
{
  let conv = db.upsertConversation('15553340005', 'Mitad Delivery');
  let r = turno(conv, 'Hola, necesito concreto');
  r = turno(r.conv, '10 yardas');
  check('en flujo: las yardas quedaron anotadas',
    r.conv.flow.datos.yardas && r.conv.flow.datos.yardas.cantidad === '10',
    JSON.stringify(r.conv.flow.datos));
  r = turno(r.conv, 'una pregunta, si solo quiero el delivery ustedes me lo hacen?');
  check('en flujo: responde la política EXACTA del dueño',
    (r.d.texto || '').includes(FRASE), r.d.texto);
  check('en flujo: la pregunta NO quedó como mix',
    !r.conv.flow.datos.mix, JSON.stringify(r.conv.flow.datos));
  check('en flujo: retoma el paso del mix',
    /mix|resistencia/i.test(r.d.texto || ''), r.d.texto);
  check('en flujo: las yardas se conservan',
    r.conv.flow.datos.yardas && r.conv.flow.datos.yardas.cantidad === '10',
    JSON.stringify(r.conv.flow.datos));
  r = turno(r.conv, '3000 psi');
  check('en flujo: el flujo continúa y captura el mix',
    r.conv.flow.datos.mix && /3000/.test(r.conv.flow.datos.mix),
    JSON.stringify(r.conv.flow.datos));
}

// ---------- Solo delivery A MITAD del flujo (paso de la POMPA: la trampa) ----------
// «solo OCUPO la entrega» trae la palabra-bala del paso de
// la pompa: sin la limpieza incondicional de la captura se
// anotaba como «sí, ocupa pompa» (pasó en la primera
// corrida de esta suite).
{
  let conv = db.upsertConversation('15553340008', 'Mitad Delivery Pompa');
  let r = turno(conv, 'Hola, necesito concreto');
  r = turno(r.conv, '10 yardas');
  r = turno(r.conv, '3000 psi');
  r = turno(r.conv, 'sin aire');
  r = turno(r.conv, '¿y si solo ocupo la entrega?');
  check('en flujo (pompa): responde la política EXACTA del dueño',
    (r.d.texto || '').includes(FRASE), r.d.texto);
  check('en flujo (pompa): la pregunta NO se anotó como «ocupa pompa»',
    !r.conv.flow.datos.pompa, JSON.stringify(r.conv.flow.datos));
  check('en flujo (pompa): retoma el paso de la pompa',
    /pompa|pump/i.test(r.d.texto || ''), r.d.texto);
  r = turno(r.conv, 'sin pompa');
  check('en flujo (pompa): el flujo continúa tras responder la pompa',
    r.conv.flow.datos.pompa !== undefined || /direcci/i.test(r.d.texto || ''),
    JSON.stringify(r.conv.flow.datos) + ' | ' + r.d.texto);
}

// ---------- Solo delivery A MITAD del flujo (paso de dirección) ----------
{
  let conv = db.upsertConversation('15553340006', 'Mitad Delivery Dir');
  let r = turno(conv, 'Hola, necesito concreto');
  r = turno(r.conv, '10 yardas');
  r = turno(r.conv, '3000 psi');
  r = turno(r.conv, 'sin aire');
  r = turno(r.conv, 'sin pompa');
  r = turno(r.conv, '¿y si solo ocupo la entrega?');
  check('en flujo (dirección): responde la política EXACTA del dueño',
    (r.d.texto || '').includes(FRASE), r.d.texto);
  check('en flujo (dirección): la pregunta NO quedó como dirección',
    !r.conv.flow.datos.direccion, JSON.stringify(r.conv.flow.datos));
  check('en flujo (dirección): retoma el paso de la dirección',
    /direcci/i.test(r.d.texto || ''), r.d.texto);
  r = turno(r.conv, '123 Main St, Dallas, TX');
  check('en flujo (dirección): el flujo continúa y captura la dirección',
    !!r.conv.flow.datos.direccion, JSON.stringify(r.conv.flow.datos));
}

// ---------- Trampa EN FLUJO: dar la dirección de entrega no dispara ----------
{
  let conv = db.upsertConversation('15553340007', 'Trampa Direccion');
  let r = turno(conv, 'Hola, necesito concreto');
  r = turno(r.conv, '10 yardas');
  r = turno(r.conv, '3000 psi');
  r = turno(r.conv, 'sin aire');
  r = turno(r.conv, 'la dirección de entrega es 789 Pine St, Dallas, TX');
  check('trampa: dar la dirección de entrega NO responde la política',
    !(r.d.texto || '').includes(FRASE), r.d.texto);
  check('trampa: la dirección SÍ quedó capturada',
    !!r.conv.flow.datos.direccion, JSON.stringify(r.conv.flow.datos));
}

console.log(`\nsolo-delivery: ${ok}/${total} checks OK`);
if (fallos.length) {
  console.log('FALLOS:');
  for (const f of fallos) console.log('  ✗ ' + f);
  process.exit(1);
}
