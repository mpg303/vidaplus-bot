// ============================================================
// Volcado de datos que ABRE con «Necesito» y ya trae su
// elección de aire (falla real 2026-11-04 19:37, captura de
// Jesus): tras «Es para un driveway», Jesus mandó en UN solo
// mensaje «Necesito 100 yds / 3000 psi no aire / 3069 forest
// ln suite 121 Dallas tx 75228 / 04:00 am jobsite / Slump 5»
// y el bot anotó yardas, mix, dirección, hora y slump, pero
// NO el aire: dio la explicación larga de las «burbujitas»
// y volvió a preguntar «¿Su concreto lo necesita con aire o
// no aire?». Causa raíz: el detector de CONSEJO sobre el aire
// marcaba como «pregunta» todo mensaje que ABRE con el verbo
// «necesito» y menciona «aire» más adelante — el volcado
// abría con «Necesito» y su «no aire» (una RESPUESTA) se
// leía como consulta. Arreglo: la elección explícita de aire
// («no aire», «sin aire», «con aire», «no air»…) sin signo
// de interrogación MANDA sobre el detector de consejo: se
// captura el dato y el flujo avanza. Con «?» («¿lo necesito
// con aire o no aire?») y en las consultas reales («¿mi
// garaje necesitará aire?») el consejo sigue vivo.
// Correr: node tests/defecto-aire-volcado.test.js
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jmp-aire-volcado-test-'));
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.SUPABASE_ANON_KEY;

const db = require('../src/db');
const bot = require('../src/services/autoReply');

let ok = 0;
let total = 0;
const fallos = [];
function check(nombre, cond, extra = '') {
  total++;
  if (cond) ok++;
  else fallos.push(`${nombre}${extra ? ` — ${extra}` : ''}`);
}
function turno(conv, texto) {
  const d = bot.decidirRespuesta(conv, texto);
  return { d, conv: db.getConversation(conv.id) || conv };
}
function nuevaConv(waId, name) {
  return db.upsertConversation(waId, name);
}

const VOLCADO =
  'Necesito 100 yds\n3000 psi no aire\n3069 forest ln suite 121 Dallas tx 75228\n04:00 am jobsite\nSlump 5';

// --- Unidad: el detector de consejo ya no roba la respuesta ---
check('Unidad: el volcado de Jesus NO es pregunta sobre el aire',
  bot.preguntaSobreAire(VOLCADO) === null);
check('Unidad: «Necesito el concreto con aire» es respuesta, no consulta',
  bot.preguntaSobreAire('Necesito el concreto con aire') === null);
check('Unidad: volcado EN con «no air» tampoco es consulta',
  bot.preguntaSobreAire('I need 100 yds, 3000 psi no air, 3069 Forest Ln Dallas TX') === null);
check('Unidad: «¿qué es el aire?» SIGUE siendo pregunta',
  bot.preguntaSobreAire('¿qué es el aire?') === 'es');
check('Unidad: «¿mi garaje necesitará aire?» SIGUE siendo consulta (caso 2026-10-22)',
  bot.preguntaSobreAire('¿mi garaje necesitará aire? Es cerrado bajo techo') === 'es');
check('Unidad: «¿lo necesito con aire o no aire?» SIGUE siendo pregunta (trae «?»)',
  bot.preguntaSobreAire('¿lo necesito con aire o no aire?') === 'es');

// --- Guion exacto de la captura de Jesus (2026-11-04 19:37) ---
{
  let conv = nuevaConv('50000000001', 'Jesus Prueba');
  let r = turno(conv, 'Hola, necesito concreto'); conv = r.conv;
  r = turno(conv, 'Es para un driveway'); conv = r.conv;
  r = turno(conv, VOLCADO); conv = r.conv;
  const texto = r.d.texto || '';
  const datos = (conv.flow && conv.flow.datos) || {};
  check('Captura: el aire quedó ANOTADO como «no aire»',
    datos.aire === 'no aire', JSON.stringify(datos));
  check('Captura: la respuesta confirma el aire anotado',
    texto.includes('concreto *no aire*'), texto);
  check('Captura: SIN la explicación larga de las burbujitas',
    !texto.includes('burbujitas'), texto);
  check('Captura: NO vuelve a preguntar «¿Su concreto lo necesita con aire o no aire?»',
    !texto.includes('lo necesita con aire o no aire'), texto);
  check('Captura: yardas, mix, dirección, hora y slump quedaron anotados',
    String((datos.yardas && datos.yardas.cantidad) || datos.yardas) === '100' && /3000/.test(String(datos.mix || '')) &&
      String(datos.direccion || '').includes('3069') && !!datos.hora &&
      String(datos.slump) === '5',
    JSON.stringify(datos));
  check('Captura: el flujo AVANZA a la siguiente pregunta (la pompa), no se queda en el aire',
    /pompa|pump/i.test(texto), texto);
}

// --- La consulta real sobre el aire sigue explicándose ---
{
  let conv = nuevaConv('50000000002', 'Cliente Garaje');
  let r = turno(conv, 'Hola, necesito concreto'); conv = r.conv;
  r = turno(conv, '¿Mi garaje necesitará aire? Es cerrado bajo techo'); conv = r.conv;
  const texto = r.d.texto || '';
  check('Consulta real: el bot SÍ explica el aire y recomienda para su caso',
    texto.includes('burbujitas') && texto.includes('sin aire'), texto);
  check('Consulta real: la palabra suelta no se capturó como dato de aire',
    !conv.flow || !conv.flow.datos.aire, JSON.stringify(conv.flow && conv.flow.datos));
}

console.log(`\n${ok}/${total} chequeos OK`);
if (fallos.length) {
  console.log('FALLOS:');
  for (const f of fallos) console.log(' -', f);
  process.exit(1);
}
