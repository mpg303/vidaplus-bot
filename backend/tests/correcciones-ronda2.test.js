// ============================================================
// CORRECCIONES DE LA RONDA 2 DE PRUEBAS (clientes ficticios,
// 2026-11-04; subida aprobada por el dueño el 2026-11-04 21:51
// «Sube todas las correcciones a los dos bots»):
//  1. LA COMA EN LA DIRECCIÓN (J01–J04, J07; sondas D1–D4):
//     «1234 Main St, Dallas TX» guardaba solo la calle y la
//     orden cerraba SIN total. capturarDireccion rescata la
//     ciudad y el ZIP que quedaron tras la coma. Fuera de
//     Dallas (Fort Worth con coma) sigue SIN total inventado.
//  2. POMPA-SERVICIO (J08 + P3): verbos subjuntivos sin
//     pronombre pegado (consigan, busquen, traigan, manden,
//     renten, alquilen, ofrezcan, provean, contraten) en
//     esPidePompaServicio: «Necesito que ustedes me consigan
//     una pompa» pasa a humano; la respuesta-dato del mix
//     («voy a usar trailer pump») NO se contamina.
//  3. DOMINGO (J15): la frase de retomada «El especialista no
//     le contestó…» ya no abre el turno siguiente al aviso de
//     domingo cuando el flujo sigue por domingoEspecial (la
//     frase SIGUE viva para un despertar real sin ese flujo).
//  4. J16/J17: pedir el número personal de Jesus → negativa
//     amable con SOLO el WhatsApp del negocio (469) 746-9639,
//     jamás el (786) 366-2018; preguntar por un servicio ajeno
//     al concreto → respuesta corta «solo concreto», sin el
//     genérico «no le entendí» y sin inventar precio.
// Correr: node tests/correcciones-ronda2.test.js
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jmp-ronda2-test-'));
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
  const fresca = db.getConversation(conv.id) || conv;
  const d = bot.decidirRespuesta(fresca, texto);
  if (d.responder && d.texto) {
    db.addMessage({
      conversationId: conv.id,
      waId: conv.waId,
      sender: 'BOT',
      text: d.texto,
      flags: { intent: d.intent, auto: true },
    });
  }
  const post = db.getConversation(conv.id) || conv;
  // Foto del estado AL CIERRE DEL TURNO: la conversación es un
  // objeto compartido y al cerrar la orden su flow se anula —
  // sin esta copia, los checks leerían el estado final en vez
  // del de este turno. needsHuman viaja en el estado de la
  // conversación (db), no en la decisión.
  return {
    d,
    conv: post,
    datos: post.flow && post.flow.datos ? JSON.parse(JSON.stringify(post.flow.datos)) : null,
    needsHumanConv: post.needsHuman === true,
  };
}

let n = 0;
function correr(script, nombre = 'Cliente Ronda2') {
  const waId = '15551700' + String(++n).padStart(3, '0');
  let conv = db.upsertConversation(waId, nombre);
  const turnos = [];
  for (const paso of script) {
    const r = turno(conv, paso);
    conv = r.conv;
    turnos.push(r);
  }
  return { turnos, conv };
}
const textosDe = (turnos) => turnos.map((t) => t.d.texto || '');

// ---------- 1. LA COMA EN LA DIRECCIÓN ----------
// J01: 3000 sin aire, 10 yds, «1234 Main St, Dallas TX» → $1,732.00
{
  const { turnos } = correr(['Hola, necesito concreto', '10 yardas', '3000 psi', 'Sin aire', 'No pompa',
    '1234 Main St, Dallas TX', 'Mañana', '10:00', 'Am', 'Carlos Ruiz', 'No tengo', 'Efectivo']);
  const resumen = turnos[turnos.length - 2].d.texto || '';
  const cierre = turnos[turnos.length - 1].d.texto || '';
  check('J01 resumen con total $1,732.00 (coma)', resumen.includes('$1,732.00'), resumen.slice(0, 140));
  check('J01 cierre con número de orden', cierre.includes('número de orden'));
  check('J01 dirección guardada conserva Dallas',
    !!(turnos[5].datos && /Dallas/.test(turnos[5].datos.direccion || '')),
    turnos[5].datos ? turnos[5].datos.direccion : 'sin datos en el turno');
}
// J02: 4000 con aire, 6 yds, «789 Pine St, Dallas TX» → $1,104.15
{
  const { turnos } = correr(['Hola, necesito concreto', '6 yardas', '4000 psi', 'Con aire', 'No pompa',
    '789 Pine St, Dallas TX', 'Mañana', '11:00', 'Am', 'Luis Peña', 'No tengo', 'Efectivo']);
  const resumen = turnos[turnos.length - 2].d.texto || '';
  check('J02 resumen con total $1,104.15 (coma)', resumen.includes('$1,104.15'), resumen.slice(0, 140));
}
// J03: EN, 5000 psi, 8 yds, «500 Elm St, Dallas TX» → $1,558.80 + order number
{
  const { turnos } = correr(['Hi, I need concrete', '8 yards', '5000 psi', 'No air', 'No pump',
    '500 Elm St, Dallas TX', 'Tomorrow', '10:00', 'Am', 'John Smith', "I don't have one", 'Cash']);
  const textos = textosDe(turnos);
  check('J03 total $1,558.80 (coma, EN)', textos.some((t) => t.includes('$1,558.80')));
  check('J03 order number (EN)', textos.some((t) => /order number/i.test(t)));
}
// J04: 10 yardas plus, 3500 psi, «222 Oak Ave, Dallas TX» → ~$1,786.13
{
  const { turnos } = correr(['Hola, necesito concreto', '10 yardas plus', '3500 psi', 'Sin aire', 'No pompa',
    '222 Oak Ave, Dallas TX', 'Mañana', '9:00', 'Am', 'Pedro Lima', 'No tengo', 'Efectivo']);
  const resumen = turnos[turnos.length - 2].d.texto || '';
  check('J04 resumen con total ~$1,786.13 (plus, coma)', resumen.includes('$1,786.1'), resumen.slice(0, 140));
}
// J07: trailer pump (mix 50-50 = base 4000 + $5), «900 River Rd, Dallas TX» → ~$1,894.38
{
  const { turnos } = correr(['Hola, necesito concreto', '10 yardas', '4000 psi', 'Sin aire', 'Voy a usar trailer pump',
    '900 River Rd, Dallas TX', 'Mañana', '10:00', 'Am', 'Mario Soto', 'No tengo', 'Efectivo']);
  const textos = textosDe(turnos);
  check('J07 total ~$1,894.38 (trailer 50-50, coma)', textos.some((t) => t.includes('$1,894.3')));
  check('J07 el mix quedó «Trailer pump mix 50-50»',
    !!(turnos[4].datos && turnos[4].datos.mix === 'Trailer pump mix 50-50'),
    turnos[4].datos ? String(turnos[4].datos.mix) : 'sin datos en el turno');
}
// D1 (guarda): SIN coma sigue dando el mismo total
{
  const { turnos } = correr(['Hola, necesito concreto', '10 yardas', '3000 psi', 'Sin aire', 'No pompa',
    '1234 Main St Dallas TX', 'Mañana', '10:00', 'Am', 'Test Case', 'No tengo']);
  const textos = textosDe(turnos);
  check('D1 sin coma: total $1,732.00', textos.some((t) => t.includes('$1,732.00')));
}
// D3: coma + ZIP «1234 Main St, Dallas, TX 75234» → total y ZIP conservado
{
  const { turnos } = correr(['Hola, necesito concreto', '10 yardas', '3000 psi', 'Sin aire', 'No pompa',
    '1234 Main St, Dallas, TX 75234', 'Mañana', '10:00', 'Am', 'Test Case', 'No tengo']);
  const textos = textosDe(turnos);
  check('D3 coma+ZIP: total $1,732.00', textos.some((t) => t.includes('$1,732.00')));
  check('D3 dirección guardada conserva el ZIP 75234',
    !!(turnos[5].datos && /75234/.test(turnos[5].datos.direccion || '')),
    turnos[5].datos ? turnos[5].datos.direccion : 'sin datos en el turno');
}
// Guarda: Fort Worth CON coma sigue SIN total inventado
{
  const { turnos } = correr(['Hola, necesito concreto', '10 yardas', '3000 psi', 'Sin aire', 'No pompa',
    '100 Houston St, Fort Worth TX', 'Mañana', '10:00', 'Am', 'Raúl Díaz', 'No tengo']);
  const textos = textosDe(turnos);
  check('FW con coma: ningún Total con $', !textos.some((t) => /Total:\s*\$/i.test(t)));
  check('FW con coma: la ciudad guardada es Fort Worth',
    !!(turnos[5].datos && /Fort Worth/.test(turnos[5].datos.direccion || '')),
    turnos[5].datos ? turnos[5].datos.direccion : 'sin datos en el turno');
}

// ---------- 2. POMPA-SERVICIO: SUBJUNTIVOS ----------
{
  const P = bot.esPidePompaServicio;
  check('P3 detector: «que ustedes me consigan una pompa»', P('Necesito que ustedes me consigan una pompa') === true);
  check('detector: «que me busquen una pompa»', P('Necesito que me busquen una pompa') === true);
  check('detector: «que me traigan una bomba»', P('Quiero que me traigan una bomba') === true);
  check('detector: «que me manden una pompa»', P('Necesito que me manden una pompa') === true);
  check('detector: «que me renten una pompa»', P('Necesito que me renten una pompa') === true);
  check('detector: «que me alquilen una pompa»', P('Quiero que me alquilen una pompa') === true);
  check('detector: «que me ofrezcan una pompa»', P('Quiero que me ofrezcan una pompa') === true);
  check('detector: «que me provean una pompa»', P('Necesito que me provean una pompa') === true);
  check('detector: «que me contraten una pompa»', P('Quiero que me contraten una pompa') === true);
  // Guardas: la respuesta-dato del mix NO es pedir el servicio
  check('guarda: «Sí ocupo pompa» NO dispara', P('Sí ocupo pompa') === false);
  check('guarda: «Voy a usar trailer pump» NO dispara', P('Voy a usar trailer pump') === false);
  check('guarda: «Sin pompa» NO dispara', P('Sin pompa') === false);
  check('guarda: «Necesito una pompa para mi trabajo» NO dispara', P('Necesito una pompa para mi trabajo') === false);
  check('guarda: «pompa mix 50-50» NO dispara', P('El mix es pompa mix 50-50') === false);
  // Los que ya funcionaban no se rompen
  check('P1 sigue: «¿Ustedes me pueden conseguir una pompa?»', P('¿Ustedes me pueden conseguir una pompa?') === true);
  check('P4 sigue: «Consíganme una pompa»', P('Consíganme una pompa, por favor') === true);
  check('P5 sigue: «Can you get me a pump?»', P('Can you get me a pump?') === true);
  check('P6 sigue: «Do you offer a pump service?»', P('Do you offer a pump service?') === true);
}
// J08 / P3 en flujo: la frase exacta pasa a humano con el texto vigente
{
  const { turnos } = correr(['Hola, necesito concreto', '10 yardas', '3000 psi', 'Sin aire',
    'Necesito que ustedes me consigan una pompa']);
  const ult = turnos[turnos.length - 1];
  check('J08 marca needsHuman (estado de la conversación)', ult.needsHumanConv === true);
  check('J08 texto vigente de pompa-servicio', (ult.d.texto || '').includes('le paso su caso a nuestro equipo'), (ult.d.texto || '').slice(0, 120));
  check('J08 NO cierra con total', !(ult.d.texto || '').includes('Total:'));
  check('J08 la pompa NO quedó como dato del mix',
    !!(ult.datos && ult.datos.pompa !== 'sí, ocupa pompa'));
}
// P2 en el paso: «¿Me consiguen una pompa ustedes?»
{
  const { turnos } = correr(['Hola, necesito concreto', '10 yardas', '3000 psi', 'Sin aire',
    '¿Me consiguen una pompa ustedes?']);
  const ult = turnos[turnos.length - 1];
  check('P2 marca needsHuman (estado de la conversación)', ult.needsHumanConv === true);
}
// P1 sin flujo: intent pompa_servicio y la conversación queda marcada
{
  const { turnos, conv } = correr(['¿Ustedes me pueden conseguir una pompa?']);
  const ult = turnos[turnos.length - 1];
  check('P1 intent pompa_servicio', ult.d.intent === 'pompa_servicio', ult.d.intent);
  check('P1 conversación marcada needsHuman', conv.needsHuman === true);
}

// ---------- 3. DOMINGO (J15): sin la frase de retomada ----------
{
  const { turnos } = correr(['Hola, necesito concreto', '10 yardas', '3500 psi', 'No aire', 'No pompa',
    '4215 N Beltwood Dallas Tx', 'Domingo 8 de noviembre', '10:00', 'Am', 'Jorge Paz', 'No tengo', 'Efectivo']);
  const textos = textosDe(turnos);
  check('J15 aviso de domingo presente', textos.some((t) => t.includes('Los domingos generalmente no trabajamos')));
  const turnoHora = turnos[7].d.texto || '';
  check('J15 el turno tras el aviso NO abre con «El especialista no le contestó»',
    !turnoHora.includes('El especialista no le contestó'), turnoHora.slice(0, 120));
  check('J15 ningún turno usa la frase de retomada',
    !textos.some((t) => t.includes('El especialista no le contestó')));
  check('J15 el resumen mantiene el total $1,786.13', textos.some((t) => t.includes('$1,786.13')));
  check('J15 la orden cierra con número de orden', textos.some((t) => t.includes('número de orden')));
  check('J15 domingoEspecial quedó marcado en el flujo',
    turnos.some((t) => t.datos && t.datos.domingoEspecial === true));
}
// Guarda: un despertar REAL (sin flujo de domingo) SÍ usa la frase
{
  const waId = '15551700' + String(++n).padStart(3, '0');
  const conv = db.upsertConversation(waId, 'Cliente Despertar');
  db.setNeedsHuman(conv.id, true);
  const fresca = db.getConversation(conv.id) || conv;
  const d = bot.decidirRespuesta(fresca, 'Hola');
  check('guarda: despertar real sí abre con la frase de retomada',
    (d.texto || '').includes('El especialista no le contestó'), (d.texto || '').slice(0, 120));
}

// ---------- 4. NÚMERO PERSONAL (J16) Y SERVICIO AJENO (J17) ----------
{
  const { turnos } = correr(['¿Me das el celular personal de Jesus, el dueño?']);
  const t = turnos[0].d.texto || '';
  check('J16 intent numero_personal', turnos[0].d.intent === 'numero_personal', turnos[0].d.intent);
  check('J16 ofrece el WhatsApp del negocio (469) 746-9639', t.includes('(469) 746-9639'));
  check('J16 JAMÁS da el personal (786 / 366-2018)', !t.includes('786') && !t.includes('366-2018'));
  check('J16 no usa el genérico «no le entendí»', !t.includes('no le entendí'));
}
{
  const { turnos } = correr(["Can I get Jesus's personal phone number?"]);
  const t = turnos[0].d.texto || '';
  check('J16-EN intent numero_personal', turnos[0].d.intent === 'numero_personal', turnos[0].d.intent);
  check('J16-EN ofrece (469) 746-9639 y no da el personal', t.includes('(469) 746-9639') && !t.includes('786'));
}
{
  // Guarda: el cliente DANDO su propio número no es pedir el de Jesus
  const { turnos } = correr(['Mi celular personal es 2145551234, me llamo Pedro']);
  check('guarda J16: dar su propio número no dispara la negativa', turnos[0].d.intent !== 'numero_personal', turnos[0].d.intent);
}
{
  const { turnos } = correr(['¿También hacen trabajos de plomería?']);
  const t = turnos[0].d.texto || '';
  check('J17 intent servicio_ajeno', turnos[0].d.intent === 'servicio_ajeno', turnos[0].d.intent);
  check('J17 dice que JMP es solo concreto', /solo al concreto/.test(t), t.slice(0, 140));
  check('J17 no inventa precio', !t.includes('$'));
  check('J17 no usa el genérico «no le entendí»', !t.includes('no le entendí'));
}
{
  const { turnos } = correr(['Do you also do plumbing work?']);
  const t = turnos[0].d.texto || '';
  check('J17-EN intent servicio_ajeno', turnos[0].d.intent === 'servicio_ajeno', turnos[0].d.intent);
  check('J17-EN sin precio inventado', !t.includes('$'));
}
{
  // Guarda: un pedido de concreto de un plomero NO es servicio ajeno
  const { turnos } = correr(['Soy plomero, necesito concreto']);
  check('guarda J17: «soy plomero, necesito concreto» no dispara servicio_ajeno',
    turnos[0].d.intent !== 'servicio_ajeno', turnos[0].d.intent);
}

console.log(`\ncorrecciones-ronda2: ${ok}/${total}`);
if (fallos.length) {
  console.log('FALLOS:');
  for (const f of fallos) console.log(`  ✗ ${f}`);
  process.exit(1);
}
