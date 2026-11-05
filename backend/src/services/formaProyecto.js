// ============================================================
// Forma de información del proyecto (JMP Concrete).
//
// Cuando el cliente quiere PAGAR DESPUÉS DE LA TIRADA (después
// de la entrega / a crédito), el bot le envía esta forma
// AUTOMÁTICAMENTE como documento de WhatsApp (orden de Jesus,
// 2026-11-04): para pagar después de la entrega el cliente
// necesita llenarla con toda la información de la propiedad,
// del contratista y del dueño. La aprobación de esa forma de
// pago la decide el equipo (la conversación queda marcada
// needsHuman): el bot no promete plazos ni condiciones.
//
// Mismo patrón que la forma de autorización de tarjeta
// (services/formaTarjeta.js): el PDF viaja en el repo como
// texto base64 (backend/assets/forma-informacion-proyecto.b64
// — la forma «Project Information Sheet» aprobada por Jesus,
// con el logo oficial de JMP) porque el push al repo solo
// admite archivos de texto. Aquí se decodifica en memoria y se
// sube a Meta UNA vez; el media_id se cachea en el proceso
// (Meta lo conserva ~30 días) y si un envío con el id cacheado
// falla, se re-sube y se reintenta una sola vez.
// ============================================================
const fs = require('fs');
const path = require('path');
const { uploadMedia, sendDocument } = require('./send');

const NOMBRE_ARCHIVO_FORMA_PROYECTO = 'Project-Information-Sheet-JMP-Concrete.pdf';

let bufferCache = null;
let mediaIdCache = null;

/** Bytes del PDF de la forma (decodificados del asset base64). */
function bufferFormaProyecto() {
  if (!bufferCache) {
    const b64 = fs.readFileSync(
      path.join(__dirname, '..', '..', 'assets', 'forma-informacion-proyecto.b64'),
      'utf8'
    );
    bufferCache = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
  }
  return bufferCache;
}

/** Sube la forma a Meta si aún no hay media_id cacheado. */
async function asegurarMediaId() {
  if (!mediaIdCache) {
    mediaIdCache = await uploadMedia(
      bufferFormaProyecto(),
      NOMBRE_ARCHIVO_FORMA_PROYECTO,
      'application/pdf'
    );
  }
  return mediaIdCache;
}

/**
 * Envía la forma de información del proyecto al cliente como
 * documento de WhatsApp. Devuelve el metaId del mensaje enviado.
 */
async function enviarFormaProyecto(waId) {
  const mediaId = await asegurarMediaId();
  try {
    return await sendDocument(waId, mediaId, NOMBRE_ARCHIVO_FORMA_PROYECTO);
  } catch (e) {
    // El media_id pudo vencer o quedar inválido: se sube de nuevo
    // y se reintenta una sola vez antes de dar el envío por fallido.
    mediaIdCache = null;
    const nuevoId = await asegurarMediaId();
    return sendDocument(waId, nuevoId, NOMBRE_ARCHIVO_FORMA_PROYECTO);
  }
}

// Mensaje que acompaña a la forma (la forma va primero y este
// texto enseguida; el equivalente en inglés si la conversación
// va en inglés).
const MENSAJE_FORMA_PROYECTO_ES =
  'Aquí tiene la forma de información del proyecto. Por favor llénela con los datos de la propiedad, del contratista y del dueño, y envíela de vuelta por aquí.';
const MENSAJE_FORMA_PROYECTO_EN =
  "Here's the project information form. Please fill it out with the details of the property, the contractor and the owner, and send it back here.";

function mensajeInstruccionesFormaProyecto(idioma) {
  return idioma === 'en' ? MENSAJE_FORMA_PROYECTO_EN : MENSAJE_FORMA_PROYECTO_ES;
}

module.exports = {
  enviarFormaProyecto,
  mensajeInstruccionesFormaProyecto,
  NOMBRE_ARCHIVO_FORMA_PROYECTO,
  bufferFormaProyecto,
};
