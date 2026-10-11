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

// ---- Datos reales de la clínica (una sola fuente de verdad) ----
const CLINICA = {
  nombre: 'Clínica Hispana VidaPlus',
  direccion: '3068 Forest Ln Ste 121, Dallas TX 75234',
  whatsapp: '(945) 301-6982',
  zonaHoraria: 'America/Chicago',
  // Texto de horario que se usa en las respuestas automáticas.
  horarioTexto:
    'lunes a sábado de 9:00 am a 12:00 am y domingos de 10:00 am a 5:00 pm',
  googleMapsUrl:
    'https://www.google.com/maps/search/?api=1&query=3068+Forest+Ln+Ste+121+Dallas+TX+75234',
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

  // --- Encuesta de reseña ---
  googleReviewUrl:
    process.env.GOOGLE_REVIEW_URL ||
    'https://www.google.com/maps/search/?api=1&query=Clinica+Hispana+VidaPlus+Dallas+TX',

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
 * ¿Está abierta la clínica ahora? (hora de Chicago)
 * Lun–Sáb 9:00–24:00, Dom 10:00–17:00.
 */
function clinicaAbiertaAhora(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: CLINICA.zonaHoraria,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(fecha);
  const get = (t) => partes.find((p) => p.type === t)?.value;
  const dia = get('weekday'); // Sun, Mon, ...
  const hora = parseInt(get('hour'), 10) % 24;
  if (dia === 'Sun') return hora >= 10 && hora < 17;
  return hora >= 9; // Lun–Sáb: 9:00 am – 12:00 am
}

/** Aviso corto según si está abierta o cerrada (para agregar a respuestas). */
function avisoApertura() {
  return clinicaAbiertaAhora()
    ? '✅ Ahorita estamos abiertos, ¡le esperamos!'
    : '🌙 Ahorita estamos cerrados, pero con gusto le atendemos en nuestro horario.';
}

module.exports = { CLINICA, cfg, clinicaAbiertaAhora, avisoApertura };
