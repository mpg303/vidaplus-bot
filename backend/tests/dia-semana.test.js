// ============================================================
// Pruebas del DÍA DE SEMANA de la fecha (defecto en vivo del
// dueño, 2026-11-04 00:40): el cliente dio la fecha «Para 20
// de noviembre», el bot la anotó y preguntó la hora; el
// cliente preguntó «Que día cae ??» y el bot NO respondió el
// día de semana: repitió la pregunta de la hora con el
// prefijo de continuación. Orden del dueño (00:42): el bot
// TIENE que deducir qué día de semana cae la fecha, porque
// importa saber si es domingo (la regla dominical sigue
// intacta). Reglas de esta ronda:
//  - Al capturar o corregir una fecha, la confirmación la
//    muestra CON su día de semana («anotado el día: *viernes
//    20 de noviembre*»), deducido de la fecha real validada
//    (resolverFechaMs), en español e inglés.
//  - Si el cliente pregunta qué día cae (ES/EN) en cualquier
//    paso, el bot responde el día de semana de la fecha
//    capturada (o de la que traiga el mensaje) y DESPUÉS
//    retoma la pregunta del paso actual.
//  - Sin fecha capturada ni en el mensaje, pide la fecha.
// Las fechas con año explícito (11/20/26 = viernes, 11/22/26
// = domingo) no dependen del día en que se corran las
// pruebas; las de «20 de noviembre» se verifican contra el
// mismo resolvedor del bot.
// Correr: node tests/dia-semana.test.js
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jmp-dia-semana-test-'));
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
  let conv = nuevaConv(waId, 'Cliente Día');
  let r = turno(conv, 'Hola, quiero cotizar concreto'); conv = r.conv;
  r = turno(conv, '10 yardas'); conv = r.conv;
  r = turno(conv, '3500 psi'); conv = r.conv;
  r = turno(conv, 'No aire'); conv = r.conv;
  r = turno(conv, 'No pompa'); conv = r.conv;
  r = turno(conv, '4215 N Beltwood Dallas Tx'); conv = r.conv;
  return conv;
}
/** Lleva una conversación nueva hasta el paso de la fecha (EN). */
function hastaFechaEN(waId) {
  let conv = nuevaConv(waId, 'Client Day');
  let r = turno(conv, 'Hi, I want to order concrete'); conv = r.conv;
  r = turno(conv, '10 yards'); conv = r.conv;
  r = turno(conv, '3500 psi'); conv = r.conv;
  r = turno(conv, 'No air'); conv = r.conv;
  r = turno(conv, 'No pump'); conv = r.conv;
  r = turno(conv, '4215 N Beltwood Dallas Tx'); conv = r.conv;
  return conv;
}

// ---------------------------------------------------------------
// (1) EL ESCENARIO EXACTO DE LA CAPTURA DEL DUEÑO: «Para 20 de
// noviembre» se confirma CON el día de semana y «Que día
// cae ??» se RESPONDE (y se retoma la hora, sin el prefijo
// de continuación de antes).
// ---------------------------------------------------------------
{
  let conv = hastaFecha('30000001001');
  let r = turno(conv, 'Para 20 de noviembre'); conv = r.conv;
  check('DS-1a: la fecha quedó guardada tal como la dio el cliente',
    conv.flow.datos.fecha === '20 de noviembre', JSON.stringify(conv.flow.datos.fecha));
  check('DS-1b: la confirmación muestra la fecha CON su día de semana',
    (r.d.texto || '').includes(`anotado el día: *${bot.fechaConDiaSemana('20 de noviembre', 'es')}*`),
    r.d.texto);
  check('DS-1c: el flujo siguió a la hora',
    (r.d.texto || '').includes('¿A qué hora lo necesita en la obra?'), r.d.texto);
  r = turno(conv, 'Que día cae ??'); conv = r.conv;
  check('DS-1d: «Que día cae ??» se responde con el día de semana de la fecha capturada',
    (r.d.texto || '').includes(bot.lineaDiaSemana('20 de noviembre', 'es')), r.d.texto);
  check('DS-1e: después de responder se retoma la pregunta del paso (la hora)',
    (r.d.texto || '').includes('¿A qué hora lo necesita en la obra?'), r.d.texto);
  check('DS-1f: ya NO sale el prefijo de continuación que evadía la pregunta',
    !(r.d.texto || '').includes('Vamos con su pedido'), r.d.texto);
}

// ---------------------------------------------------------------
// (2) FECHA NUMÉRICA CON AÑO EXPLÍCITO (11/20/26 = viernes,
// fijo sea cuando sea que se corra): confirmación y pregunta
// con los textos exactos.
// ---------------------------------------------------------------
{
  let conv = hastaFecha('30000001002');
  let r = turno(conv, '11/20/26'); conv = r.conv;
  check('DS-2a: «11/20/26» se confirma como «viernes 20 de noviembre»',
    (r.d.texto || '').includes('anotado el día: *viernes 20 de noviembre*'), r.d.texto);
  r = turno(conv, '¿Qué día cae?'); conv = r.conv;
  check('DS-2b: la respuesta exacta: «El *20 de noviembre* cae *viernes*.»',
    (r.d.texto || '').includes('El *20 de noviembre* cae *viernes*.'), r.d.texto);
}

// ---------------------------------------------------------------
// (3) INGLÉS: confirmación «Friday, November 20» y la
// pregunta «What day does it fall on?» respondida, retomando
// el paso de la hora en inglés.
// ---------------------------------------------------------------
{
  let conv = hastaFechaEN('30000001003');
  let r = turno(conv, '11/20/26'); conv = r.conv;
  check('DS-3a: EN — la confirmación trae el día de semana («Friday, November 20»)',
    (r.d.texto || '').includes('noted the day: *Friday, November 20*'), r.d.texto);
  r = turno(conv, 'What day does it fall on?'); conv = r.conv;
  check('DS-3b: EN — «What day does it fall on?» se responde («falls on a *Friday*»)',
    (r.d.texto || '').includes('*November 20* falls on a *Friday*.'), r.d.texto);
  check('DS-3c: EN — se retoma la pregunta del paso (la hora)',
    (r.d.texto || '').includes('At what time do you need it at the job site?'), r.d.texto);
}

// ---------------------------------------------------------------
// (4) DOMINGO (11/22/26): la confirmación lo nombra «domingo»
// y la regla dominical se mantiene intacta (marca especial +
// needsHuman); la pregunta posterior también se responde.
// ---------------------------------------------------------------
{
  let conv = hastaFecha('30000001004');
  let r = turno(conv, '11/22/26'); conv = r.conv;
  check('DS-4a: la confirmación del domingo lo dice: «domingo 22 de noviembre»',
    (r.d.texto || '').includes('anotado el día: *domingo 22 de noviembre*'), r.d.texto);
  check('DS-4b: la regla dominical sigue: marca de domingo especial puesta',
    conv.flow.datos.domingoEspecial === true, JSON.stringify(conv.flow.datos));
  check('DS-4c: la regla dominical sigue: el caso pasó al dueño (needsHuman)',
    conv.needsHuman === true, JSON.stringify(conv.needsHuman));
  r = turno(conv, '¿Qué día cae?'); conv = r.conv;
  check('DS-4d: la pregunta en el domingo también se responde («cae *domingo*»)',
    (r.d.texto || '').includes('El *22 de noviembre* cae *domingo*.'), r.d.texto);
}

// ---------------------------------------------------------------
// (5) DÍA SUELTO «el 20» y variante «¿cae en domingo?»
// ---------------------------------------------------------------
{
  let conv = hastaFecha('30000001005');
  let r = turno(conv, 'el 20'); conv = r.conv;
  check('DS-5a: «el 20» se confirma con su día de semana deducido',
    (r.d.texto || '').includes(`anotado el día: *${bot.fechaConDiaSemana('el 20', 'es')}*`),
    r.d.texto);
  r = turno(conv, '¿cae en domingo?'); conv = r.conv;
  check('DS-5b: «¿cae en domingo?» se responde con el día real de la fecha',
    (r.d.texto || '').includes(bot.lineaDiaSemana('el 20', 'es')), r.d.texto);
}

// ---------------------------------------------------------------
// (6) LA PREGUNTA A MITAD DE FLUJO EN OTRO PASO (el mix), con
// la fecha en el mismo mensaje: la fecha se captura libre, se
// confirma con su día, se responde la pregunta y se retoma
// el paso del mix.
// ---------------------------------------------------------------
{
  let conv = nuevaConv('30000001006', 'Cliente Día');
  let r = turno(conv, 'Hola, quiero cotizar concreto'); conv = r.conv;
  r = turno(conv, '10 yardas'); conv = r.conv;
  r = turno(conv, '¿Qué día cae el 20 de noviembre?'); conv = r.conv;
  check('DS-6a: la fecha del mensaje se capturó libre en el paso del mix',
    conv.flow.datos.fecha === '20 de noviembre', JSON.stringify(conv.flow.datos.fecha));
  check('DS-6b: se respondió el día de semana',
    (r.d.texto || '').includes(bot.lineaDiaSemana('20 de noviembre', 'es')), r.d.texto);
  check('DS-6c: se retomó la pregunta del paso actual (el mix)',
    (r.d.texto || '').includes('¿Qué mix o resistencia (PSI) necesita?'), r.d.texto);
}

// ---------------------------------------------------------------
// (7) SIN FECHA: en el paso del día, «¿Qué día cae?» sin
// ninguna fecha dada — el bot pide la fecha y vuelve a
// preguntar el día (no inventa ningún día de semana).
// ---------------------------------------------------------------
{
  let conv = hastaFecha('30000001007');
  let r = turno(conv, '¿Qué día cae?'); conv = r.conv;
  check('DS-7a: sin fecha capturada, pide la fecha',
    (r.d.texto || '').includes('Todavía no tengo el día de la entrega'), r.d.texto);
  check('DS-7b: y vuelve a preguntar el día del paso',
    (r.d.texto || '').includes('¿Para qué día lo necesita'), r.d.texto);
  check('DS-7c: ninguna fecha quedó guardada por la pregunta',
    conv.flow.datos.fecha === null, JSON.stringify(conv.flow.datos.fecha));
}

// ---------------------------------------------------------------
// (8) DETECTORES Y RESOLVEDOR (unidades): las formas de la
// pregunta en ES/EN entran; dar el día («domingo») o
// preguntar el horario de trabajo («¿qué días trabajan?») NO
// son la pregunta; un texto sin fecha resoluble se muestra
// tal cual y su línea es null.
// ---------------------------------------------------------------
{
  check('DS-8a: detector ES — «Que día cae ??»',
    bot.esPreguntaDiaSemana('Que día cae ??') === true);
  check('DS-8b: detector ES — «¿cae en domingo?»',
    bot.esPreguntaDiaSemana('¿cae en domingo?') === true);
  check('DS-8c: detector EN — «what day does it fall on?»',
    bot.esPreguntaDiaSemana('what day does it fall on?') === true);
  check('DS-8d: dar el día («domingo») NO es la pregunta',
    bot.esPreguntaDiaSemana('domingo') === false);
  check('DS-8e: «¿qué días trabajan?» NO es la pregunta',
    bot.esPreguntaDiaSemana('¿qué días trabajan?') === false);
  check('DS-8f: texto sin fecha resoluble se muestra tal cual',
    bot.fechaConDiaSemana('la próxima semana', 'es') === 'la próxima semana');
  check('DS-8g: y su línea de respuesta es null (se pide la fecha)',
    bot.lineaDiaSemana('la próxima semana', 'es') === null);
  check('DS-8h: el resolvedor deduce el día suelto (mismo día que la fecha completa)',
    bot.resolverFechaMs('el 20') === bot.resolverFechaMs('20 de noviembre'));
}

/** Orden completa de Dallas (5000 psi) hasta el paso del pago. */
function ordenHastaPago(waId, pasosPompa) {
  let conv = nuevaConv(waId, 'Cliente Cierre');
  let r;
  const pasos = ['Hola, necesito concreto', '7 yds', '5000 psi', 'No aire', ...pasosPompa,
    '3069 forest ln Dallas tx', '20 de noviembre', '7:00', 'Am', 'Jesús Morillo', 'No tengo'];
  for (const p of pasos) { r = turno(conv, p); conv = r.conv; }
  return { conv, r };
}

// ---------------------------------------------------------------
// (9) CIERRE Y PAGO (segunda orden del dueño, 2026-11-04): el
// resumen trae el día de semana en la línea «Día:» y NINGÚN
// cierre anuncia «pago por adelantado» como regla general —
// la única instrucción de pagar antes de cargar es la de
// Zelle al elegirlo. (Antes el resumen mostrado ANTES de
// preguntar el método ya traía la línea universal.)
// ---------------------------------------------------------------
{
  const { conv, r } = ordenHastaPago('30000001009', ['No']);
  check('CP-1: la línea «Día:» del resumen lleva el día de semana',
    (r.d.texto || '').includes(`• Día: ${bot.fechaConDiaSemana('20 de noviembre', 'es')} — 7:00 am`),
    r.d.texto);
  check('CP-2: el resumen previo a la pregunta del método NO anuncia pago por adelantado',
    !(r.d.texto || '').includes('por adelantado'), r.d.texto);
  const rr = turno(conv, 'Efectivo');
  check('CP-3: cierre con EFECTIVO: sin «por adelantado» y sin exigencia de pagar antes de cargar',
    !(rr.d.texto || '').includes('por adelantado') &&
    !(rr.d.texto || '').includes('antes de que carguemos') &&
    (rr.d.texto || '').includes('pago en *Efectivo*'), rr.d.texto);
}
{
  const { conv } = ordenHastaPago('30000001010', ['No']);
  const rr = turno(conv, 'Zelle');
  check('CP-4: cierre con ZELLE: SÍ trae la instrucción de enviarlo ANTES de cargar, al correo de JMP',
    (rr.d.texto || '').includes('antes* de que carguemos el concreto') &&
    (rr.d.texto || '').includes('Jmpconcreteanddispatchllc@gmail.com') &&
    (rr.d.texto || '').includes('confirmación de la transferencia'), rr.d.texto);
  check('CP-5: cierre con ZELLE: tampoco trae la línea universal «El pago es por adelantado»',
    !(rr.d.texto || '').includes('El pago es por adelantado'), rr.d.texto);
}
{
  let conv = hastaFecha('30000001011');
  const r = turno(conv, '¿Tengo que pagar por adelantado?');
  check('CP-6: la pregunta por el momento del pago se responde con el modelo final (solo Zelle va antes)',
    (r.d.texto || '').includes('Solo el pago por *Zelle* se envía antes de cargar') &&
    !(r.d.texto || '').includes('El pago es por adelantado: en cuanto'), r.d.texto);
}
{
  // EN: la línea «Day:» del resumen también lleva el día de semana.
  let conv = nuevaConv('30000001012', 'Client Closing');
  let r;
  const pasos = ['Hi, I need concrete', '7 yds', '5000 psi', 'No air', 'No',
    '3069 forest ln Dallas tx', 'November 20', '7:00', 'Am', 'John Smith', 'None'];
  for (const p of pasos) { r = turno(conv, p); conv = r.conv; }
  check('CP-7: EN — la línea «Day:» del resumen lleva el día de semana y no hay «in advance»',
    (r.d.texto || '').includes(`• Day: ${bot.fechaConDiaSemana('November 20', 'en')} — 7:00 am`) &&
    !(r.d.texto || '').includes('Payment is in advance'), r.d.texto);
}

// ---------------------------------------------------------------
// (10) TRAILER PUMP → MIX «Trailer pump mix 50-50» (tercera
// orden del dueño, 2026-11-04): al elegir Small line /
// Trailer pump, el mix de la orden pasa a ser ese, en el
// flujo y en el resumen. ACTUALIZADO con la aclaración del
// dueño del 2026-11-04 («cuando yo vendo cemento no busco
// pump, solo pregunto para saber el mix que se va a usar»):
// la pompa NO es un servicio de JMP — solo define el mix —
// y la orden cierra CON total (base + $5/yd, con taxes).
// ---------------------------------------------------------------
{
  const { conv, r } = ordenHastaPago('30000001013', ['Sí', 'Tráiler']);
  check('TP-1: con trailer pump, el mix guardado es «Trailer pump mix 50-50»',
    conv.flow.datos.mix === 'Trailer pump mix 50-50' &&
    conv.flow.datos.pompa === 'Small line / Trailer pump',
    JSON.stringify(conv.flow.datos));
  check('TP-2: el resumen muestra «Mix: Trailer pump mix 50-50» y ya no el psi pedido',
    (r.d.texto || '').includes('• Mix: Trailer pump mix 50-50') &&
    !(r.d.texto || '').includes('5000 psi'), r.d.texto);
  const rr = turno(conv, 'Efectivo');
  check('TP-3: la confirmación armada trae el mix trailer y la orden cierra CON total ((180+5)×7×1.0825 = $1,401.84)',
    (rr.d.confirmacionArmada || '').includes('Trailer pump mix 50-50') &&
    (rr.d.confirmacionArmada || '').includes('Total: $1,401.84'), rr.d.confirmacionArmada);
}
{
  // Captura libre: el trailer pump mencionado en un solo
  // mensaje con todo lo demás también cambia el mix, y la
  // confirmación de ese mismo turno ya lo refleja.
  let conv = nuevaConv('30000001014', 'Cliente Libre');
  const r = turno(conv, 'Hola, necesito 7 yardas de 5000 psi sin aire, con trailer pump, en 3069 forest ln Dallas tx, el 20 de noviembre a las 7 am');
  check('TP-4: captura libre con trailer pump: el mix queda «Trailer pump mix 50-50»',
    r.conv.flow.datos.mix === 'Trailer pump mix 50-50', JSON.stringify(r.conv.flow.datos));
  check('TP-5: la confirmación del mismo turno ya dice el mix trailer (sin discurso extra)',
    (r.d.texto || '').includes('anotado el mix: *Trailer pump mix 50-50*'), r.d.texto);
}

// ---------------------------------------------------------------
// (11) BOOM PUMP Y SIN POMPA: el mix psi se CONSERVA.
// ---------------------------------------------------------------
{
  const { conv } = ordenHastaPago('30000001015', ['Sí', 'Boom']);
  check('TP-6: con BOOM pump el mix sigue siendo el psi pedido (5000 psi)',
    conv.flow.datos.mix === '5000 psi' && conv.flow.datos.pompa === 'Boom pump',
    JSON.stringify(conv.flow.datos));
  const rr = turno(conv, 'Efectivo');
  check('TP-7: la armada con boom trae «5000 psi … (Boom pump)»',
    (rr.d.confirmacionArmada || '').includes('5000 psi') &&
    (rr.d.confirmacionArmada || '').includes('(Boom pump)'), rr.d.confirmacionArmada);
}
{
  const { conv } = ordenHastaPago('30000001016', ['No']);
  check('TP-8: SIN pompa el mix sigue siendo el psi pedido (5000 psi)',
    conv.flow.datos.mix === '5000 psi' && conv.flow.datos.pompa === 'Sin pompa',
    JSON.stringify(conv.flow.datos));
}

console.log('');
if (fallos.length) {
  console.log(`dia-semana: ${ok}/${total}`);
  for (const f of fallos) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`dia-semana: ${ok}/${total}`);
