// ============================================================
// Respuestas automáticas del bot (intents básicos en español).
// Todo el texto visible al paciente está en español y usa los datos
// reales de la clínica definidos en config.js (CLINICA).
// ============================================================
const { CLINICA, avisoApertura } = require('../config');
const db = require('../db');
const { cfg } = require('../config');

// ---- Normalización: minúsculas y sin acentos para comparar ----
function normalizar(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// ---- Definición de intents por palabras clave ----
const INTENTS = [
  {
    id: 'humano',
    topic: 'hablar con un especialista',
    keywords: [
      'hablar con alguien', 'quiero hablar', 'una persona', 'humano',
      'agente', 'asesor', 'operador', 'alguien que me atienda',
      'me atienda alguien', 'persona real',
    ],
  },
  {
    id: 'emergencia',
    topic: 'una emergencia',
    keywords: [
      'emergencia', 'urgencia', 'urgente', 'me siento mal',
      'dolor fuerte', 'accidente', 'ayuda urgente',
    ],
  },
  {
    id: 'horario',
    topic: 'los horarios',
    keywords: [
      'horario', 'hora abren', 'hora cierran', 'abren', 'cierran',
      'abierto', 'cerrado', 'a que hora', 'qué días', 'que dias',
      'fines de semana', 'domingo',
    ],
  },
  {
    id: 'precio',
    topic: 'los precios',
    keywords: [
      'precio', 'costo', 'cuanto cuesta', 'cuánto cuesta',
      'tarifa', 'cobran', 'vale', 'presupuesto',
    ],
  },
  {
    id: 'cita',
    topic: 'agendar una cita',
    keywords: [
      'cita', 'agendar', 'reservar', 'apartar', 'consulta',
      'quiero ir', 'cuando puedo ir', 'disponibilidad', 'turno',
    ],
  },
  {
    id: 'ubicacion',
    topic: 'cómo llegar a la clínica',
    keywords: [
      'donde', 'dónde', 'direccion', 'dirección', 'ubicacion',
      'ubicación', 'como llego', 'cómo llego', 'llegar',
    ],
  },
  {
    id: 'servicios',
    topic: 'nuestros servicios',
    keywords: [
      'servicio', 'ofrecen', 'hacen', 'atienden', 'especialidad',
      'especialidades', 'doctor', 'doctora', 'ultrasonido',
      'examen', 'chequeo',
    ],
  },
  {
    id: 'gracias',
    topic: 'un agradecimiento',
    keywords: ['gracias', 'thank you', 'mil gracias', 'te agradezco'],
  },
  {
    id: 'adios',
    topic: 'una despedida',
    keywords: ['adios', 'adiós', 'bye', 'nos vemos', 'hasta luego', 'chao'],
  },
  {
    id: 'saludo',
    topic: 'su saludo',
    keywords: [
      'hola', 'buenas', 'buenos dias', 'buenas tardes',
      'buenas noches', 'hey', 'saludos', 'que tal', 'qué tal',
    ],
  },
];

/** Detecta el intent de un mensaje del paciente. */
function detectarIntent(texto) {
  const t = ` ${normalizar(texto)} `;
  for (const intent of INTENTS) {
    if (intent.keywords.some((k) => t.includes(normalizar(k)))) {
      return intent;
    }
  }
  return { id: 'otro', topic: 'su mensaje', keywords: [] };
}

/** Construye la respuesta en español para cada intent. */
function construirRespuesta(intentId, nombre) {
  const n = nombre && nombre !== '' ? ` ${nombre}` : '';
  const C = CLINICA;
  switch (intentId) {
    case 'saludo':
      return (
        `¡Hola${n}! 👋 Bienvenido(a) a *${C.nombre}* 💙💚.\n` +
        `¿En qué le podemos ayudar hoy? Puede preguntarnos por nuestros ` +
        `*horarios*, *servicios*, *precios*, *citas* o *ubicación*.`
      );
    case 'horario':
      return (
        `Nuestro horario es:\n` +
        `📅 Lunes a sábado: 9:00 am – 12:00 am\n` +
        `📅 Domingos: 10:00 am – 5:00 pm\n\n` +
        `${avisoApertura()}`
      );
    case 'servicios':
      return (
        `En *${C.nombre}* le atendemos con calidez 💙💚: medicina general, ` +
        `ultrasonidos y otros servicios de salud para toda la familia.\n` +
        `¿Qué necesita? Con gusto le orientamos.`
      );
    case 'precio':
      return (
        `Los precios varían según el servicio que necesite. ` +
        `¿Qué servicio le interesa? Con gusto le confirmamos el costo 💙💚.`
      );
    case 'cita':
      return (
        `Con gusto le agendamos su cita 📅.\n` +
        `Díganos qué día y a qué hora le queda mejor y un especialista se la confirma ` +
        `por aquí mismo. También puede llamarnos al ${C.whatsapp}.`
      );
    case 'ubicacion':
      return `Estamos en 📍 *${C.direccion}*.\n${C.googleMapsUrl}`;
    case 'humano':
      return (
        `Con gusto 🙏. Un especialista le atenderá en breve por este mismo chat. ` +
        `Gracias por su paciencia.`
      );
    case 'emergencia':
      return (
        `Si es una emergencia médica, por favor llame al *911* de inmediato 🚨.\n` +
        `Para atención en la clínica, escríbanos o llámenos al ${C.whatsapp}.`
      );
    case 'gracias':
      return (
        `¡Con mucho gusto${n}! 💙💚 Estamos para servirle.\n` +
        `Recuerde que trabajamos de lunes a sábado de 9:00 am a 12:00 am ` +
        `y los domingos de 10:00 am a 5:00 pm.`
      );
    case 'adios':
      return (
        `¡Gracias por escribirnos${n}! 💙💚 Que tenga un excelente día. ` +
        `Aquí estamos cuando nos necesite.`
      );
    default:
      return (
        `Gracias por escribir a *${C.nombre}* 💙💚.\n` +
        `¿En qué le podemos ayudar? Puede preguntarnos por *horarios*, ` +
        `*servicios*, *precios*, *citas* o *ubicación*.`
      );
  }
}

/**
 * Decide si el bot debe responder a un mensaje entrante del cliente.
 * NO responde si:
 *  - el bot está pausado para esa conversación (lo atiende un humano), o
 *  - un ESPECIALISTA respondió hace menos de AUTOREPLY_HUMAN_PAUSE_MIN minutos
 *    (para no interrumpir la conversación humana).
 * Devuelve { responder, texto, intent, topic, motivo }.
 */
function decidirRespuesta(conversacion, textoCliente) {
  if (conversacion.botPaused) {
    return { responder: false, motivo: 'bot pausado por especialista' };
  }
  const ultimoHumano = db.lastMessageFrom(conversacion.id, 'ESPECIALISTA');
  if (ultimoHumano) {
    const minutos = (Date.now() - new Date(ultimoHumano.timestamp).getTime()) / 60000;
    if (minutos < cfg.autoreplyHumanPauseMin) {
      return { responder: false, motivo: 'especialista activo recientemente' };
    }
  }
  const intent = detectarIntent(textoCliente);
  const texto = construirRespuesta(intent.id, conversacion.name);
  return { responder: true, texto, intent: intent.id, topic: intent.topic };
}

module.exports = { detectarIntent, construirRespuesta, decidirRespuesta };
