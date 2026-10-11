// ============================================================
// Campañas masivas por plantillas aprobadas de Meta.
// A diferencia del botón muerto de Axxel, este endpoint SÍ envía:
// crea la campaña, recorre los destinatarios en lotes con pausa
// entre mensajes (para respetar los límites de Meta) y guarda el
// estado por destinatario (pendiente / enviado / error).
//
// IMPORTANTE (política de Meta): las plantillas de MARKETING a
// números de EE.UU. están pausadas por Meta desde abril 2025.
// Las plantillas de UTILIDAD (recordatorios, encuestas) y de
// AUTENTICACIÓN sí funcionan. Este módulo envía la plantilla que
// se le indique; la categoría la define la plantilla aprobada.
// ============================================================
const { sendTemplate } = require('./send');
const db = require('../db');

// Pausa entre mensajes para no golpear el límite de la API (ms).
const PAUSA_ENTRE_MENSAJES_MS = 600;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Crea una campaña y la envía en segundo plano (no bloquea la respuesta HTTP).
 * @param {Object} opts
 * @param {string} opts.name - nombre interno de la campaña
 * @param {string} opts.templateName - plantilla aprobada en Meta
 * @param {string} opts.language - idioma de la plantilla ('es')
 * @param {Array<{phone:string,name?:string}>} opts.recipients
 * @param {Array} opts.components - parámetros de la plantilla (se aplican igual a todos;
 *   para personalizar por destinatario, usar {{1}} con el nombre vía components dinámicos —
 *   ver README para el formato)
 * @param {Function} opts.buildComponents - opcional: (recipient) => components
 */
function crearYEnviar({ name, templateName, language = 'es', recipients, components = [], buildComponents = null }) {
  if (!name || !templateName) throw new Error('name y templateName son obligatorios.');
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error('recipients debe ser una lista no vacía.');
  }

  const camp = db.createCampaign({ name, templateName, language, recipients });

  // Envío en segundo plano para responder rápido al panel.
  setImmediate(() => enviarLote(camp.id, { templateName, language, components, buildComponents }));

  return camp;
}

async function enviarLote(campaignId, { templateName, language, components, buildComponents }) {
  const camp = db.getCampaign(campaignId);
  if (!camp) return;

  let errores = 0;
  for (const r of camp.recipients) {
    // Permite cancelar a mitad del envío desde el panel.
    const actual = db.getCampaign(campaignId);
    if (!actual || actual.status === 'cancelada') return;

    try {
      const comps = buildComponents ? buildComponents(r) : components;
      const metaId = await sendTemplate(r.phone, templateName, language, comps);
      db.updateRecipient(campaignId, r.phone, {
        status: 'enviado',
        sentAt: new Date().toISOString(),
        metaId,
      });
    } catch (e) {
      errores++;
      db.updateRecipient(campaignId, r.phone, { status: 'error', error: e.message });
      console.error(`[campaign] error con ${r.phone}:`, e.message);
    }
    await sleep(PAUSA_ENTRE_MENSAJES_MS);
  }

  db.setCampaignStatus(
    campaignId,
    errores === 0 ? 'completada' : 'completada_con_errores'
  );
  console.log(`[campaign] ${campaignId} terminada con ${errores} errores.`);
}

function cancelar(campaignId) {
  db.setCampaignStatus(campaignId, 'cancelada');
}

module.exports = { crearYEnviar, cancelar };
