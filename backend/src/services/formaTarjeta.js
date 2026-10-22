// ============================================================
// Forma de autorización de tarjeta de crédito (JMP Concrete).
//
// Cuando el cliente elige pagar con TARJETA DE CRÉDITO, el bot le
// envía esta forma AUTOMÁTICAMENTE como documento de WhatsApp
// (orden de Jesus, 2026-10-21: «quiero que todo sea automático»
// + la forma aprobada por él el mismo día, con recargo de 3.5%).
//
// El PDF viaja en el repo como texto base64
// (backend/assets/forma-autorizacion-tarjeta.b64 — la misma forma
// aprobada, con el logo reducido: 167 KB en vez de 2.8 MB, texto y
// campos idénticos) porque el push al repo solo admite archivos de
// texto. Aquí se decodifica en memoria y se sube a Meta UNA vez;
// el media_id se cachea en el proceso (Meta lo conserva ~30 días)
// y si un envío con el id cacheado falla, se re-sube y se
// reintenta una sola vez.
// ============================================================
const fs = require('fs');
const path = require('path');
const { uploadMedia, sendDocument } = require('./send');

const NOMBRE_ARCHIVO_FORMA = 'Forma-Autorizacion-Tarjeta-JMP-Concrete.pdf';

let bufferCache = null;
let mediaIdCache = null;

/** Bytes del PDF de la forma (decodificados del asset base64). */
function bufferForma() {
  if (!bufferCache) {
    const b64 = fs.readFileSync(
      path.join(__dirname, '..', '..', 'assets', 'forma-autorizacion-tarjeta.b64'),
      'utf8'
    );
    bufferCache = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
  }
  return bufferCache;
}

/** Sube la forma a Meta si aún no hay media_id cacheado. */
async function asegurarMediaId() {
  if (!mediaIdCache) {
    mediaIdCache = await uploadMedia(bufferForma(), NOMBRE_ARCHIVO_FORMA, 'application/pdf');
  }
  return mediaIdCache;
}

/**
 * Envía la forma de autorización al cliente como documento de
 * WhatsApp. Devuelve el metaId del mensaje enviado.
 */
async function enviarFormaTarjeta(waId) {
  const mediaId = await asegurarMediaId();
  try {
    return await sendDocument(waId, mediaId, NOMBRE_ARCHIVO_FORMA);
  } catch (e) {
    // El media_id pudo vencer o quedar inválido: se sube de nuevo
    // y se reintenta una sola vez antes de dar el envío por fallido.
    mediaIdCache = null;
    const nuevoId = await asegurarMediaId();
    return sendDocument(waId, nuevoId, NOMBRE_ARCHIVO_FORMA);
  }
}

// Mensaje que acompaña a la forma (texto exacto del dueño,
// 2026-10-21; el equivalente en inglés si la conversación va en
// inglés). La forma va primero y este texto enseguida.
const MENSAJE_FORMA_ES =
  'Te acabo de enviar nuestra forma de autorización de tarjeta de crédito. Por favor llénala en digital, fírmala y envíala de vuelta por aquí. También necesito una foto de tu tarjeta por el frente y por el reverso, y una foto de tu identificación (licencia o ID oficial) también por ambos lados, que coincida con el nombre de la tarjeta. En cuanto reciba todo, tu orden queda lista para procesar el pago.';
const MENSAJE_FORMA_EN =
  "I just sent you our credit card authorization form. Please fill it out digitally, sign it, and send it back here. I also need a photo of your card, front and back, and a photo of your ID (driver's license or government ID), also front and back, matching the name on the card. As soon as I receive everything, your order will be ready to process payment.";

function mensajeInstruccionesForma(idioma) {
  return idioma === 'en' ? MENSAJE_FORMA_EN : MENSAJE_FORMA_ES;
}

module.exports = { enviarFormaTarjeta, mensajeInstruccionesForma, NOMBRE_ARCHIVO_FORMA };
