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

console.log(`\nprecio-yarda-pago: ${ok}/${total}`);
if (fallos.length) {
  console.log('FALLOS:');
  for (const f of fallos) console.log(' -', f);
  process.exit(1);
}
