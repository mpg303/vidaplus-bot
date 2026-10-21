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
  // El negocio se anuncia 24/7 (así lo dice su sitio): la respuesta
  // de horario debe decir la verdad — 24/7, todos los días.
  horarioTexto: '24/7, todos los días',
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
  autoreplyHumanPauseMin: parseInt(process.env.AUTOREPLY_HUMAN_PAUSE_MIN || '2', 10),

  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),

  // --- Persistencia permanente (Supabase) ---
  // Tabla propia de JMP (public.jmp_state) en el proyecto Supabase
  // existente; el estado completo del bot vive ahí y NUNCA se pierde
  // con los reinicios de Render. Si faltan estas variables, db.js
  // cae de vuelta al db.json local (comportamiento anterior).
  // La service key manda; si no está, se usa la anon key (la tabla
  // tiene política RLS que la permite solo para esta tabla).
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey:
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '',
  supabaseTable: process.env.SUPABASE_TABLE || 'jmp_state',
  supabaseStateName: process.env.SUPABASE_STATE_NAME || 'bot_db',
};

/**
 * ¿Está el negocio en horario ahora? El negocio trabaja 24/7
 * (así se anuncia en su sitio), así que siempre está en horario,
 * domingo incluido.
 */
function negocioAbiertoAhora(fecha = new Date()) {
  return true;
}

/** Aviso corto según si está en horario o no (para agregar a respuestas). */
function avisoApertura() {
  return '✅ Estamos en horario (24/7), ¡escríbanos cuando guste!';
}

module.exports = { NEGOCIO, cfg, negocioAbiertoAhora, avisoApertura };
