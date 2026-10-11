// ============================================================
// Configuración central del backend.
// Lee las variables de entorno (ver proyecto/.env.example) y
// expone los datos reales del negocio en un solo lugar.
// ============================================================
const path = require('path');

// Carga el .env que vive en la raíz del proyecto (proyecto/.env).
// En producción (Render/Railway/VPS) las variables se definen en el
// panel del proveedor; dotenv simplemente no encuentra archivo y no hace nada.
// El try/catch permite usar los módulos de lógica sin tener dotenv instalado.
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
} catch {
  /* dotenv no instalado: se usan las variables de entorno del sistema */
}

// ---- Datos reales del negocio (una sola fuente de verdad) ----
const NEGOCIO = {
  nombre: 'JMP Concrete and Dispatch LLC',
  nombreCorto: 'JMP Concrete',
  whatsapp: '(786) 366-2018',
  email: 'jmpconcreteanddispatchllc@gmail.com',
  zona: 'Dallas–Fort Worth, TX y alrededores',
  zonaHoraria: 'America/Chicago',
  // Texto de horario que se usa en las respuestas automáticas.
  horarioTexto: 'lunes a sábado',
};

const cfg = {
  port: parseInt(process.env.PORT || '3000', 10),

  // --- WhatsApp Cloud API (Meta) ---
  metaVerifyToken: process.env.META_VERIFY_TOKEN || '',
  metaAccessToken: process.env.META_ACCESS_TOKEN || '',
  metaPhoneNumberId: process.env.META_PHONE_NUMBER_ID || '',
  metaAppSecret: process.env.META_APP_SECRET || '', // opcional: verifica firma del webhook
  wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
  graphVersion: process.env.META_GRAPH_VERSION || 'v22.0',

  // --- Panel (login básico) ---
  panelUser: process.env.PANEL_USER || 'admin',
  panelPass: process.env.PANEL_PASS || '',

  // --- Motor de seguimiento 24h ---
  cronSecret: process.env.CRON_SECRET || '',
  followupDelayHours: parseFloat(process.env.FOLLOWUP_DELAY_HOURS || '24'),
  maxFollowupAttempts: parseInt(process.env.MAX_FOLLOWUP_ATTEMPTS || '2', 10),

  // Si un humano (ESPECIALISTA) respondió hace menos de estos minutos,
  // el bot NO interrumpe con respuestas automáticas.
  autoreplyHumanPauseMin: parseInt(process.env.AUTOREPLY_HUMAN_PAUSE_MIN || '30', 10),

  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
};

/**
 * ¿Está el negocio en horario ahora? (hora de Chicago)
 * Lun–Sáb se considera horario de trabajo; domingo cerrado.
 */
function negocioAbiertoAhora(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: NEGOCIO.zonaHoraria,
    weekday: 'short',
  }).formatToParts(fecha);
  const dia = partes.find((p) => p.type === 'weekday')?.value; // Sun, Mon, ...
  return dia !== 'Sun';
}

/** Aviso corto según si está en horario o no (para agregar a respuestas). */
function avisoApertura() {
  return negocioAbiertoAhora()
    ? '✅ Ahorita estamos en horario, ¡escríbanos!'
    : '🌙 Hoy domingo estamos cerrados, pero déjenos su mensaje y le atendemos.';
}

module.exports = { NEGOCIO, cfg, negocioAbiertoAhora, avisoApertura };
