// ============================================================
// CORRECCIÓN 2026-11-12 (caso real Alejandro Maita, orden del
// dueño 2026-11-11): dos fallas del asistente de JMP.
// FALLA 1 — EL CLIENTE QUE NO SABE DE YARDAS: el bot le ofrecía
// calcularlo por las medidas pero volvía a preguntar «¿Cuántas
// yardas necesita?»; y las medidas dadas en mensajes separados
// («es un garage» / «25 x 35» / «a 4 pulgadas») nunca se
// juntaban para calcular. Arreglo: al decir que no sabe, el
// modo medidas queda ACTIVO en el flujo (flow.esperandoMedidas)
// y cada mensaje acumula largo/ancho/grosor
// (flow.medidasParciales) hasta calcular con la regla de
// siempre (volumen/27, +10%, media yarda; 25×35×4" = 12
// yardas). Tras ofrecer el cálculo NUNCA se vuelve a preguntar
// las yardas: se pregunta solo la dimensión que falta.
// FALLA 2 — «¿SOLO VENDEN EL CEMENTO O TAMBIÉN HACEN LA
// CONSTRUCCIÓN?»: la preguntó dos veces y el bot no la entendió.
// Arreglo: FAQ de construcción con la frase EXACTA del dueño
// (2026-11-11): «La construcción no la hacemos pero le podemos
// conseguir el crew adecuados para su proyecto» — sin «no
// entendí», y el flujo sigue.
// Correr: node tests/medidas-construccion.test.js
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jmp-medidas-test-'));
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

const FRASE_CONSTRUCCION =
  'La construcción no la hacemos pero le podemos conseguir el crew adecuados para su proyecto';
const FRASE_CONSTRUCCION_EN =
  "We don't do the construction ourselves, but we can get you the right crew for your project.";
const PREG_YARDAS = '¿Cuántas yardas necesita?';

// ---------- Unidades: calculadora y acumulación parcial ----------
{
  check('calc: 25×35×4 = 12 yardas', bot.calcularYardasMedidas(25, 35, 4) === '12',
    bot.calcularYardasMedidas(25, 35, 4));
  check('calc: 20×30×4 = 8 yardas', bot.calcularYardasMedidas(20, 30, 4) === '8',
    bot.calcularYardasMedidas(20, 30, 4));
  let p = bot.extraerMedidasParciales('25 x 35', null);
  check('parciales: par «25 x 35» da largo y ancho', p.largo === 25 && p.ancho === 35, JSON.stringify(p));
  p = bot.extraerMedidasParciales('25 de largo', null);
  check('parciales: «25 de largo» da solo el largo', p.largo === 25 && !p.ancho, JSON.stringify(p));
  p = bot.extraerMedidasParciales('a 4 pulgadas', p);
  check('parciales: «a 4 pulgadas» acumula el grosor sin pisar el largo',
    p.largo === 25 && p.grosor === 4 && !p.ancho, JSON.stringify(p));
  p = bot.extraerMedidasParciales('35', p);
  check('parciales: número pelón rellena el ancho que falta',
    p.largo === 25 && p.ancho === 35 && p.grosor === 4, JSON.stringify(p));
  p = bot.extraerMedidasParciales('es un garage', null);
  check('parciales: «es un garage» no inventa ninguna medida',
    !p.largo && !p.ancho && !p.grosor, JSON.stringify(p));
}

// ---------- Unidades: detector de construcción ----------
{
  check('detector: la frase exacta de Alejandro',
    bot.esPreguntaConstruccion('¿Solo venden el cemento o también hacen la construcción?'));
  check('detector: «¿Ustedes hacen la construcción?»',
    bot.esPreguntaConstruccion('¿Ustedes hacen la construcción?'));
  check('detector: «¿la construcción también la hacen?»',
    bot.esPreguntaConstruccion('¿la construcción también la hacen?'));
  check('detector EN: «Do you also do the construction?»',
    bot.esPreguntaConstruccion('Do you also do the construction?'));
  check('detector: NO dispara describiendo el proyecto',
    !bot.esPreguntaConstruccion('es para la construcción de mi casa, necesito 10 yardas'));
  check('detector: NO dispara hablando de la orden',
    !bot.esPreguntaConstruccion('quiero cambiar la construcción de mi orden'));
  check('detector: NO dispara con la pregunta de vender sola',
    !bot.esPreguntaConstruccion('¿Venden concreto?'));
}

// ---------- Flujo: no sabe yardas → medidas en un solo mensaje ----------
{
  let conv = db.upsertConversation('15552220001', 'Un Mensaje');
  let r = turno(conv, 'Hola, necesito concreto');
  r = turno(r.conv, 'No se lo que es una yarda?');
  check('no-sabe: ofrece el cálculo por medidas',
    (r.d.texto || '').includes('Se lo calculamos'), r.d.texto);
  check('no-sabe: NO vuelve a preguntar las yardas',
    !(r.d.texto || '').includes(PREG_YARDAS), r.d.texto);
  check('no-sabe: el modo medidas queda activo en el flujo',
    r.conv.flow && r.conv.flow.esperandoMedidas === true, JSON.stringify(r.conv.flow));
  r = turno(r.conv, 'garage 25 por 35 pies, de 4 pulgadas');
  check('un mensaje: calcula 12 yardas',
    r.conv.flow && r.conv.flow.datos.yardas && r.conv.flow.datos.yardas.cantidad === '12',
    JSON.stringify(r.conv.flow && r.conv.flow.datos));
  check('un mensaje: la respuesta trae la línea de medidas con 12',
    (r.d.texto || '').includes('*12 yardas*'), r.d.texto);
  check('un mensaje: el modo medidas se apaga tras calcular',
    r.conv.flow && !r.conv.flow.esperandoMedidas);
}

// ---------- Flujo: medidas PARTIDAS en varios mensajes (el caso real) ----------
{
  let conv = db.upsertConversation('15552220002', 'Partidas');
  let r = turno(conv, 'Estoy buscando precio de concreto');
  r = turno(r.conv, 'No se lo que es una yarda?');
  r = turno(r.conv, 'es un garage');
  check('partidas: «es un garage» no rompe el modo ni pregunta yardas',
    !(r.d.texto || '').includes(PREG_YARDAS) && r.conv.flow.esperandoMedidas === true, r.d.texto);
  r = turno(r.conv, '25 de largo');
  check('partidas: tras el largo pregunta SOLO el ancho',
    (r.d.texto || '').includes('ancho') && !(r.d.texto || '').includes(PREG_YARDAS), r.d.texto);
  check('partidas: aún no hay yardas anotadas',
    !(r.conv.flow.datos.yardas), JSON.stringify(r.conv.flow.datos));
  r = turno(r.conv, 'a 4 pulgadas');
  check('partidas: «a 4 pulgadas» NO se anota como 4 yardas',
    !(r.conv.flow.datos.yardas), JSON.stringify(r.conv.flow.datos));
  check('partidas: el grosor quedó acumulado',
    r.conv.flow.medidasParciales && r.conv.flow.medidasParciales.grosor === 4,
    JSON.stringify(r.conv.flow.medidasParciales));
  r = turno(r.conv, '35 de ancho');
  check('partidas: al completar calcula 12 yardas',
    r.conv.flow.datos.yardas && r.conv.flow.datos.yardas.cantidad === '12',
    JSON.stringify(r.conv.flow.datos));
  check('partidas: la respuesta trae la línea de medidas',
    (r.d.texto || '').includes('Con esas medidas'), r.d.texto);
  check('partidas: el flujo avanzó (ya no está en yardas)',
    r.conv.flow.datos.yardas && !(r.d.texto || '').includes(PREG_YARDAS), r.d.texto);
}

// ---------- Flujo: par suelto tras el no-sabe + otro cálculo ----------
{
  let conv = db.upsertConversation('15552220003', 'Par Suelto');
  let r = turno(conv, 'Hola, necesito concreto');
  r = turno(r.conv, 'No sé cuántas yardas');
  r = turno(r.conv, '20 por 30');
  check('par suelto: 20×30 con grosor estándar = 8 yardas',
    r.conv.flow.datos.yardas && r.conv.flow.datos.yardas.cantidad === '8',
    JSON.stringify(r.conv.flow.datos));
}

// ---------- «No sé lo que es una yarda» como PRIMER mensaje ----------
{
  const conv = db.upsertConversation('15552220004', 'Primero');
  const r = turno(conv, 'No sé lo que es una yarda');
  check('primer mensaje: abre la cotización y ofrece el cálculo',
    (r.d.texto || '').includes('Se lo calculamos'), r.d.texto);
  check('primer mensaje: NO pregunta las yardas de vuelta',
    !(r.d.texto || '').includes(PREG_YARDAS), r.d.texto);
}

// ---------- Construcción SIN flujo (la pregunta exacta de Alejandro) ----------
{
  const conv = db.upsertConversation('15552220005', 'Alejandro');
  const r = turno(conv, '¿Solo venden el cemento o también hacen la construcción?');
  check('construcción sin flujo: responde la frase EXACTA del dueño',
    (r.d.texto || '').includes(FRASE_CONSTRUCCION), r.d.texto);
  check('construcción sin flujo: nada de «no entendí»',
    !/no (le )?entend/i.test(r.d.texto || ''), r.d.texto);
  check('construcción sin flujo: sale con intent «construccion»',
    r.d.intent === 'construccion', r.d.intent);
  const r2 = turno(r.conv, '10 yardas');
  check('construcción sin flujo: el flujo sigue y captura las yardas',
    r2.conv.flow && r2.conv.flow.datos.yardas && r2.conv.flow.datos.yardas.cantidad === '10',
    JSON.stringify(r2.conv.flow && r2.conv.flow.datos));
}

// ---------- Construcción A MITAD del flujo ----------
{
  let conv = db.upsertConversation('15552220006', 'Mitad');
  let r = turno(conv, 'Hola, necesito concreto');
  r = turno(r.conv, '¿También hacen la construcción?');
  check('construcción en flujo: responde la frase EXACTA del dueño',
    (r.d.texto || '').includes(FRASE_CONSTRUCCION), r.d.texto);
  check('construcción en flujo: retoma el paso de las yardas',
    (r.d.texto || '').includes(PREG_YARDAS), r.d.texto);
  check('construcción en flujo: la pregunta NO quedó como dato',
    !(r.conv.flow.datos.direccion) && !(r.conv.flow.datos.yardas),
    JSON.stringify(r.conv.flow.datos));
  r = turno(r.conv, '10 yardas');
  check('construcción en flujo: el flujo continúa normal',
    r.conv.flow.datos.yardas && r.conv.flow.datos.yardas.cantidad === '10',
    JSON.stringify(r.conv.flow.datos));
}

// ---------- Construcción en INGLÉS sin flujo ----------
{
  const conv = db.upsertConversation('15552220007', 'English');
  const r = turno(conv, 'Do you also do the construction?');
  check('construcción EN: responde la frase en inglés',
    (r.d.texto || '').includes(FRASE_CONSTRUCCION_EN), r.d.texto);
  check('construcción EN: nada de «no entendí»',
    !/no (le )?entend|didn.t understand/i.test(r.d.texto || ''), r.d.texto);
}

console.log(`\nmedidas-construccion: ${ok}/${total} checks OK`);
if (fallos.length) {
  console.log('FALLOS:');
  for (const f of fallos) console.log('  ✗ ' + f);
  process.exit(1);
}
