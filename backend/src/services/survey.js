// ============================================================
// Encuesta de satisfacción post-entrega.
// Dispara el mensaje que pregunta cómo le fue al cliente con su
// entrega de concreto y si necesita más yardas.
// Todo el texto al cliente está en español, tono cálido.
// ============================================================
const { NEGOCIO, cfg } = require('../config');
const { sendText, sendTemplate } = require('./send');
const db = require('../db');

function textoEncuesta(nombre) {
  const n = nombre ? ` ${nombre}` : '';
  return (
    `Hola${n} 🏗️\n\n` +
    `Gracias por su compra en *${NEGOCIO.nombre}*.\n\n` +
    `¿Cómo le fue con su entrega de concreto? ¿Todo bien con las yardas? 🙏\n\n` +
    `Si necesita más concreto o tiene otra obra, escríbanos por aquí ` +
    `y le atendemos enseguida.`
  );
}

/**
 * Envía la encuesta a un cliente.
 * @param {Object} opts
 * @param {string} opts.phone - teléfono en formato internacional (ej. 17863662018)
 * @param {string} opts.name - nombre del cliente (opcional)
 * @param {string} opts.via - 'texto' (ventana 24h) o 'plantilla' (fuera de ventana)
 * @param {string} opts.templateName - requerido si via = 'plantilla'
 */
async function enviarEncuesta({ phone, name = '', via = 'texto', templateName = '' }) {
  const waId = String(phone).replace(/\D/g, '');
  let metaId = null;

  if (via === 'plantilla') {
    if (!templateName) throw new Error('Se requiere templateName para envío por plantilla.');
    // La plantilla aprobada debe incluir el nombre como parámetro.
    metaId = await sendTemplate(waId, templateName, 'es', [
      { type: 'body', parameters: [{ type: 'text', text: name || 'cliente' }] },
    ]);
  } else {
    metaId = await sendText(waId, textoEncuesta(name));
  }

  // Se registra como mensaje del BOT y se marca la encuesta en la conversación.
  const conv = db.upsertConversation(waId, name);
  db.addMessage({
    conversationId: conv.id,
    waId,
    sender: 'BOT',
    type: via === 'plantilla' ? 'template' : 'text',
    text: via === 'plantilla' ? `[Plantilla de encuesta: ${templateName}]` : textoEncuesta(name),
    metaId,
    status: 'sent',
    flags: { survey: true },
  });
  conv.surveySentAt = new Date().toISOString();
  db.save();

  return { conversationId: conv.id, metaId };
}

module.exports = { enviarEncuesta, textoEncuesta };
