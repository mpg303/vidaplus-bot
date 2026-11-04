// ============================================================
// Precio POR YARDA preguntado a mitad del flujo / en el paso
// del PAGO (falla real 2026-11-03 21:19, captura de Jesus):
// con la orden ya cerrada (7 yds, mix 3000 psi, dirección
// «3069 forest ln Dallas tx», total $1,212.40 mostrado) Jesus
// preguntó «Cuánto sale por la yarda ?» y el bot evadió con la
// línea genérica «El precio depende de la dirección del trabajo
// y del mix. Con los datos de su orden se lo confirmamos
// enseguida.» + prefijo «Continuamos con su pedido» y repitió
// la pregunta de pago. REGLA: si la orden ya trae mix y
// dirección de Dallas, el precio por yarda SE CONOCE (tabla
// verificada del dueño) y se responde concreto ($160 el 3000
// psi, más taxes del 8.25%); después se retoma UNA sola vez la
// pregunta del paso, sin prefijo de continuación y sin el
// «se lo confirmamos enseguida». Sin mix o sin Dallas (o con
// Pompa mix 50-50 / servicio de pompa, sin precio automático),
// sigue la línea genérica: jamás un número inventado.
//
// RONDA «DAME PRECIO» CON POMPA (falla real 2026-11-04 01:16):
// con la orden ya registrada con TRAILER PUMP (mix 5000 psi
// convertido a «Trailer pump mix 50-50» por la regla de sync
// 49), Jesus escribió «Dame precio» en el paso del pago y el
// bot evadió OTRA VEZ con la línea genérica. Causa raíz: (1)
// precioYardaDeLaOrden anulaba la cifra ante CUALQUIER pompa
// — confundía el SERVICIO de pompa (sin precio: la orden
// cierra sin total) con el precio del CONCRETO por yarda, que
// sí se conoce; (2) la conversión a «Trailer pump mix 50-50»
// descartaba el psi base. Arreglo: la conversión guarda el
// psi base en datos.mixBase (y lo actualiza si el cliente
// corrige el psi); el precio por yarda con trailer es
// base + $5 (el pompa mix) CON su desglose; con boom es el
// psi tal cual; con pompa la línea aclara que el costo del
// SERVICIO lo confirma el especialista y la orden sigue
// cerrando SIN total. La pregunta genérica de precio («Dame
// precio») va concreta en cualquier paso si mix + Dallas ya
// venían de turnos anteriores; el turno que trae el volcado
// de datos conserva la línea genérica aprobada. «Pompa mix
// 50-50» pedida como mix (sin psi base) sigue sin cifra.
// Correr: node tests/precio-yarda-pago.test.js
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jmp-precio-test-'));
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
const PREFIJOS = ['Continuamos con su pedido', 'Sigamos con su pedido', 'Seguimos con su pedido', 'Vamos con su pedido'];
const sinPrefijo = (t) => !PREFIJOS.some((p) => (t || '').includes(p));
const veces = (t, s) => ((t || '').split(s).length - 1);

// Orden completa de Dallas hasta el paso del pago (el guion
// exacto de la captura de Jesus del 2026-11-03 21:16–21:19).
function hastaPagoDallas(waId) {
  let conv = nuevaConv(waId, 'Cliente Precio Pago');
  let r;
  for (const paso of ['Hola, necesito concreto', '7 yds', '3000 psi', 'Aire', 'No',
    '3069 forest ln Dallas tx', 'Mañana', '10:00', 'Am', 'Jesús Morillo', 'No tengo']) {
    r = turno(conv, paso); conv = r.conv;
  }
  return { conv, ultimo: r.d.texto || '' };
}

{
  const { conv, ultimo } = hastaPagoDallas('40000000001');
  check('Guion captura: la orden se mostró con su total ($1,212.40 = 7 × $160 + 8.25%)',
    ultimo.includes('$1,212.40') && ultimo.includes('¿Cómo va a pagar'), ultimo);
  check('Guion captura: el flujo quedó en el paso del pago (ordenMostrada)',
    !!conv.flow && conv.flow.ordenMostrada === true && !conv.flow.datos.pago,
    JSON.stringify(conv.flow && conv.flow.datos));
  const r = turno(conv, 'Cuánto sale por la yarda ?');
  const texto = r.d.texto || '';
  check('Precio en pago: responde el precio CONCRETO por yarda de SU mix ($160.00, 3000 psi)',
    texto.includes('$160.00') && texto.includes('3000 psi'), texto);
  check('Precio en pago: aclara los taxes del 8.25%',
    texto.includes('8.25%'), texto);
  check('Precio en pago: NUNCA la línea evasiva «se lo confirmamos enseguida»',
    !texto.includes('se lo confirmamos enseguida') && !texto.includes('El precio depende'), texto);
  check('Precio en pago: SIN prefijo «Continuamos con su pedido» ni sus variantes',
    sinPrefijo(texto), texto);
  check('Precio en pago: retoma la pregunta de pago UNA sola vez',
    veces(texto, '¿Cómo va a pagar') === 1, texto);
  check('Precio en pago: el flujo sigue en el pago (no se cerró ni se perdió)',
    !!r.conv.flow && !r.conv.flow.datos.pago, JSON.stringify(r.conv.flow && r.conv.flow.datos));
  // Y el pago sigue funcionando después de la pregunta:
  const r2 = turno(r.conv, 'Efectivo');
  check('Precio en pago: tras responder, el cliente paga y la orden cierra con número',
    (r2.d.texto || '').includes('número de orden') && !r2.conv.flow, r2.d.texto);
}
{
  // Variantes ES de la misma pregunta en el paso del pago.
  for (const [i, pregunta] of ['cuánto sale la yarda', '¿Cuánto cuesta por yarda?', '¿cuánto vale la yarda?'].entries()) {
    const { conv } = hastaPagoDallas(`4000000001${i}`);
    const r = turno(conv, pregunta);
    check(`Variante ES «${pregunta}»: precio concreto $160.00 sin evasiva`,
      (r.d.texto || '').includes('$160.00') && !(r.d.texto || '').includes('se lo confirmamos enseguida'),
      r.d.texto);
  }
}
{
  // Pregunta genérica de precio YA en el paso del pago: también
  // se responde el precio por yarda de su mix (la orden está
  // completa; evadir ahí es la falla reportada).
  const { conv } = hastaPagoDallas('40000000020');
  const r = turno(conv, '¿Cuánto sale?');
  check('Precio genérico en pago: responde el precio por yarda de su mix',
    (r.d.texto || '').includes('$160.00') && sinPrefijo(r.d.texto || ''), r.d.texto);
}
{
  // EN: flujo completo en inglés, «What's the price per yard?»
  let conv = nuevaConv('40000000021', 'Price Client');
  let r;
  for (const paso of ['Hello, I need concrete', '7 yards', '3000 psi', 'with air', 'no',
    '3069 Forest Ln Dallas TX', 'tomorrow', '10:00', 'am', 'John Smith', 'no company']) {
    r = turno(conv, paso); conv = r.conv;
  }
  r = turno(conv, "What's the price per yard?");
  const texto = r.d.texto || '';
  check('EN per yard: concrete price $160.00 for his mix, in English',
    texto.includes('$160.00') && /per yard/i.test(texto) && texto.includes('3000 psi'), texto);
  check('EN per yard: payment question retaken once, no generic line',
    veces(texto, 'How will you pay') === 1 && !texto.includes('confirm it right away'), texto);
}
{
  // A mitad del flujo, YA con mix y dirección de Dallas (paso
  // de la fecha): la pregunta por yarda también va concreta.
  let conv = nuevaConv('40000000022', 'Cliente Precio Mitad');
  let r;
  for (const paso of ['Hola, necesito concreto', '7 yds', '3000 psi', 'Aire', 'No', '3069 forest ln Dallas tx']) {
    r = turno(conv, paso); conv = r.conv;
  }
  r = turno(conv, 'cuánto cuesta la yarda');
  const texto = r.d.texto || '';
  check('Precio a mitad (con dirección): concreto $160.00 y retoma el paso (el día)',
    texto.includes('$160.00') && texto.includes('¿Para qué día'), texto);
}
{
  // A mitad del flujo SIN dirección todavía: no hay número que
  // dar — línea genérica de siempre.
  let conv = nuevaConv('40000000023', 'Cliente Precio Sin Datos');
  let r;
  for (const paso of ['Hola, necesito concreto', '7 yds', '3000 psi']) {
    r = turno(conv, paso); conv = r.conv;
  }
  r = turno(conv, 'Cuánto sale por la yarda ?');
  const texto = r.d.texto || '';
  check('Precio sin dirección: línea genérica, SIN cifra inventada',
    texto.includes('El precio depende de la dirección del trabajo y del mix') && !/\$\d/.test(texto), texto);
}
{
  // Fuera de Dallas NO hay precio publicable: línea genérica.
  let conv = nuevaConv('40000000024', 'Cliente Precio Fort Worth');
  let r;
  for (const paso of ['Hola, necesito concreto', '7 yds', '3000 psi', 'Aire', 'No',
    '100 Main St Fort Worth Tx', 'Mañana', '10:00', 'Am', 'Juan Perez', 'No tengo']) {
    r = turno(conv, paso); conv = r.conv;
  }
  r = turno(conv, 'Cuánto sale por la yarda ?');
  const texto = r.d.texto || '';
  check('Precio fuera de Dallas: línea genérica, SIN $160 inventado',
    texto.includes('El precio depende de la dirección del trabajo y del mix') && !texto.includes('$160'), texto);
}
{
  // Pompa mix 50-50: sin precio automático (lo confirma el
  // equipo, como su total) — no se inventa el +$5 ni otra cifra.
  let conv = nuevaConv('40000000025', 'Cliente Precio Pompa Mix');
  let r;
  for (const paso of ['Hola, necesito concreto', '7 yds', 'pompa mix 50-50', 'Aire', 'No',
    '3069 forest ln Dallas tx', 'Mañana', '10:00', 'Am', 'Juan Perez', 'No tengo']) {
    r = turno(conv, paso); conv = r.conv;
  }
  r = turno(conv, 'Cuánto sale por la yarda ?');
  const texto = r.d.texto || '';
  check('Precio Pompa mix 50-50: línea genérica, SIN cifra inventada',
    texto.includes('El precio depende de la dirección del trabajo y del mix') && !/\$1[5-9]\d/.test(texto), texto);
}
{
  // Cotizaciones en par (2 mixes) en Dallas, en el paso del
  // pago: se responden AMBOS precios por yarda.
  let conv = nuevaConv('40000000026', 'Cliente Precio Par');
  let r;
  for (const paso of ['Hola, necesito concreto', '10 yardas', 'Ocupo precio de 3,000 psi y otro de 3,500 psi',
    'con aire', 'no', '4215 N Beltwood Dallas Tx', 'Mañana', '10:00', 'Am', 'Juan Escalante', 'Vince Construction LLC']) {
    r = turno(conv, paso); conv = r.conv;
  }
  r = turno(conv, 'Cuánto sale por la yarda ?');
  const texto = r.d.texto || '';
  check('Precio en par: AMBOS precios por yarda ($160.00 del 3000 y $165.00 del 3500)',
    texto.includes('$160.00') && texto.includes('$165.00'), texto);
  check('Precio en par: retoma la pregunta de pago una sola vez',
    veces(texto, '¿Cómo va a pagar') === 1, texto);
}
{
  // Detectores exportados.
  check('Detector: «Cuánto sale por la yarda ?» es pregunta de precio por yarda',
    bot.esPreguntaPrecioPorYarda('Cuánto sale por la yarda ?') === true);
  check('Detector: «what\'s the price per yard» es pregunta de precio por yarda',
    bot.esPreguntaPrecioPorYarda("what's the price per yard") === true);
  check('Detector: «¿cuánto sale?» genérico NO es «por yarda»',
    bot.esPreguntaPrecioPorYarda('¿cuánto sale?') === false);
  check('Detector: «¿en cuánto llega el camión?» NO es precio por yarda',
    bot.esPreguntaPrecioPorYarda('¿en cuánto llega el camión?') === false);
}

// ============================================================
// RONDA «DAME PRECIO» CON POMPA (falla real 2026-11-04 01:16)
// ============================================================

// Orden completa de Dallas con TRAILER PUMP hasta el paso del
// pago (el guion de la captura de Jesus: 5000 psi convertido a
// «Trailer pump mix 50-50», pregunta de pago pendiente).
function hastaPagoTrailer(waId, psi = 5000) {
  let conv = nuevaConv(waId, 'Cliente Precio Trailer');
  let r;
  for (const paso of ['Hola, necesito concreto', '7 yds', `${psi} psi`, 'No aire', 'Sí', 'Tráiler',
    '3069 forest ln Dallas tx', '20 de noviembre', '7:00', 'Am', 'Jesús Morillo', 'No tengo']) {
    r = turno(conv, paso); conv = r.conv;
  }
  return { conv, ultimo: r.d.texto || '' };
}
const LINEA_TRAILER_5000 =
  '💰 El precio por yarda del *Trailer pump mix 50-50* en Dallas es de *$185.00* (el mix 5000 psi cuesta $180.00 y el pompa mix suma $5.00 por yarda), más los taxes del 8.25%. El costo del servicio de pompa se lo confirma el especialista.';
const PREGUNTA_PAGO = '¿Cómo va a pagar: efectivo, tarjeta de débito, tarjeta de crédito, Zelle o cheque?';

{
  const { conv } = hastaPagoTrailer('40000000030');
  check('Trailer captura: la conversión guardó el psi base en mixBase («5000 psi»)',
    conv.flow.datos.mix === 'Trailer pump mix 50-50' && conv.flow.datos.mixBase === '5000 psi',
    JSON.stringify(conv.flow.datos));
  const r = turno(conv, 'Dame precio');
  const texto = r.d.texto || '';
  check('Trailer captura: «Dame precio» responde el TEXTO EXACTO ($185.00 con desglose + pregunta de pago)',
    texto === `${LINEA_TRAILER_5000}\n${PREGUNTA_PAGO}`, texto);
  check('Trailer captura: el flujo sigue intacto en el paso del pago',
    !!r.conv.flow && !r.conv.flow.datos.pago && r.conv.flow.ordenMostrada === true,
    JSON.stringify(r.conv.flow && r.conv.flow.datos));
  const r2 = turno(r.conv, 'Efectivo');
  check('Trailer captura: tras «Efectivo» la orden cierra con número y SIN total (el servicio de pompa no tiene precio)',
    (r2.d.texto || '').includes('número de orden') && !r2.conv.flow &&
    !(r2.d.confirmacionArmada || '').includes('Total:'), r2.d.texto);
}
{
  // Trailer con cada psi restante: precio = base + $5, con su
  // desglose (la pregunta aquí es «por la yarda»).
  for (const [psi, base] of [[3000, 160], [3500, 165], [3600, 170], [4000, 170], [4500, 175]]) {
    const { conv } = hastaPagoTrailer(`4000000004${psi / 100}`, psi);
    const r = turno(conv, 'Cuánto sale por la yarda ?');
    const texto = r.d.texto || '';
    check(`Trailer ${psi} psi: precio $${base + 5}.00 (base $${base}.00 + $5 del pompa mix) con desglose`,
      texto.includes(`*$${base + 5}.00*`) && texto.includes(`el mix ${psi} psi cuesta $${base}.00`) &&
      texto.includes('El costo del servicio de pompa se lo confirma el especialista.'), texto);
  }
}
{
  // BOOM pump (4000 psi): el precio por yarda es el del psi
  // TAL CUAL ($170.00, sin el +$5 del pompa mix), con la
  // aclaración del servicio; la orden cierra sin total.
  let conv = nuevaConv('40000000050', 'Cliente Precio Boom');
  let r;
  for (const paso of ['Hola, necesito concreto', '7 yds', '4000 psi', 'No aire', 'Sí', 'Boom',
    '3069 forest ln Dallas tx', '20 de noviembre', '7:00', 'Am', 'Juan Perez', 'No tengo']) {
    r = turno(conv, paso); conv = r.conv;
  }
  r = turno(conv, 'Dame precio');
  const texto = r.d.texto || '';
  check('Boom: «Dame precio» da el psi tal cual ($170.00 del 4000 psi) + aclaración del servicio',
    texto.includes('del mix *4000 psi*') && texto.includes('$170.00') && !texto.includes('$175.00') &&
    texto.includes('El costo del servicio de pompa se lo confirma el especialista.'), texto);
  const r2 = turno(r.conv, 'Efectivo');
  check('Boom: la orden cierra con número y SIN total tras el pago',
    !r2.conv.flow && !(r2.d.confirmacionArmada || '').includes('Total:'), r2.d.confirmacionArmada);
}
{
  // «Pompa mix 50-50» pedida COMO MIX y trailer elegido
  // después: no hay psi base (mixBase null) — sin cifra.
  let conv = nuevaConv('40000000051', 'Cliente Pompa Mix Trailer');
  let r;
  for (const paso of ['Hola, necesito concreto', '7 yds', 'pompa mix 50-50', 'Aire', 'Sí', 'Tráiler',
    '3069 forest ln Dallas tx', 'Mañana', '10:00', 'Am', 'Juan Perez', 'No tengo']) {
    r = turno(conv, paso); conv = r.conv;
  }
  r = turno(conv, 'Dame precio');
  const texto = r.d.texto || '';
  check('Trailer sin psi base («Pompa mix 50-50» como mix): línea genérica, SIN cifra inventada',
    texto.includes('El precio depende de la dirección del trabajo y del mix') && !/\$\d/.test(texto), texto);
}
{
  // Trailer FUERA de Dallas: no hay precio publicable.
  let conv = nuevaConv('40000000052', 'Cliente Trailer Fort Worth');
  let r;
  for (const paso of ['Hola, necesito concreto', '7 yds', '5000 psi', 'No aire', 'Sí', 'Tráiler',
    '100 Main St Fort Worth Tx', 'Mañana', '10:00', 'Am', 'Juan Perez', 'No tengo']) {
    r = turno(conv, paso); conv = r.conv;
  }
  r = turno(conv, 'Dame precio');
  const texto = r.d.texto || '';
  check('Trailer fuera de Dallas: línea genérica, SIN $185 inventado',
    texto.includes('El precio depende de la dirección del trabajo y del mix') && !texto.includes('$185'), texto);
}
{
  // CORRECCIÓN del psi tras la conversión: mixBase se
  // actualiza y el precio responde con la base nueva.
  const { conv } = hastaPagoTrailer('40000000053');
  let r = turno(conv, 'Mejor 4000 psi');
  check('Corrección de psi: mixBase se actualiza a «4000 psi» (el mix sigue trailer)',
    r.conv.flow.datos.mixBase === '4000 psi' && r.conv.flow.datos.mix === 'Trailer pump mix 50-50',
    JSON.stringify(r.conv.flow.datos));
  r = turno(r.conv, 'Dame precio');
  const texto = r.d.texto || '';
  check('Corrección de psi: el precio pasa a $175.00 (base 4000 psi $170.00 + $5)',
    texto.includes('*$175.00*') && texto.includes('el mix 4000 psi cuesta $170.00'), texto);
}
{
  // Pregunta GENÉRICA a mitad del flujo con mix + Dallas ya
  // de turnos anteriores (paso de la fecha, sin pompa):
  // también va concreta y retoma el paso.
  let conv = nuevaConv('40000000054', 'Cliente Precio Mitad Generico');
  let r;
  for (const paso of ['Hola, necesito concreto', '7 yds', '3000 psi', 'Aire', 'No', '3069 forest ln Dallas tx']) {
    r = turno(conv, paso); conv = r.conv;
  }
  r = turno(conv, 'Dame precio');
  const texto = r.d.texto || '';
  check('«Dame precio» a mitad (mix + Dallas ya dados): concreto $160.00 y retoma el paso (el día)',
    texto.includes('$160.00') && texto.includes('¿Para qué día'), texto);
}
{
  // El turno que TRAE el volcado de datos (mix + dirección +
  // pregunta de precio en el mismo mensaje) conserva la
  // línea genérica aprobada; la cifra llega al turno
  // siguiente, cuando los datos ya venían de antes.
  let conv = nuevaConv('40000000055', 'Cliente Volcado Precio');
  let r = turno(conv, 'Hola, necesito concreto'); conv = r.conv;
  r = turno(conv, '7 yds'); conv = r.conv;
  r = turno(conv, '3000 psi con aire, no ocupo pompa, en 3069 forest ln Dallas tx, cuánto cuesta?');
  const texto = r.d.texto || '';
  check('Volcado de datos + precio en el mismo turno: línea genérica aprobada, SIN cifra',
    texto.includes('El precio depende de la dirección del trabajo y del mix') && !texto.includes('$160'), texto);
}
{
  // EN con trailer: «give me the price» en el paso del pago.
  let conv = nuevaConv('40000000056', 'Trailer Price Client');
  let r;
  for (const paso of ['Hello, I need concrete', '7 yards', '5000 psi', 'no air', 'yes', 'trailer',
    '3069 Forest Ln Dallas TX', 'tomorrow', '7:00', 'am', 'John Smith', 'no company']) {
    r = turno(conv, paso); conv = r.conv;
  }
  r = turno(conv, 'give me the price');
  const texto = r.d.texto || '';
  const lineaEN =
    '💰 The price per yard for the *Trailer pump mix 50-50* in Dallas is *$185.00* (the 5000 psi mix is $180.00 and the pump mix adds $5.00 per yard), plus 8.25% taxes. The pump service cost will be confirmed by the specialist.';
  check('EN trailer: «give me the price» responde el TEXTO EXACTO en inglés ($185.00 con desglose)',
    texto === `${lineaEN}\nHow will you pay: cash, debit card, credit card, Zelle or check?`, texto);
  check('EN trailer: sin la línea genérica EN y la pregunta de pago se retoma UNA sola vez',
    !texto.includes('Price depends on the job address') && veces(texto, 'How will you pay') === 1, texto);
}

console.log(`\nprecio-yarda-pago: ${ok}/${total}`);
if (fallos.length) {
  console.log('FALLOS:');
  for (const f of fallos) console.log(' -', f);
  process.exit(1);
}
