// ============================================================
// MOTOR DE SEGUIMIENTO 24H (requisito explícito del dueño).
//
// Regla del negocio: "si un paciente preguntó y nadie le respondió,
// el bot debe ser insistente: si no contestan, esperar 24 horas y
// volver a preguntar u ofrecer los servicios".
//
// Cómo funciona:
//  1. Cada vez que el bot responde automáticamente (o el paciente escribe
//     y no hay humano activo), se programa un seguimiento para dentro de
//     FOLLOWUP_DELAY_HOURS (default 24h).
//  2. Si el paciente escribe de nuevo, el temporizador se reinicia.
//  3. Si un ESPECIALISTA responde, el seguimiento se cancela (ya hay humano).
//  4. Un cron externo (cron-job.org, Vercel Cron, etc.) llama cada hora a
//     GET /api/cron/followup y este módulo envía los vencidos.
//  5. Si tras MAX_FOLLOWUP_ATTEMPTS intentos el paciente no responde,
//     se marca la conversación como needsHuman para que un humano la tome.
//
// Todo persiste en db.json: si el servidor se reinicia, los
// seguimientos programados NO se pierden.
// ============================================================
const { CLINICA, cfg } = require('../config');
const { sendText } = require('./send');
const db = require('../db');

function textoSeguimiento(nombre, topic, intento) {
  const n = nombre ? ` ${nombre}` : '';
  const C = CLINICA;
  if (intento <= 1) {
    return (
      `Hola${n} 💙💚, le escribe de nuevo *${C.nombre}*.\n` +
      `Ayer nos escribió sobre *${topic}* y no queremos dejarle sin respuesta 🙏.\n` +
      `¿Le podemos ayudar en algo? Estamos para servirle: ${C.whatsapp}.`
    );
  }
  return (
    `Hola${n} 💙💚, pasamos de nuevo por aquí porque nos importa atenderle bien 🙏.\n` +
    `Si necesita información de nuestros servicios, horarios o agendar una cita, ` +
    `con gusto le ayudamos. ¡Que tenga bonito día!\n` +
    `*${C.nombre}* — ${C.whatsapp}`
  );
}

/** Programa (o reprograma) el seguimiento 24h para una conversación. */
function programar(conversationId, { intent, topic, questionText }) {
  return db.scheduleFollowup({
    conversationId,
    intent,
    topic,
    questionText,
    delayHours: cfg.followupDelayHours,
  });
}

/** Cancela seguimientos pendientes (los llama el webhook y el panel). */
function cancelar(conversationId, motivo) {
  return db.cancelFollowups(conversationId, motivo);
}

/**
 * Ejecuta los seguimientos vencidos. La llama el endpoint /api/cron/followup.
 * Devuelve un resumen de lo procesado.
 */
async function ejecutarVencidos() {
  const vencidos = db.dueFollowups();
  const resumen = { revisados: vencidos.length, enviados: 0, agotados: 0, errores: 0 };

  for (const f of vencidos) {
    const conv = db.getConversation(f.conversationId);
    if (!conv) {
      f.status = 'cancelled';
      f.cancelReason = 'conversación no existe';
      db.save();
      continue;
    }
    // Seguridad: si un humano tomó la conversación o el bot está pausado, no insistir.
    if (conv.botPaused) {
      f.status = 'cancelled';
      f.cancelReason = 'bot pausado';
      db.save();
      continue;
    }

    const intento = (f.attempts || 0) + 1;
    try {
      const texto = textoSeguimiento(conv.name, f.topic, intento);
      const metaId = await sendText(conv.waId, texto);
      db.addMessage({
        conversationId: conv.id,
        waId: conv.waId,
        sender: 'BOT',
        type: 'text',
        text: texto,
        metaId,
        status: 'sent',
        flags: { followup: true, attempt: intento },
      });
      f.attempts = intento;
      resumen.enviados++;

      if (intento < cfg.maxFollowupAttempts) {
        // Se reprograma para dentro de otras 24h (insistencia).
        f.scheduledAt = new Date(
          Date.now() + cfg.followupDelayHours * 3600 * 1000
        ).toISOString();
        f.status = 'pending';
      } else {
        // Se agotó la insistencia automática: lo toma un humano.
        f.status = 'exhausted';
        db.setNeedsHuman(conv.id, true);
        resumen.agotados++;
      }
      db.save();
    } catch (e) {
      console.error('[followup] error enviando seguimiento:', e.message);
      f.status = 'pending'; // se reintenta en la próxima corrida del cron
      f.lastError = e.message;
      db.save();
      resumen.errores++;
    }
  }
  return resumen;
}

module.exports = { programar, cancelar, ejecutarVencidos, textoSeguimiento };
