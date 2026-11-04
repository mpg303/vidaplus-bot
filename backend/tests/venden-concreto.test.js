// ============================================================
// NUEVA CONSULTA TRAS EL CIERRE DE UNA ORDEN (defecto real
// 2026-11-04 08:18, captura de Jesus): su orden de PRUEBA
// cerró de madrugada (00:51) y a las 08:18 escribió «Hola»
// (saludo normal) y luego «Venden concreto?»; el bot le
// respondió «Perfecto, su mensaje quedó anotado para el
// especialista que está atendiendo su orden…» — como si su
// pregunta fuera una nota de la orden vieja.
// CAUSA RAÍZ: el estado post-cierre no vive en el flujo (la
// caducidad de 30 min de la ronda 29 solo olvida flujos A
// MEDIAS); nace de ultimaOrdenCerrada(), que encuentra la
// confirmación armada en el historial con una ventana de 7
// DÍAS. Dentro de esa ventana, TODO mensaje con intent
// «otro» que no corrigiera el mix ni el pago de la orden
// caía en la nota genérica del especialista — y al salir con
// intent «postcierre» ni siquiera llegaba a la capa IA, que
// solo atiende decisiones «otro».
// ARREGLO: si el mensaje CLARAMENTE abre una consulta nueva
// (pregunta de servicio: «¿Venden concreto?», «Do you sell
// concrete?»; buscar/necesitar concreto sin referirse a la
// orden; otro trabajo u otra cotización), manejarPostCierre
// devuelve null y el mensaje sigue el curso normal, como si
// lo escribiera un cliente nuevo; la orden anterior queda
// intacta en el registro de Orders. Lo que habla DE la
// orden («mi orden», cambiar, corregir, su pago) sigue
// como corrección o nota del especialista.
// ACTUALIZACIÓN 2026-11-04 (orden del dueño 08:39, «Sí,
// agrega la respuesta directa de "vendemos concreto"»): la
// paridad con el cliente nuevo ya NO es el respaldo genérico
// «no le entendí»: AMBOS reciben la RESPUESTA DIRECTA fija
// («¡Claro que sí! Vendemos concreto por yarda cúbica en
// Dallas–Fort Worth. ¿Cuántas yardas necesita?» / EN). Las
// aserciones de esta suite se actualizaron a ese texto; las
// guardas de la orden quedan idénticas. La cobertura fina
// de la directa (detector, continuación con la cantidad,
// pregunta lateral a mitad del flujo) vive en
// respuesta-directa.test.js.
// Correr: node tests/venden-concreto.test.js
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jmp-venden-test-'));
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

// Réplica fiel del webhook: guarda el mensaje del cliente,
// decide, guarda la respuesta BOT y, si la decisión trae la
// confirmación armada, guarda el mensaje BOT con
// flags.tipo='confirmacion_armada' y marca needsHuman.
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

const NOTA_ES = 'quedó anotado para el especialista';
const NOTA_EN = 'has been noted for the specialist';
const DIRECTA_ES =
  '¡Claro que sí! Vendemos concreto por yarda cúbica en Dallas–Fort Worth. ¿Cuántas yardas necesita?';
const DIRECTA_EN =
  'Yes, we do! We sell concrete by the cubic yard in Dallas–Fort Worth. How many yards do you need?';

// Orden completa de Dallas (mismo guion de las demás suites).
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

// ---------- Línea base: cliente SIN orden (paridad) ----------
{
  const conv = db.upsertConversation('15551110001', 'Sin Orden');
  const r = turno(conv, 'Venden concreto?');
  check('base: cliente nuevo «Venden concreto?» recibe la RESPUESTA DIRECTA',
    r.d.texto === DIRECTA_ES, r.d.texto);
  check('base: cliente nuevo sale con intent «venden_concreto»',
    r.d.intent === 'venden_concreto', r.d.intent);
  check('base: cliente nuevo NO recibe la nota del especialista', !(r.d.texto || '').includes(NOTA_ES));
  var textoBaseNuevo = r.d.texto;
}

// ---------- La captura exacta: orden cerrada → «Hola» → «Venden concreto?» ----------
{
  const { conv, cierre } = ordenCerrada('15551110002', 'Captura');
  check('captura: la orden sí cerró (confirmación armada)', !!cierre.confirmacionArmada);
  const ordenesAntes = db.listOrders().filter((o) => o.conversationId === conv.id).length;
  check('captura: la orden quedó en el registro de Orders', ordenesAntes === 1, String(ordenesAntes));

  let r = turno(conv, 'Hola');
  check('captura: «Hola» tras el cierre se atiende como saludo (no nota)',
    r.d.intent === 'saludo' && !(r.d.texto || '').includes(NOTA_ES), r.d.intent);

  r = turno(r.conv, 'Venden concreto?');
  check('captura: «Venden concreto?» ya NO es nota del especialista',
    !(r.d.texto || '').includes(NOTA_ES), r.d.texto);
  check('captura: «Venden concreto?» ya NO sale con intent «postcierre»',
    r.d.intent !== 'postcierre', r.d.intent);
  check('captura: «Venden concreto?» recibe la RESPUESTA DIRECTA del dueño',
    r.d.texto === DIRECTA_ES, r.d.texto);
  check('captura: la respuesta es IDÉNTICA a la de un cliente nuevo',
    r.d.texto === textoBaseNuevo, r.d.texto);

  const ordenesDespues = db.listOrders().filter((o) => o.conversationId === conv.id).length;
  check('captura: la orden anterior sigue intacta en Orders tras la consulta nueva',
    ordenesDespues === 1, String(ordenesDespues));
}

// ---------- Directo tras el cierre, sin saludo previo ----------
{
  const { conv } = ordenCerrada('15551110003', 'Directo');
  const r = turno(conv, 'Venden concreto?');
  check('directo: «Venden concreto?» tras el cierre NO es nota del especialista',
    !(r.d.texto || '').includes(NOTA_ES), r.d.texto);
  check('directo: recibe la respuesta directa (puede anteponerse la frase de retomada de siempre)',
    (r.d.texto || '').includes(DIRECTA_ES), r.d.texto);
}

// ---------- Variante EN: «Do you sell concrete?» ----------
{
  const { conv } = ordenCerrada('15551110004', 'English');
  const r = turno(conv, 'Do you sell concrete?');
  check('EN: «Do you sell concrete?» NO es nota del especialista',
    !(r.d.texto || '').includes(NOTA_EN) && !(r.d.texto || '').includes(NOTA_ES), r.d.texto);
  check('EN: recibe la respuesta directa en inglés',
    (r.d.texto || '').includes(DIRECTA_EN), r.d.texto);
}

// ---------- Otra pregunta de servicio: «¿Venden concreto en Fort Worth?» ----------
// (La atiende el intent fuerte de zona/cobertura, que nunca
// pasó por el post-cierre: se verifica que sigue igual.)
{
  const { conv } = ordenCerrada('15551110005', 'Servicio');
  const r = turno(conv, '¿Venden concreto en Fort Worth?');
  check('servicio: «¿Venden concreto en Fort Worth?» se atiende como zona (no nota)',
    !(r.d.texto || '').includes(NOTA_ES) && r.d.intent === 'zona', r.d.intent);
}

// ---------- Lo que SÍ habla de la orden sigue post-cierre ----------
{
  const { conv } = ordenCerrada('15551110006', 'DeLaOrden');
  let r = turno(conv, 'Te paso un dato de mi orden, el guardia de la entrada ya está avisado');
  check('orden: mensaje sobre «mi orden» SIGUE como nota del especialista',
    r.d.intent === 'postcierre' && (r.d.texto || '').includes(NOTA_ES), r.d.texto);

  r = turno(r.conv, 'mejor pago con cheque');
  check('orden: el cambio de pago SIGUE atendiéndose como corrección de la orden',
    r.d.intent === 'postcierre' && (r.d.texto || '').includes('cheque') && !(r.d.texto || '').includes(NOTA_ES),
    r.d.texto);

  r = turno(r.conv, '4000 psi');
  check('orden: la corrección de mix SIGUE atendiéndose como corrección de la orden',
    r.d.intent === 'postcierre' && (r.d.texto || '').includes('4000 psi'), r.d.texto);

  r = turno(r.conv, 'Quiero cotizar otro trabajo');
  check('orden: «Quiero cotizar otro trabajo» abre cotización nueva (flujo, no nota)',
    r.d.intent === 'cotizacion' && !(r.d.texto || '').includes(NOTA_ES), r.d.intent);
}

// ---------- EN: mensaje sobre la orden sigue como nota ----------
// (La nota sale en el idioma de la ORDEN cerrada —regla ya
// existente en manejarPostCierre—, aquí ES; lo que se
// verifica es que sigue siendo la nota del especialista y
// con intent «postcierre», idéntico a antes del arreglo.)
{
  const { conv } = ordenCerrada('15551110007', 'OrderNote');
  const r = turno(conv, 'Just a note on my order: the guard at the entrance has already been told');
  check('EN orden: mensaje sobre «my order» SIGUE como nota del especialista',
    r.d.intent === 'postcierre' &&
      ((r.d.texto || '').includes(NOTA_EN) || (r.d.texto || '').includes(NOTA_ES)),
    r.d.texto);
}

console.log(`\nvenden-concreto: ${ok}/${total} OK`);
if (fallos.length) {
  console.log('FALLOS:');
  for (const f of fallos) console.log(' -', f);
  process.exit(1);
}
