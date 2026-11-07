// ============================================================
// FORMULARIO WEB → WHATSAPP (falla real del 2026-11-07 07:26):
// Jesus probó el formulario de órdenes de jmpconcreteanddispatch
// .com, que manda por WhatsApp un mensaje ya lleno con campos
// etiquetados, y el asistente respondió «¡Claro! Sí llegamos a
// Dallas 🏗️ ¿Cuántas yardas necesita?» — volvió a preguntar
// las yardas que YA venían en el mensaje. Causas corregidas:
//  1. La rama de cobertura sin flujo (y la omisión de captura
//     con ciudad dentro del flujo) descartaban el mensaje
//     entero: «entrega» + la ciudad de la dirección lo hacían
//     «sonar» a pregunta de cobertura y NINGÚN dato se miraba.
//     Ahora el volcado con formatos cerrados se rescata siempre
//     (captura sin paso) y la cobertura se confirma igual.
//  2. Las yardas ETIQUETADAS («Yardas necesarias: 10») no las
//     reconocía ningún patrón (todos buscan «10 yardas»).
//  3. La fecha ISO («2026-11-09») no la reconocía ningún patrón
//     (solo «11/9/2026», «9 de noviembre» o relativas).
//  4. El nombre ETIQUETADO («Nombre: …») no lo reconocía la
//     captura adelantada (exigía «soy…» / «mi nombre es…»).
//  5. El patrón «número + yardas» cruzaba el salto de línea con
//     \s y robaba el ZIP de la línea de la dirección como si
//     fueran las yardas («75228 yardas»): ahora el hueco es
//     [ \t], como ya se había corregido en el slump.
//  6. La línea del saludo («Hola JMP Concrete & Dispatch…»)
//     quedaba anotada como la COMPAÑÍA por la palabra «Concrete»:
//     una línea que abre con saludo es una frase, no un nombre.
//  7. (2026-11-07, sección propia de PSI en el sitio) La línea
//     etiquetada «PSI: 4000» no la rescataba ningún patrón y el
//     hueco \s* robaba el número de la línea anterior como psi:
//     la etiqueta manda (anclada a línea) y el hueco es [ \t].
// Regla que queda: un dato ya dado en el mensaje — etiquetado o
// suelto, en cualquier orden — NUNCA se vuelve a preguntar; la
// siguiente pregunta es solo el primer dato que falte.
// Correr: node tests/formulario-web.test.js
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jmp-webform-test-'));
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

// El mensaje EXACTO que manda el formulario de la web (copia
// literal de la prueba real de Jesus, 2026-11-07 07:26 CST).
const MENSAJE_FORMULARIO = `Hola JMP Concrete & Dispatch, necesito una entrega de concreto.
Nombre: Jesus morillo
Teléfono: 7863662018
Dirección: 3113 santa Anna ave dallas tx 75228
Yardas necesarias: 10
Fecha de entrega: 2026-11-09`;

// ---------- 1. El formulario web, tal cual ----------
{
  let conv = db.upsertConversation('17863662018', 'Jesus morillo');
  const r = turno(conv, MENSAJE_FORMULARIO);
  conv = r.conv;
  const datos = conv.flow.datos;
  check('formulario: NO vuelve a preguntar las yardas',
    !(r.d.texto || '').includes('¿Cuántas yardas necesita?'), r.d.texto);
  check('formulario: yardas etiquetadas capturadas (10)',
    datos.yardas && datos.yardas.cantidad === '10', JSON.stringify(datos.yardas));
  check('formulario: dirección capturada completa',
    (datos.direccion || '').includes('3113 santa Anna ave dallas tx 75228'), datos.direccion);
  check('formulario: fecha ISO capturada y guardada resoluble (11/9/2026)',
    datos.fecha === '11/9/2026', datos.fecha);
  check('formulario: nombre etiquetado capturado',
    datos.nombre === 'Jesus morillo', datos.nombre);
  check('formulario: la frase del saludo NO quedó como compañía',
    datos.compania === null, datos.compania);
  check('formulario: la cobertura de Dallas se confirma igual',
    (r.d.texto || '').includes('Sí llegamos a *Dallas*'), r.d.texto);
  check('formulario: la siguiente pregunta es solo el mix (primer dato que falta)',
    (r.d.texto || '').includes('mix o resistencia (PSI)'), r.d.texto);

  // La conversación sigue: solo se pregunta lo que falta
  // (mix → hora → compañía → pago) y la orden cierra con el
  // total de Dallas correcto (10 yds × $170 del 4000 psi,
  // + 8.25% de taxes = $1,840.25).
  let r2 = turno(conv, '4000 psi, con aire, sin pompa'); conv = r2.conv;
  check('formulario+mix: sigue a la hora (no repite dirección/fecha/nombre)',
    (r2.d.texto || '').includes('¿A qué hora lo necesita'), r2.d.texto);
  let r3 = turno(conv, '7 am'); conv = r3.conv;
  check('formulario+hora: sigue a la compañía',
    (r3.d.texto || '').includes('nombre de su compañía'), r3.d.texto);
  let r4 = turno(conv, 'No tengo'); conv = r4.conv;
  check('formulario+compañía: la orden se arma con el total $1,840.25',
    (r4.d.texto || '').includes('Total: $1,840.25'), r4.d.texto);
  let r5 = turno(conv, 'Zelle'); conv = r5.conv;
  check('formulario+pago: cierra con número de orden y resumen interno armado',
    !!r5.d.confirmacionArmada && (r5.d.confirmacionArmada || '').includes('Total: $1,840.25'),
    r5.d.confirmacionArmada || r5.d.texto);
}

// ---------- 2. El mismo formulario en inglés ----------
{
  let conv = db.upsertConversation('12145550134', 'John Smith');
  const msg = `Hello JMP Concrete & Dispatch, I need a concrete delivery.
Name: John Smith
Phone: 2145550134
Address: 4500 Main St, Dallas, TX 75201
Yards needed: 12
Delivery date: 2026-11-10`;
  const r = turno(conv, msg);
  conv = r.conv;
  const datos = conv.flow.datos;
  check('EN form: does NOT ask the yards again',
    !(r.d.texto || '').includes('How many yards do you need?'), r.d.texto);
  check('EN form: labeled yards captured (12)',
    datos.yardas && datos.yardas.cantidad === '12', JSON.stringify(datos.yardas));
  check('EN form: labeled name captured',
    datos.nombre === 'John Smith', datos.nombre);
  check('EN form: ISO date captured (11/10/2026)',
    datos.fecha === '11/10/2026', datos.fecha);
  check('EN form: address captured',
    (datos.direccion || '').includes('4500 Main St'), datos.direccion);
  check('EN form: next question is the mix, in English',
    (r.d.texto || '').includes('mix or strength (PSI)'), r.d.texto);
}

// ---------- 3. Todo en uno, en desorden y sin etiquetas ----------
// (La regla del 2026-10-31 sigue viva: el cliente suelta todo
// en un mensaje y en cualquier orden; nada se re-pregunta.)
{
  let conv = db.upsertConversation('14695550199', 'Jesus Morillo');
  const r = turno(conv,
    'Hola, necesito 10 yardas de 4000 psi para el 9 de noviembre en 3113 Santa Anna Ave, Dallas TX 75228. Soy Jesus Morillo');
  conv = r.conv;
  const datos = conv.flow.datos;
  check('desorden: no re-pregunta yardas',
    !(r.d.texto || '').includes('¿Cuántas yardas necesita?'), r.d.texto);
  check('desorden: yardas 10', datos.yardas && datos.yardas.cantidad === '10',
    JSON.stringify(datos.yardas));
  check('desorden: mix 4000 psi', (datos.mix || '').includes('4000'), datos.mix);
  check('desorden: fecha «9 de noviembre»', datos.fecha === '9 de noviembre', datos.fecha);
  check('desorden: nombre tras «Soy»', datos.nombre === 'Jesus Morillo', datos.nombre);
  check('desorden: dirección capturada', (datos.direccion || '').includes('3113 Santa Anna'),
    datos.direccion);
}

// ---------- 4. Unidades: el ZIP jamás se roba como yardas ----------
{
  const d1 = bot.extraerDatos(
    'Dirección: 3113 santa Anna ave dallas tx 75228\nYardas necesarias: 10', null);
  check('unidad: con etiqueta, las yardas son 10 y no el ZIP 75228',
    d1.yardas && d1.yardas.cantidad === '10', JSON.stringify(d1.yardas));
  const d2 = bot.extraerDatos('La dirección es 4215 N Beltwood Dallas TX 75228\nyardas', null);
  check('unidad: el ZIP al final de una línea no alimenta las yardas de la siguiente',
    !d2.yardas, JSON.stringify(d2.yardas));
  const d3 = bot.extraerDatos('Yardas: 8', null);
  check('unidad: «Yardas: 8» a secas también se captura',
    d3.yardas && d3.yardas.cantidad === '8', JSON.stringify(d3.yardas));
  const d4 = bot.extraerDatos('Fecha de entrega: 11-09-2026', null);
  check('unidad: fecha con guiones M-D-A también se captura (11/9/2026)',
    d4.fecha === '11/9/2026', d4.fecha);
  const d5 = bot.extraerDatos('Fecha de entrega: 2026-02-30', null);
  check('unidad: ISO imposible (30 de febrero) se marca inválida y NO se guarda',
    !!d5.fechaInvalida && !d5.fecha, JSON.stringify(d5));
}

// ---------- 5. La pregunta de cobertura pura sigue intacta ----------
{
  let conv = db.upsertConversation('16825550100', 'Cobertura');
  const r = turno(conv, '¿Llegan a Dallas?');
  conv = r.conv;
  check('cobertura pura: respuesta exacta de siempre',
    r.d.texto === '¡Claro! Sí llegamos a *Dallas* 🏗️\n¿Cuántas yardas necesita?',
    r.d.texto);
  check('cobertura pura: el flujo abre vacío (ningún dato inventado)',
    conv.flow && conv.flow.datos.yardas === null && conv.flow.datos.direccion === null,
    JSON.stringify(conv.flow && conv.flow.datos));
}

// ---------- 7. El formulario CON su sección de PSI (2026-11-07) ----------
// El sitio agregó la sección propia «Resistencia del concreto
// (PSI)»: el mensaje trae la línea etiquetada «PSI: 4000» entre
// las yardas y la fecha. Antes NINGÚN patrón la rescataba (todos
// buscan «4000 psi», número antes que la palabra) y, peor, el
// hueco \s* del patrón «número + psi» cruzaba el salto de línea
// y robaba el número del final de la línea anterior: «Yardas
// necesarias: 100\nPSI: 4000» marcaba «100» como psi inválido
// y las yardas se perdían. Ahora la etiqueta manda (anclada a
// línea) y el hueco es [ \t], como en yardas y en el slump.
{
  let conv = db.upsertConversation('12145550177', 'Jesus morillo');
  const msg = `Hola JMP Concrete & Dispatch, necesito una entrega de concreto.
Nombre: Jesus morillo
Teléfono: 7863662018
Dirección: 3113 santa Anna ave dallas tx 75228
Yardas necesarias: 10
PSI: 4000
Fecha de entrega: 2026-11-25`;
  const r = turno(conv, msg);
  conv = r.conv;
  const datos = conv.flow.datos;
  check('formulario+PSI: el mix etiquetado se anota (4000 psi)',
    datos.mix === '4000 psi', datos.mix);
  check('formulario+PSI: NO vuelve a preguntar la resistencia',
    !(r.d.texto || '').includes('mix o resistencia (PSI)'), r.d.texto);
  check('formulario+PSI: las yardas quedan intactas (10, no psi inválido)',
    datos.yardas && datos.yardas.cantidad === '10', JSON.stringify(datos.yardas));
  check('formulario+PSI: sigue con el aire (lo único del mix que falta)',
    (r.d.texto || '').includes('¿Y el concreto va con aire o no aire?'), r.d.texto);
  let r2 = turno(conv, 'Sin pompa, sin aire'); conv = r2.conv;
  check('formulario+PSI: sigue a la hora', (r2.d.texto || '').includes('¿A qué hora lo necesita'),
    r2.d.texto);
  let r3 = turno(conv, '7 am'); conv = r3.conv;
  let r4 = turno(conv, 'No tengo'); conv = r4.conv;
  check('formulario+PSI: la orden cierra con el total del 4000 ($1,840.25)',
    (r4.d.texto || '').includes('Total: $1,840.25'), r4.d.texto);
  let r5 = turno(conv, 'Zelle'); conv = r5.conv;
  check('formulario+PSI: confirmación interna con el mix 4000 psi',
    !!r5.d.confirmacionArmada && (r5.d.confirmacionArmada || '').includes('4000 psi'),
    r5.d.confirmacionArmada || r5.d.texto);

  // Unidades de la etiqueta PSI
  const u1 = bot.extraerDatos('Yardas necesarias: 100\nPSI: 4000', null);
  check('unidad PSI: la línea anterior NO se roba como psi (mix 4000, yardas 100)',
    u1.mix === '4000 psi' && u1.yardas && u1.yardas.cantidad === '100' && !u1.psiInvalido,
    JSON.stringify(u1));
  const u2 = bot.extraerDatos('Dirección: 3113 santa Anna ave dallas tx 75228\nPSI: 3500', null);
  check('unidad PSI: el ZIP no se roba como psi (mix 3500)',
    u2.mix === '3500 psi' && !u2.psiInvalido, JSON.stringify(u2));
  const u3 = bot.extraerDatos('Yardas necesarias: 10\nPSI: 2500', null);
  check('unidad PSI: un PSI etiquetado que no existe se marca inválido (2500)',
    !u3.mix && u3.psiInvalido === '2500' && u3.yardas && u3.yardas.cantidad === '10',
    JSON.stringify(u3));
  const u4 = bot.extraerDatos('Yardas necesarias: 10\nPSI: No lo sé', null);
  check('unidad PSI: «No lo sé» no anota mix ni marca inválido (se pregunta)',
    !u4.mix && !u4.psiInvalido, JSON.stringify(u4));
  const u5 = bot.extraerDatos('Resistencia: 4500', null);
  check('unidad PSI: la etiqueta «Resistencia:» también se rescata (4500 psi)',
    u5.mix === '4500 psi', JSON.stringify(u5));
}

// ---------- 8. Cobertura + datos sueltos en el mismo mensaje ----------
{
  let conv = db.upsertConversation('16825550101', 'Cobertura Datos');
  const r = turno(conv, '¿Llegan a Dallas? Necesito 10 yardas');
  conv = r.conv;
  check('cobertura+datos: las 10 yardas se anotan y no se re-preguntan',
    conv.flow.datos.yardas && conv.flow.datos.yardas.cantidad === '10' &&
    !(r.d.texto || '').includes('¿Cuántas yardas necesita?'), r.d.texto);
  check('cobertura+datos: la cobertura se confirma y se sigue con el mix',
    (r.d.texto || '').includes('Sí llegamos a *Dallas*') &&
    (r.d.texto || '').includes('mix o resistencia (PSI)'), r.d.texto);
}

console.log(`\nformulario-web: ${ok}/${total}`);
if (fallos.length) {
  console.log('FALLOS:');
  for (const f of fallos) console.log(` - ${f}`);
  process.exit(1);
}
