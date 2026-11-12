// ============================================================
// CORRECCIÓN 2026-11-12 (caso real Alejandro Maita, orden del
// dueño 2026-11-12): el cliente preguntó «¿Ustedes me dan
// garantía por su cemento?», «¿la calidad la garantizan?»,
// «¿De qué planta traen el cemento?» y «¿Desde qué planta
// traen el cemento?» y el bot respondió «no le entendí» a
// TODO. Arreglo: dos detectores nuevos (planta de origen y
// garantía/calidad) que responden con la frase del dueño —
// el concreto sale de la planta más cercana a la
// localización del cliente y se lo ENTREGA JMP. Redacción
// corregida por el dueño (2026-11-12 16:06): «entregado
// por nosotros», NUNCA «despachado por la planta». Sin
// flujo la respuesta abre la cotización en las yardas; a
// mitad del flujo responde y retoma el paso, sin capturar
// la pregunta como dato.
// ACTUALIZACIÓN 2026-11-12: la GARANTÍA pasa a la versión
// profesional aprobada por el dueño (le gustó la redacción
// larga — mix y PSI exactos pedidos, ticket de planta que
// lo respalda, revisión inmediata si no corresponde — con
// su ajuste de «entregado por nosotros» y la planta más
// cercana); la PLANTA DE ORIGEN conserva su frase corta.
// Correr: node tests/planta-garantia.test.js
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jmp-planta-test-'));
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

const FRASE_PLANTA =
  'El concreto se lo entregamos nosotros desde la planta más cercana a su localización, así le aseguramos que llegue perfecto.';
const FRASE_PLANTA_EN =
  'We deliver the concrete ourselves from the plant closest to your location, so we make sure it arrives perfect.';
const FRASE_GARANTIA =
  'Claro que sí, le garantizamos la calidad. El concreto que usted ordena se lo entregamos nosotros, desde la planta más cercana a su localización, para que le llegue en perfectas condiciones, con el mix y la resistencia (PSI) exactos que pidió, y su ticket de planta lo respalda. Si el concreto entregado no correspondiera a lo ordenado, lo revisamos de inmediato y respondemos por ello.';
const FRASE_GARANTIA_EN =
  'Yes, of course, we guarantee the quality. The concrete you order is delivered by us, from the plant closest to your location, so it arrives in perfect condition, with the exact mix and strength (PSI) you asked for, and your plant ticket backs it up. If the concrete delivered did not match what you ordered, we review it right away and stand behind it.';
const PREG_YARDAS = '¿Cuántas yardas necesita?';

// La redacción manda en las propias frases: «entregado por
// nosotros» y jamás la entrega presentada como despacho de
// la planta (corrección del dueño 2026-11-12 16:06), sin la
// redundancia «se lo llevamos» (corrección 16:09).
check('frase planta: dice que lo entregamos nosotros', /entregamos nosotros/.test(FRASE_PLANTA));
check('frase planta: NUNCA «despachado por la planta»', !/despachado por la planta/i.test(FRASE_PLANTA));
check('frase planta: sin la redundancia «se lo llevamos» (corrección 16:09)',
  !/se lo llevamos/i.test(FRASE_PLANTA));
// La garantía profesional aprobada por el dueño: abre con
// la garantía, trae la planta más cercana, el mix/PSI
// pedidos y el ticket de planta que lo respalda.
check('frase garantía: abre garantizando la calidad',
  FRASE_GARANTIA.startsWith('Claro que sí, le garantizamos la calidad.'));
check('frase garantía: dice «entregamos nosotros»', /entregamos nosotros/.test(FRASE_GARANTIA));
check('frase garantía: trae la «planta más cercana»', /planta más cercana/.test(FRASE_GARANTIA));
check('frase garantía: trae el «ticket de planta»', /ticket de planta/.test(FRASE_GARANTIA));
check('frase garantía: trae el respaldo si no corresponde',
  /no correspondiera a lo ordenado, lo revisamos de inmediato/.test(FRASE_GARANTIA));
check('frase garantía: NUNCA «despachado por la planta»', !/despachado por la planta/i.test(FRASE_GARANTIA));
check('frase garantía: sin la redundancia «se lo llevamos» (corrección 16:09)',
  !/se lo llevamos/i.test(FRASE_GARANTIA));

// ---------- Unidades: detector de planta de origen ----------
{
  check('planta: frase exacta de Alejandro 1',
    bot.esPreguntaPlantaOrigen('De qué planta traen el cemento?'));
  check('planta: frase exacta de Alejandro 2',
    bot.esPreguntaPlantaOrigen('Desde que planta traen el cemento?'));
  check('planta: «¿De qué planta viene el concreto?»',
    bot.esPreguntaPlantaOrigen('¿De qué planta viene el concreto?'));
  check('planta: «¿Cuál es la planta que usan?»',
    bot.esPreguntaPlantaOrigen('¿Cuál es la planta que usan?'));
  check('planta: «¿Qué planta surte mi zona?»',
    bot.esPreguntaPlantaOrigen('¿Qué planta surte mi zona?'));
  check('planta: error de dedo «de ke planta traen»',
    bot.esPreguntaPlantaOrigen('de ke planta traen el cemento'));
  check('planta EN: «Which plant does the concrete come from?»',
    bot.esPreguntaPlantaOrigen('Which plant does the concrete come from?'));
  check('planta EN: «What plant do you use?»',
    bot.esPreguntaPlantaOrigen('What plant do you use?'));
  // Trampas: describir el proyecto o hablar de otra cosa.
  check('planta: NO dispara con «garage de una planta»',
    !bot.esPreguntaPlantaOrigen('es para un garage de una planta'));
  check('planta: NO dispara con «la planta baja»',
    !bot.esPreguntaPlantaOrigen('la planta baja lleva 10 yardas de 3000'));
  check('planta: NO dispara con «mi planta de luz» (generador)',
    !bot.esPreguntaPlantaOrigen('mi planta de luz no sirve, mejor luego'));
  check('planta: NO dispara hablando de la orden',
    !bot.esPreguntaPlantaOrigen('quiero cambiar la planta de mi orden'));
  check('planta: NO dispara con la pregunta de vender',
    !bot.esPreguntaPlantaOrigen('¿Venden concreto?'));
  check('planta: NO dispara con la pregunta de garantía',
    !bot.esPreguntaPlantaOrigen('¿Ustedes me dan garantía por su cemento?'));
}

// ---------- Unidades: detector de garantía / calidad ----------
{
  check('garantía: frase exacta de Alejandro 1',
    bot.esPreguntaGarantia('Ustedes me dan garantía por su cemento?'));
  check('garantía: frase exacta de Alejandro 2',
    bot.esPreguntaGarantia('Que si me garantizan el cemento? La calidad del cemento que ustedes venden la garantizan?'));
  check('garantía: «¿Tienen garantía?»',
    bot.esPreguntaGarantia('¿Tienen garantía?'));
  check('garantía: «¿La calidad está garantizada?»',
    bot.esPreguntaGarantia('¿La calidad está garantizada?'));
  check('garantía: error de dedo «me garantisan»',
    bot.esPreguntaGarantia('¿me garantisan el cemento?'));
  check('garantía: sin acento «garantia»',
    bot.esPreguntaGarantia('dan garantia en el concreto?'));
  check('garantía EN: «Do you guarantee the quality?»',
    bot.esPreguntaGarantia('Do you guarantee the quality?'));
  check('garantía EN: «Is there a warranty on the concrete?»',
    bot.esPreguntaGarantia('Is there a warranty on the concrete?'));
  // Trampas: notas y negaciones no son la pregunta.
  check('garantía: NO dispara con «sin garantía está bien»',
    !bot.esPreguntaGarantia('sin garantía está bien, gracias'));
  check('garantía: NO dispara con «no necesito garantía»',
    !bot.esPreguntaGarantia('no necesito garantía, así déjelo'));
  check('garantía: NO dispara con el precio',
    !bot.esPreguntaGarantia('¿cuánto cuesta la yarda?'));
  check('garantía: NO dispara con construcción',
    !bot.esPreguntaGarantia('¿También hacen la construcción?'));
  check('garantía: NO dispara con la pregunta de planta',
    !bot.esPreguntaGarantia('¿De qué planta traen el cemento?'));
}

// ---------- Garantía SIN flujo (la pregunta exacta de Alejandro) ----------
{
  const conv = db.upsertConversation('15553330001', 'Alejandro');
  const r = turno(conv, 'Ustedes me dan garantía por su cemento?');
  check('garantía sin flujo: responde la frase profesional EXACTA aprobada',
    (r.d.texto || '').includes(FRASE_GARANTIA), r.d.texto);
  check('garantía sin flujo: nada de «no entendí»',
    !/no (le )?entend/i.test(r.d.texto || ''), r.d.texto);
  check('garantía sin flujo: sale con intent «garantia»',
    r.d.intent === 'garantia', r.d.intent);
  check('garantía sin flujo: abre la cotización preguntando las yardas',
    (r.d.texto || '').includes(PREG_YARDAS), r.d.texto);
  const r2 = turno(r.conv, '10 yardas');
  check('garantía sin flujo: el flujo sigue y captura las yardas',
    r2.conv.flow && r2.conv.flow.datos.yardas && r2.conv.flow.datos.yardas.cantidad === '10',
    JSON.stringify(r2.conv.flow && r2.conv.flow.datos));
}

// ---------- Planta SIN flujo (las dos formas de Alejandro) ----------
{
  const conv = db.upsertConversation('15553330002', 'Alejandro Planta');
  const r = turno(conv, 'De qué planta traen el cemento?');
  check('planta sin flujo: responde la frase EXACTA del dueño',
    (r.d.texto || '').includes(FRASE_PLANTA), r.d.texto);
  check('planta sin flujo: nada de «no entendí»',
    !/no (le )?entend/i.test(r.d.texto || ''), r.d.texto);
  check('planta sin flujo: sale con intent «planta_origen»',
    r.d.intent === 'planta_origen', r.d.intent);
  const conv2 = db.upsertConversation('15553330003', 'Alejandro Planta 2');
  const r2 = turno(conv2, 'Desde que planta traen el cemento?');
  check('planta sin flujo (desde): responde la frase EXACTA del dueño',
    (r2.d.texto || '').includes(FRASE_PLANTA), r2.d.texto);
}

// ---------- Planta A MITAD del flujo (paso del mix) ----------
{
  let conv = db.upsertConversation('15553330004', 'Mitad Planta');
  let r = turno(conv, 'Hola, necesito concreto');
  r = turno(r.conv, '10 yardas');
  check('planta en flujo: las yardas quedaron anotadas',
    r.conv.flow.datos.yardas && r.conv.flow.datos.yardas.cantidad === '10',
    JSON.stringify(r.conv.flow.datos));
  r = turno(r.conv, '¿De qué planta traen el cemento?');
  check('planta en flujo: responde la frase EXACTA del dueño',
    (r.d.texto || '').includes(FRASE_PLANTA), r.d.texto);
  check('planta en flujo: la pregunta NO quedó como mix',
    !r.conv.flow.datos.mix, JSON.stringify(r.conv.flow.datos));
  check('planta en flujo: retoma el paso del mix',
    /mix|resistencia/i.test(r.d.texto || ''), r.d.texto);
  check('planta en flujo: las yardas se conservan',
    r.conv.flow.datos.yardas && r.conv.flow.datos.yardas.cantidad === '10',
    JSON.stringify(r.conv.flow.datos));
  r = turno(r.conv, '3000 psi');
  check('planta en flujo: el flujo continúa y captura el mix',
    r.conv.flow.datos.mix && /3000/.test(r.conv.flow.datos.mix),
    JSON.stringify(r.conv.flow.datos));
}

// ---------- Garantía A MITAD del flujo (pregunta del aire) ----------
{
  let conv = db.upsertConversation('15553330005', 'Mitad Garantía');
  let r = turno(conv, 'Hola, necesito concreto');
  r = turno(r.conv, '10 yardas');
  r = turno(r.conv, '3000 psi');
  check('garantía en flujo: yardas y mix anotados',
    r.conv.flow.datos.yardas && /3000/.test(r.conv.flow.datos.mix || ''),
    JSON.stringify(r.conv.flow.datos));
  // Tras el mix el flujo queda en la pregunta del aire: la
  // pregunta de garantía se responde y esa pregunta se retoma.
  r = turno(r.conv, '¿Y la calidad la garantizan?');
  check('garantía en flujo: responde la frase profesional EXACTA aprobada',
    (r.d.texto || '').includes(FRASE_GARANTIA), r.d.texto);
  check('garantía en flujo: la pregunta NO quedó como dirección ni como mix',
    !r.conv.flow.datos.direccion && /3000/.test(r.conv.flow.datos.mix || ''),
    JSON.stringify(r.conv.flow.datos));
  check('garantía en flujo: retoma la pregunta pendiente (el aire)',
    /aire/i.test(r.d.texto || ''), r.d.texto);
  r = turno(r.conv, 'sin aire');
  r = turno(r.conv, '123 Main St, Dallas, TX');
  check('garantía en flujo: el flujo continúa y captura la dirección',
    !!r.conv.flow.datos.direccion, JSON.stringify(r.conv.flow.datos));
}

// ---------- Pregunta COMBINADA planta + garantía ----------
{
  const conv = db.upsertConversation('15553330006', 'Combinada');
  const r = turno(conv, '¿De qué planta viene y garantizan la calidad?');
  check('combinada: responde una de las frases EXACTAS (planta o garantía)',
    (r.d.texto || '').includes(FRASE_PLANTA) || (r.d.texto || '').includes(FRASE_GARANTIA),
    r.d.texto);
  check('combinada: nada de «no entendí»',
    !/no (le )?entend/i.test(r.d.texto || ''), r.d.texto);
}

// ---------- Trampa EN FLUJO: describir el proyecto no dispara ----------
{
  let conv = db.upsertConversation('15553330007', 'Trampa Proyecto');
  let r = turno(conv, 'Hola, necesito concreto');
  r = turno(r.conv, 'No se lo que es una yarda?');
  r = turno(r.conv, 'es un garage de una planta');
  check('trampa: «garage de una planta» NO responde la frase de planta ni la de garantía',
    !(r.d.texto || '').includes(FRASE_PLANTA) && !(r.d.texto || '').includes(FRASE_GARANTIA),
    r.d.texto);
  check('trampa: el modo medidas sigue activo y no pregunta yardas de vuelta',
    r.conv.flow.esperandoMedidas === true && !(r.d.texto || '').includes(PREG_YARDAS),
    r.d.texto);
  r = turno(r.conv, '25 por 35 a 4 pulgadas');
  check('trampa: tras describir, el cálculo sigue funcionando (12 yardas)',
    r.conv.flow.datos.yardas && r.conv.flow.datos.yardas.cantidad === '12',
    JSON.stringify(r.conv.flow.datos));
}

// ---------- Saludo UNIDO a la pregunta ----------
{
  const conv = db.upsertConversation('15553330010', 'Saludo Pregunta');
  const r = turno(conv, 'Hola, ¿de qué planta traen el cemento?');
  check('saludo+pregunta: responde la frase EXACTA del dueño',
    (r.d.texto || '').includes(FRASE_PLANTA), r.d.texto);
  const conv2 = db.upsertConversation('15553330011', 'Greeting Question');
  const r2 = turno(conv2, 'Hi, which plant do you use?');
  check('saludo+pregunta EN: responde la frase en inglés (sin caer en la bienvenida)',
    (r2.d.texto || '').includes(FRASE_PLANTA_EN), r2.d.texto);
}

// ---------- Saludo UNIDO a la pregunta de garantía ----------
{
  const conv = db.upsertConversation('15553330012', 'Saludo Garantía');
  const r = turno(conv, 'Hola, ¿ustedes me dan garantía por su cemento?');
  check('saludo+garantía: responde la frase profesional EXACTA aprobada',
    (r.d.texto || '').includes(FRASE_GARANTIA), r.d.texto);
  check('saludo+garantía: sale con intent «garantia»',
    r.d.intent === 'garantia', r.d.intent);
}

// ---------- Inglés SIN flujo ----------
{
  const conv = db.upsertConversation('15553330008', 'English Plant');
  const r = turno(conv, 'Which plant does the concrete come from?');
  check('planta EN: responde la frase en inglés',
    (r.d.texto || '').includes(FRASE_PLANTA_EN), r.d.texto);
  const conv2 = db.upsertConversation('15553330009', 'English Warranty');
  const r2 = turno(conv2, 'Do you guarantee the concrete?');
  check('garantía EN: responde la frase profesional en inglés',
    (r2.d.texto || '').includes(FRASE_GARANTIA_EN), r2.d.texto);
}

console.log(`\nplanta-garantia: ${ok}/${total} checks OK`);
if (fallos.length) {
  console.log('FALLOS:');
  for (const f of fallos) console.log('  ✗ ' + f);
  process.exit(1);
}
