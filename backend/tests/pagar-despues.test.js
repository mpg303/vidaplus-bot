// ============================================================
// PAGAR DESPUÉS DE LA TIRADA (orden de Jesus, 2026-11-04):
// cuando el cliente pide concreto y quiere pagar DESPUÉS de
// la tirada/entrega (a crédito, «pago luego», «net», «pay
// after delivery»…), necesita llenar la forma de información
// del proyecto con los datos de la propiedad, del contratista
// y del dueño. El bot le explica eso en su idioma, la decisión
// lleva la marca formaProyecto (el webhook le envía el PDF
// como documento y abre la espera, con el MISMO patrón de la
// forma de tarjeta), la conversación queda needsHuman (la
// aprobación la decide Jesus) y la orden NO cierra como
// confirmada. Al devolver la forma (documento o foto), el bot
// confirma la recepción y el caso sigue con el equipo.
// Trampas que NO deben disparar la forma: «tarjeta de
// crédito» (es un método normal, va con su propia forma),
// pagar A LA ENTREGA / contra entrega (pago normal al
// momento de la entrega) y la pregunta del momento del pago
// («¿debo pagar por adelantado?» sigue con su línea de
// siempre).
// Correr: node tests/pagar-despues.test.js
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jmp-pago-despues-test-'));
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.SUPABASE_ANON_KEY;

const db = require('../src/db');
const bot = require('../src/services/autoReply');
const formaProyecto = require('../src/services/formaProyecto');

let ok = 0;
let total = 0;
const fallos = [];
function check(nombre, cond, extra = '') {
  total++;
  if (cond) ok++;
  else fallos.push(`${nombre}${extra ? ` — ${extra}` : ''}`);
}
function turno(conv, texto, tipo) {
  const d = bot.decidirRespuesta(conv, texto, tipo || 'text');
  return { d, conv: db.getConversation(conv.id) || conv };
}
function nuevaConv(waId, name) {
  return db.upsertConversation(waId, name);
}

const TEXTO_ES =
  'Claro. Para pagar después de la entrega, primero necesita completar nuestra forma de información del proyecto, con los datos de la propiedad, del contratista y del dueño. Se la envío enseguida: por favor llénela y envíela de vuelta por aquí. En cuanto la recibamos, nuestro equipo revisa su caso y le confirma si su orden queda aprobada con esa forma de pago.';
const TEXTO_EN =
  "Of course. To pay after delivery, you first need to complete our project information form, with the details of the property, the contractor and the owner. I'll send it right away: please fill it out and send it back here. As soon as we receive it, our team will review your case and confirm whether your order is approved with that payment arrangement.";
const RECIBIDA_ES =
  'Ya recibí su forma de información del proyecto. ✅ Nuestro equipo la va a revisar y le confirma si su orden queda aprobada para pagar después de la entrega. ¡Gracias!';

// ---------- 1. Detector: positivos ES/EN ----------
for (const frase of [
  'Quiero pagar después de la tirada',
  '¿Puedo pagar después de la entrega?',
  'Pago luego',
  'Te pago cuando terminen',
  'Lo quiero a crédito',
  '¿Manejan net 30?',
  'Se lo fio, me lo fían?',
  'Can I pay after the delivery?',
  'I want to pay after the pour',
  'pay later',
  'We pay on account',
]) {
  check(`detector +: «${frase}»`, bot.esPidePagarDespues(frase) === true);
}

// ---------- 2. Detector: negativos (no es pagar después) ----------
for (const frase of [
  'Pago con tarjeta de crédito',
  '¿Aceptan tarjeta de crédito?',
  'I will pay with a credit card',
  'Pago a la entrega',
  'Pago contra entrega',
  'Pago en efectivo',
  'Pago con cheque',
  '¿Debo pagar por adelantado?',
  'Solo pago por Zelle',
  '¿Cuándo se paga?',
]) {
  check(`detector −: «${frase}»`, bot.esPidePagarDespues(frase) === false, frase);
}

// ---------- 3. Flujo ES completo hasta el pago: pide pagar después ----------
{
  let conv = nuevaConv('50000000001', 'Cliente Pago Despues');
  let r;
  for (const paso of ['Hola, necesito concreto', '7 yds', '3000 psi', 'Aire', 'No',
    '3069 forest ln Dallas tx', 'Mañana', '10:00', 'Am', 'Jesús Morillo', 'No tengo']) {
    r = turno(conv, paso); conv = r.conv;
  }
  check('ES pago: el flujo llegó al paso del pago',
    !!conv.flow && !conv.flow.datos.pago, JSON.stringify(conv.flow && conv.flow.datos));
  r = turno(conv, 'Quiero pagar después de la tirada'); conv = r.conv;
  check('ES pago: la decisión pide la forma (formaProyecto)', r.d.formaProyecto === true, JSON.stringify(r.d));
  check('ES pago: intent pago_despues', r.d.intent === 'pago_despues', r.d.intent);
  check('ES pago: texto exacto de la explicación', r.d.texto === TEXTO_ES, r.d.texto);
  check('ES pago: idiomaForma es', r.d.idiomaForma === 'es', r.d.idiomaForma);
  check('ES pago: la conversación quedó needsHuman', conv.needsHuman === true);
  check('ES pago: la orden NO cerró (sin confirmación armada)', !r.d.confirmacionArmada);
  check('ES pago: el flujo sigue abierto', !!conv.flow);
  check('ES pago: no se anotó forma de pago', !!(conv.flow && !conv.flow.datos.pago),
    JSON.stringify(conv.flow && conv.flow.datos));
  check('ES pago: quedó la marca pagoDespues en los datos',
    !!(conv.flow && conv.flow.datos.pagoDespues === true));
  check('ES pago: no se emitió número de orden',
    !!(conv.flow && !conv.flow.datos.numeroOrden));

  // El webhook abre la espera al enviar la forma (eso hace el
  // bloque 3d con db.setFormaProyecto); aquí se simula ese
  // estado y el cliente devuelve la forma como documento.
  db.setFormaProyecto(conv.id, {
    estado: 'pendiente', idioma: 'es',
    enviadoAt: new Date().toISOString(), recibidaAt: null,
  });
  conv = db.getConversation(conv.id);
  r = turno(conv, '[documento recibido]', 'document'); conv = r.conv;
  check('ES forma devuelta: intent forma_proyecto', r.d.intent === 'forma_proyecto', r.d.intent);
  check('ES forma devuelta: confirmación exacta de recepción', r.d.texto === RECIBIDA_ES, r.d.texto);
  check('ES forma devuelta: la espera quedó «recibida»',
    !!(conv.formaProyecto && conv.formaProyecto.estado === 'recibida'),
    JSON.stringify(conv.formaProyecto));
  check('ES forma devuelta: el caso sigue needsHuman', conv.needsHuman === true);
}

// ---------- 4. Tras la escalada, el cliente elige un pago normal: la orden cierra ----------
{
  let conv = nuevaConv('50000000002', 'Cliente Se Arrepiente');
  let r;
  for (const paso of ['Hola, necesito concreto', '7 yds', '3000 psi', 'Aire', 'No',
    '3069 forest ln Dallas tx', 'Mañana', '10:00', 'Am', 'Jesús Morillo', 'No tengo']) {
    r = turno(conv, paso); conv = r.conv;
  }
  r = turno(conv, 'Pago después de la tirada'); conv = r.conv;
  check('ES cambio: primero escaló con la forma', r.d.formaProyecto === true && conv.needsHuman === true);
  r = turno(conv, 'Mejor pago en efectivo'); conv = r.conv;
  check('ES cambio: con un método normal la orden SÍ cierra',
    !!r.d.confirmacionArmada, JSON.stringify(r.d));
  check('ES cambio: el flujo se cerró', !conv.flow);
}

// ---------- 5. Petición a mitad del flujo (paso de yardas) ----------
{
  let conv = nuevaConv('50000000003', 'Cliente Mitad Flujo');
  let r = turno(conv, 'Hola, necesito concreto'); conv = r.conv;
  r = turno(conv, 'Quiero 10 yardas pero pago luego'); conv = r.conv;
  check('ES mitad: la forma se ofrece también a mitad del flujo',
    r.d.formaProyecto === true && r.d.texto === TEXTO_ES, r.d.texto);
  check('ES mitad: needsHuman', conv.needsHuman === true);
  check('ES mitad: la frase no se capturó como forma de pago',
    !!(conv.flow && !conv.flow.datos.pago), JSON.stringify(conv.flow && conv.flow.datos));
}

// ---------- 6. Flujo EN hasta el pago: «pay after delivery» ----------
{
  let conv = nuevaConv('50000000004', 'Pay Later Client');
  let r;
  for (const paso of ['Hello, I need concrete', '7 yards', '3000 psi', 'with air', 'no',
    '3069 Forest Ln Dallas TX', 'tomorrow', '10:00', 'am', 'John Smith', 'no company']) {
    r = turno(conv, paso); conv = r.conv;
  }
  r = turno(conv, 'Can I pay after the delivery?'); conv = r.conv;
  check('EN pago: la decisión pide la forma', r.d.formaProyecto === true, JSON.stringify(r.d));
  check('EN pago: texto exacto en inglés', r.d.texto === TEXTO_EN, r.d.texto);
  check('EN pago: idiomaForma en', r.d.idiomaForma === 'en', r.d.idiomaForma);
  check('EN pago: needsHuman y orden sin cerrar', conv.needsHuman === true && !r.d.confirmacionArmada);
}

// ---------- 7. Guardas en el paso del pago: crédito ≠ tarjeta de crédito ----------
{
  let conv = nuevaConv('50000000005', 'Cliente Tarjeta');
  let r;
  for (const paso of ['Hola, necesito concreto', '7 yds', '3000 psi', 'Aire', 'No',
    '3069 forest ln Dallas tx', 'Mañana', '10:00', 'Am', 'Jesús Morillo', 'No tengo']) {
    r = turno(conv, paso); conv = r.conv;
  }
  r = turno(conv, 'Pago con tarjeta de crédito'); conv = r.conv;
  check('guarda: tarjeta de crédito cierra con SU forma (formaTarjeta)',
    r.d.formaTarjeta === true, JSON.stringify(r.d && { formaTarjeta: r.d.formaTarjeta, formaProyecto: r.d.formaProyecto }));
  check('guarda: tarjeta de crédito NO dispara la forma del proyecto',
    r.d.formaProyecto !== true);
}

// ---------- 8. El asset y el servicio de la forma ----------
{
  const buf = formaProyecto.bufferFormaProyecto();
  check('asset: el PDF decodificado abre con %PDF',
    buf.slice(0, 4).toString('latin1') === '%PDF', buf.slice(0, 8).toString('latin1'));
  check('asset: nombre de archivo del documento',
    formaProyecto.NOMBRE_ARCHIVO_FORMA_PROYECTO === 'Project-Information-Sheet-JMP-Concrete.pdf',
    formaProyecto.NOMBRE_ARCHIVO_FORMA_PROYECTO);
  const { PDFDocument } = require('pdf-lib');
  PDFDocument.load(buf).then((doc) => {
    const campos = doc.getForm().getFields().map((f) => f.getName());
    check('asset: la forma es rellenable (47 campos)',
      campos.length === 47, String(campos.length));
    check('asset: trae los datos de propiedad, contratista y dueño',
      campos.includes('owner_name') && campos.includes('contractor_name') && campos.includes('legal_desc_1'),
      campos.join(','));
    terminar();
  }).catch((e) => {
    check('asset: pdf-lib puede abrir la forma', false, e.message);
    terminar();
  });
}

// ---------- 9. Cableado del webhook (mismo patrón que la forma de tarjeta) ----------
{
  const webhookSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'webhook.js'), 'utf8');
  check('webhook: importa y envía la forma del proyecto',
    webhookSrc.includes("require('../services/formaProyecto')") && webhookSrc.includes('enviarFormaProyecto'));
  check('webhook: abre la espera con setFormaProyecto al enviar',
    webhookSrc.includes('db.setFormaProyecto'));
  check('webhook: manda las instrucciones tras el documento',
    webhookSrc.includes('mensajeInstruccionesFormaProyecto'));
}

function terminar() {
  console.log(`\npagar-despues: ${ok}/${total}${fallos.length ? '\nFALLOS:\n- ' + fallos.join('\n- ') : ''}`);
  if (fallos.length) process.exitCode = 1;
}
