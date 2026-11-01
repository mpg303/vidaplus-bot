// ============================================================
// Forma de autorización de tarjeta de crédito (JMP Concrete).
//
// Cuando el cliente elige pagar con TARJETA DE CRÉDITO, el bot le
// envía esta forma AUTOMÁTICAMENTE como documento de WhatsApp
// (orden de Jesus, 2026-10-21: «quiero que todo sea automático»
// + la forma aprobada por él el mismo día). El texto impreso del
// recargo se actualizó de 3.5% a 4% por orden de Jesus
// (2026-10-31), para que la forma diga lo mismo que cobra el bot.
//
// El PDF viaja en el repo como texto base64
// (backend/assets/forma-autorizacion-tarjeta.b64 — la misma forma
// aprobada, con el logo reducido: texto y campos idénticos)
// porque el push al repo solo admite archivos de texto. Aquí se
// decodifica en memoria y se sube a Meta UNA vez; el media_id se
// cachea en el proceso (Meta lo conserva ~30 días) y si un envío
// con el id cacheado falla, se re-sube y se reintenta una sola vez.
//
// LOGO NUEVO (orden de Jesus, 2026-10-31): el asset trae el logo
// oficial nuevo de JMP (el del camión naranja sobre negro) en el
// encabezado, colocado sobre el logo anterior sin tocar ningún
// texto ni campo de la forma aprobada.
//
// MONTO PRE-LLENADO (orden de Jesus, 2026-10-31): si la orden ya
// tiene total final de crédito (total con taxes + 4%), la forma
// sale con el campo «amount» YA LLENADO con ese monto, para que
// el cliente no tenga que escribirlo. Esa copia personalizada se
// genera al momento con pdf-lib y se sube solo para ese envío
// (sin caché). Si algo falla al generarla, se envía la forma
// genérica de siempre: el cliente nunca se queda sin su forma.
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

/**
 * Genera una copia de la forma con el campo «amount» pre-llenado
 * con el monto dado (formato 9,006.40). Devuelve un Buffer listo
 * para subir a Meta. Lanza si pdf-lib o el campo no están: el
 * llamador decide el respaldo (la forma genérica).
 */
async function generarFormaConMonto(monto) {
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const doc = await PDFDocument.load(bufferForma());
  const form = doc.getForm();
  const texto = Number(monto).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  form.getTextField('amount').setText(texto);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(font);
  return Buffer.from(await doc.save());
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
 * WhatsApp. Si `monto` es un número válido mayor que cero, la
 * forma sale personalizada con ese monto pre-llenado; si no (o si
 * la personalización falla), se envía la forma genérica.
 * Devuelve el metaId del mensaje enviado.
 */
async function enviarFormaTarjeta(waId, monto) {
  if (typeof monto === 'number' && Number.isFinite(monto) && monto > 0) {
    try {
      const buffer = await generarFormaConMonto(monto);
      const mediaId = await uploadMedia(buffer, NOMBRE_ARCHIVO_FORMA, 'application/pdf');
      return await sendDocument(waId, mediaId, NOMBRE_ARCHIVO_FORMA);
    } catch (e) {
      console.error(
        '[formaTarjeta] no se pudo pre-llenar el monto; se envía la forma genérica:',
        e && e.message
      );
    }
  }
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

module.exports = { enviarFormaTarjeta, mensajeInstruccionesForma, NOMBRE_ARCHIVO_FORMA, generarFormaConMonto };
