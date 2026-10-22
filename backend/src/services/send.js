// ============================================================
// Envío de mensajes por la API oficial de WhatsApp (Meta Cloud API).
// POST https://graph.facebook.com/{version}/{phone_number_id}/messages
// El token y el phone_number_id salen de variables de entorno.
// NUNCA van hardcodeados en el código.
// ============================================================
const { cfg } = require('../config');

function apiUrl() {
  return `https://graph.facebook.com/${cfg.graphVersion}/${cfg.metaPhoneNumberId}/messages`;
}

function listoParaEnviar() {
  return !!(cfg.metaAccessToken && cfg.metaPhoneNumberId);
}

async function llamarApi(payload) {
  if (!listoParaEnviar()) {
    throw new Error(
      'Faltan META_ACCESS_TOKEN o META_PHONE_NUMBER_ID en la configuración.'
    );
  }
  const res = await fetch(apiUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.metaAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Meta respondió ${res.status}`);
    err.meta = data;
    err.httpStatus = res.status;
    throw err;
  }
  // Meta devuelve { messages: [{ id: 'wamid....' }] }
  return data.messages?.[0]?.id || null;
}

/**
 * Envía un mensaje de texto libre.
 * (Solo funciona dentro de la ventana de 24h que abre el cliente,
 * o como respuesta a un mensaje entrante.)
 */
async function sendText(to, text) {
  return llamarApi({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text, preview_url: true },
  });
}

/**
 * Envía una PLANTILLA aprobada por Meta (message template).
 * Es la única vía para iniciar conversación fuera de la ventana de 24h
 * (encuestas, recordatorios, campañas).
 *
 * @param {string} to - teléfono destino en formato internacional (ej. 19453016982)
 * @param {string} templateName - nombre exacto de la plantilla aprobada en Meta
 * @param {string} language - código de idioma de la plantilla (ej. 'es')
 * @param {Array} components - parámetros de la plantilla (ver docs de Meta)
 */
async function sendTemplate(to, templateName, language = 'es', components = []) {
  return llamarApi({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      ...(components.length ? { components } : {}),
    },
  });
}

/**
 * Sube un archivo a la biblioteca de medios de WhatsApp (Meta) y
 * devuelve su media_id. El media_id sirve ~30 días; quien lo usa
 * debe re-subir si el envío con un id viejo falla.
 * POST https://graph.facebook.com/{version}/{phone_number_id}/media
 */
async function uploadMedia(buffer, filename, mimeType) {
  if (!listoParaEnviar()) {
    throw new Error(
      'Faltan META_ACCESS_TOKEN o META_PHONE_NUMBER_ID en la configuración.'
    );
  }
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  const res = await fetch(
    `https://graph.facebook.com/${cfg.graphVersion}/${cfg.metaPhoneNumberId}/media`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.metaAccessToken}` },
      body: form, // sin Content-Type manual: fetch pone el boundary
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    const err = new Error(
      data?.error?.message || `Meta respondió ${res.status} al subir el archivo`
    );
    err.meta = data;
    err.httpStatus = res.status;
    throw err;
  }
  return data.id;
}

/**
 * Envía un DOCUMENTO ya subido (por su media_id) al cliente.
 * Funciona dentro de la ventana de 24h, como los textos.
 */
async function sendDocument(to, mediaId, filename) {
  return llamarApi({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'document',
    document: { id: mediaId, filename },
  });
}

/** Marca un mensaje entrante como leído (doble check azul). */
async function markAsRead(messageId) {
  if (!listoParaEnviar() || !messageId) return;
  try {
    await llamarApi({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
  } catch (e) {
    // No es crítico; solo se registra.
    console.warn('[send] no se pudo marcar como leído:', e.message);
  }
}

module.exports = { sendText, sendTemplate, markAsRead, listoParaEnviar, uploadMedia, sendDocument };
