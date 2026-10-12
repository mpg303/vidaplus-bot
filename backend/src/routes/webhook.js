// ============================================================
// Webhook de WhatsApp (Meta Cloud API).
//
// GET  /webhook  → verificación inicial de Meta
//                  (hub.mode, hub.verify_token, hub.challenge)
// POST /webhook  → mensajes entrantes y estados de entrega.
//
// Flujo de un mensaje entrante:
//  1. Se guarda como CLIENTE.
//  2. Se marca como leído en Meta.
//  3. Si el bot puede responder (no pausado, sin humano activo),
//     se envía la respuesta automática y se programa el seguimiento 24h.
//  4. Si hay humano activo, el seguimiento se cancela (ya hay atención).
// ============================================================
const express = require('express');
const crypto = require('crypto');
const { cfg } = require('../config');
const db = require('../db');
const { sendText, markAsRead } = require('../services/send');
const { decidirRespuesta } = require('../services/autoReply');
const followup = require('../services/followup');

const router = express.Router();

// ---- Verificación del webhook (la hace Meta una sola vez al configurar) ----
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === cfg.metaVerifyToken && cfg.metaVerifyToken) {
    console.log('[webhook] verificación OK');
    return res.status(200).send(challenge);
  }
  console.warn('[webhook] verificación FALLIDA');
  return res.sendStatus(403);
});

// ---- Verificación opcional de firma (si se define META_APP_SECRET) ----
function firmaValida(req) {
  if (!cfg.metaAppSecret) return true; // sin secreto, se acepta (modo scaffold)
  const firma = req.headers['x-hub-signature-256'] || '';
  const esperada =
    'sha256=' +
    crypto.createHmac('sha256', cfg.metaAppSecret).update(req.rawBody || '').digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada));
  } catch {
    return false;
  }
}

// ---- Recepción de eventos ----
router.post('/', async (req, res) => {
  // Responder 200 de inmediato: Meta reintenta si tardamos.
  res.sendStatus(200);

  if (!firmaValida(req)) {
    console.warn('[webhook] firma inválida, se ignora el evento');
    return;
  }

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        if (value.messaging_product !== 'whatsapp') continue;

        // --- Estados de entrega (sent/delivered/read/failed) ---
        for (const st of value.statuses || []) {
          if (st.id && st.status) {
            db.updateMessageStatus(st.id, st.status, st.errors);
            if (st.status === 'failed' && st.errors?.length) {
              console.error('[webhook] entrega FALLIDA:', JSON.stringify(st.errors));
            }
          }
        }

        // --- Mensajes entrantes ---
        const contactos = {};
        for (const c of value.contacts || []) contactos[c.wa_id] = c.profile?.name;

        for (const msg of value.messages || []) {
          await procesarMensajeEntrante(msg, contactos[msg.from]);
        }
      }
    }
  } catch (e) {
    console.error('[webhook] error procesando evento:', e);
  }
});

/** Extrae el texto legible según el tipo de mensaje de Meta. */
function extraerTexto(msg) {
  switch (msg.type) {
    case 'text':
      return msg.text?.body || '';
    case 'button':
      return msg.button?.text || '[botón]';
    case 'interactive': {
      const r = msg.interactive || {};
      return r.button_reply?.title || r.list_reply?.title || '[interactivo]';
    }
    case 'image':
      return '[imagen recibida]';
    case 'audio':
      return '[nota de voz recibida]';
    case 'video':
      return '[video recibido]';
    case 'document':
      return '[documento recibido]';
    case 'location':
      return '[ubicación recibida]';
    default:
      return `[mensaje tipo ${msg.type}]`;
  }
}

async function procesarMensajeEntrante(msg, nombrePerfil) {
  const waId = msg.from;
  const texto = extraerTexto(msg);
  const conv = db.upsertConversation(waId, nombrePerfil);

  // 1. Guardar como CLIENTE
  db.addMessage({
    conversationId: conv.id,
    waId,
    sender: 'CLIENTE',
    type: msg.type || 'text',
    text: texto,
    metaId: msg.id || null,
  });
  markAsRead(msg.id).catch(() => {});

  // 2. Decidir respuesta automática
  const decision = decidirRespuesta(conv, texto);

  if (!decision.responder) {
    // Hay humano activo o bot pausado: no interrumpir.
    // Si hay humano activo, se cancela cualquier seguimiento pendiente.
    if (decision.motivo === 'especialista activo recientemente') {
      followup.cancelar(conv.id, 'especialista atendiendo');
    }
    console.log(`[webhook] sin autorespuesta (${decision.motivo}) — ${waId}`);
    return;
  }

  // Si el cliente pide humano, se marca para que un especialista lo tome.
  if (decision.intent === 'humano' || decision.intent === 'emergencia') {
    db.setNeedsHuman(conv.id, true);
  }

  // 3. Enviar la respuesta del BOT
  try {
    const metaId = await sendText(waId, decision.texto);
    db.addMessage({
      conversationId: conv.id,
      waId,
      sender: 'BOT',
      type: 'text',
      text: decision.texto,
      metaId,
      status: 'sent',
      flags: { intent: decision.intent, auto: true },
    });
  } catch (e) {
    console.error('[webhook] no se pudo enviar autorespuesta:', e.message);
    db.addMessage({
      conversationId: conv.id,
      waId,
      sender: 'BOT',
      type: 'text',
      text: decision.texto,
      status: 'failed',
      flags: { intent: decision.intent, auto: true, error: e.message },
    });
    return; // sin respuesta enviada no se programa seguimiento
  }

  // 4. Programar el seguimiento 24h (insistencia si no contestan).
  //    Se cancela/reinicia solo con cada mensaje nuevo del cliente.
  followup.programar(conv.id, {
    intent: decision.intent,
    topic: decision.topic,
    questionText: texto,
  });
  console.log(`[webhook] autorespuesta (${decision.intent}) + seguimiento 24h — ${waId}`);
}

module.exports = router;
