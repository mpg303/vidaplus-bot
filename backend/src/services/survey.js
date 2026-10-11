// ============================================================
// Encuesta de satisfacción post-cita.
// Dispara el mensaje que pide la reseña de Google tras la visita.
// El enlace sale de GOOGLE_REVIEW_URL (configurable, sin hardcodear).
// Todo el texto al paciente está en español, tono cálido.
// ============================================================
const { CLINICA, cfg } = require('../config');
const { sendText, sendTemplate } = require('./send');
const db = require('../db');

function textoEncuesta(nombre) {
  const n = nombre ? ` ${nombre}` : '';
  return (
    `Hola${n} 💙💚\n\n` +
    `Gracias por su visita a *${CLINICA.nombre}*. Nos encantaría saber cómo le fue 🙏.\n\n` +
    `¿Nos regala un minutito dejándonos su reseña en Google? Su opinión nos ayuda muchísimo:\n` +
    `${cfg.googleReviewUrl}\n\n` +
    `¡Gracias por confiar en nosotros! 💙💚`
  );
}

/**
 * Envía la encuesta a un paciente.
 * @param {Object} opts
 * @param {string} opts.phone - teléfono en formato internacional (ej. 19453016982)
 * @param {string} opts.name - nombre del paciente (opcional)
 * @param {string} opts.via - 'texto' (ventana 24h) o 'plantilla' (fuera de ventana)
 * @param {string} opts.templateName - requerido si via = 'plantilla'
 */
async function enviarEncuesta({ phone, name = '', via = 'texto', templateName = '' }) {
  const waId = String(phone).replace(/\D/g, '');
  let metaId = null;

  if (via === 'plantilla') {
    if (!templateName) throw new Error('Se requiere templateName para envío por plantilla.');
    // La plantilla aprobada debe incluir el enlace de reseña y el nombre como parámetros.
    metaId = await sendTemplate(waId, templateName, 'es', [
      { type: 'body', parameters: [{ type: 'text', text: name || 'paciente' }] },
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
