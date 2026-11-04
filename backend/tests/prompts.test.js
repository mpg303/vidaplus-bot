// ============================================================
// Pruebas de la sección «🧩 Prompts» del panel (orden del dueño
// 2026-11-03): instalar prompts con nombre, ver los instalados,
// activar UNO a la vez para probarlo, editar y borrar; y de la
// capa services/iaPrompts.js (espejo de la de la clínica):
// - sin clave IA devuelve null SIEMPRE (los prompts quedan
//   instalados pero el bot no los usa);
// - con clave pero SIN prompt activo devuelve null;
// - la validación de salida rechaza cualquier monto $ que no
//   exista en los datos verificados de autoReply (PRECIOS_MIX).
// Correr: node tests/prompts.test.js
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jmp-prompts-test-'));
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.IA_API_KEY; // la suite arranca SIN clave, como producción hoy

const db = require('../src/db');
const { cfg } = require('../src/config');
const ia = require('../src/services/iaPrompts');

let ok = 0;
let total = 0;
const fallos = [];
function check(nombre, cond, extra = '') {
  total++;
  if (cond) ok++;
  else fallos.push(`${nombre}${extra ? ` — ${extra}` : ''}`);
}

(async () => {
  // ---------- Estado y CRUD de prompts (db.js) ----------
  check('el estado nace con prompts como arreglo', Array.isArray(db.load().prompts));
  check('sin prompts instalados al inicio', db.listPrompts().length === 0);
  check('sin prompt activo al inicio', db.getPromptActivo() === null);

  const p1 = db.createPrompt({ nombre: 'Construcción v1', texto: 'Responde como experto en construcción.' });
  check('crear devuelve el prompt con id', Boolean(p1 && p1.id));
  check('el prompt nace INACTIVO', p1.activo === false);
  check('crear guarda nombre y texto', p1.nombre === 'Construcción v1' && p1.texto.includes('experto'));
  check('crear fija creadoEn', Boolean(p1.creadoEn));

  const p2 = db.createPrompt({ nombre: 'Construcción v2', texto: 'Otro prompt de prueba.' });
  check('la lista muestra los dos instalados', db.listPrompts().length === 2);

  const editado = db.updatePrompt(p1.id, { nombre: 'Construcción v1 (editado)', texto: 'Texto nuevo.' });
  check('editar cambia nombre y texto', editado.nombre === 'Construcción v1 (editado)' && editado.texto === 'Texto nuevo.');
  check('editar un id inexistente devuelve null', db.updatePrompt('no-existe', { nombre: 'x' }) === null);

  // ---------- Activar: uno solo a la vez ----------
  db.setPromptActivo(p1.id);
  let lista = db.listPrompts();
  check('activar p1 deja solo p1 activo', lista.filter((p) => p.activo).length === 1 && db.getPromptActivo().id === p1.id);
  db.setPromptActivo(p2.id);
  lista = db.listPrompts();
  check('activar p2 apaga p1 (un solo activo)', lista.filter((p) => p.activo).length === 1 && db.getPromptActivo().id === p2.id);
  check('activar un id inexistente devuelve null', db.setPromptActivo('no-existe') === null);
  db.setPromptInactivo(p2.id);
  check('desactivar deja ninguno activo', db.getPromptActivo() === null);

  // ---------- Borrar ----------
  check('borrar un prompt existente devuelve true', db.deletePrompt(p1.id) === true);
  check('la lista baja a uno tras borrar', db.listPrompts().length === 1);
  check('borrar el mismo id otra vez devuelve false', db.deletePrompt(p1.id) === false);

  // ---------- La capa sin clave: apagada ----------
  check('sin clave IA la capa está apagada', ia.iaActiva() === false);
  db.setPromptActivo(p2.id);
  ia.invalidarCachePrompts();
  const sinClave = await ia.responderConPromptActivo({ texto: '¿Tienen servicio de pompa?', idioma: 'es' });
  check('sin clave devuelve null aunque haya prompt activo', sinClave === null);

  // ---------- Puerta de entrada: solo «otro» y texto ----------
  check('debeConsultarIA acepta otro+text', ia.debeConsultarIA({ responder: true, intent: 'otro' }, 'text') === true);
  check('debeConsultarIA rechaza otros intents', ia.debeConsultarIA({ responder: true, intent: 'cotizacion' }, 'text') === false);
  check('debeConsultarIA rechaza mensajes no texto', ia.debeConsultarIA({ responder: true, intent: 'otro' }, 'audio') === false);
  check('debeConsultarIA rechaza decisiones sin responder', ia.debeConsultarIA({ responder: false, intent: 'otro' }, 'text') === false);

  // ---------- Validación de la salida ----------
  check('la validación acepta un precio verificado ($165)', ia.validarRespuestaIA('El mix 3500 psi cuesta $165 por yarda en Dallas.') !== null);
  check('la validación RECHAZA un precio inventado ($999)', ia.validarRespuestaIA('El mix cuesta $999 por yarda.') === null);
  check('la validación rechaza la marca SIN_PROMPT', ia.validarRespuestaIA(ia.MARCA_SIN_PROMPT) === null);
  check('la validación rechaza textos de más de 700 caracteres', ia.validarRespuestaIA('x'.repeat(701)) === null);
  check('la validación rechaza texto vacío', ia.validarRespuestaIA('   ') === null);

  // ---------- Base de conocimiento: sale de autoReply ----------
  const base = ia.baseConocimientoTexto();
  check('la base trae los precios verificados ($160 y $180)', base.includes('$160') && base.includes('$180'));
  check('la base trae los taxes del 8.25%', base.includes('8.25'));
  check('la base trae el proceso de orden', base.toLowerCase().includes('método de pago'));

  // ---------- Con clave falsa y transporte inyectado ----------
  cfg.iaApiKey = 'clave-de-prueba';
  check('con clave la capa se marca activa', ia.iaActiva() === true);

  db.setPromptInactivo(p2.id);
  ia.invalidarCachePrompts();
  ia.fijarTransporte(async () => 'Respuesta que no debería salir.');
  const sinActivo = await ia.responderConPromptActivo({ texto: 'hola', idioma: 'es' });
  check('con clave pero SIN prompt activo devuelve null', sinActivo === null);

  db.setPromptActivo(p2.id);
  ia.invalidarCachePrompts();
  ia.fijarTransporte(async () => 'Claro: el mix 3000 psi cuesta $160 por yarda en Dallas.');
  const buena = await ia.responderConPromptActivo({ texto: '¿Cuánto el 3000?', idioma: 'es' });
  check('con prompt activo y salida válida responde', Boolean(buena && buena.texto.includes('$160')));

  ia.fijarTransporte(async () => 'El precio especial es $999 por yarda.');
  const inventado = await ia.responderConPromptActivo({ texto: '¿Precio?', idioma: 'es' });
  check('una salida con precio inventado se descarta (null)', inventado === null);

  ia.fijarTransporte(async () => ia.MARCA_SIN_PROMPT);
  const noAplica = await ia.responderConPromptActivo({ texto: 'algo fuera del prompt', idioma: 'es' });
  check('si el prompt no aplica (marca) devuelve null', noAplica === null);

  ia.fijarTransporte(async () => { throw new Error('proveedor caído'); });
  const caido = await ia.responderConPromptActivo({ texto: 'hola', idioma: 'es' });
  check('si el proveedor falla devuelve null (el bot sigue como hoy)', caido === null);

  // Los mensajes al proveedor llevan el prompt activo y la base verificada.
  let mensajesVistos = null;
  ia.fijarTransporte(async (mensajes) => { mensajesVistos = mensajes; return 'Ok, anotado.'; });
  await ia.responderConPromptActivo({ texto: 'mensaje del cliente', idioma: 'es' });
  check('el sistema lleva el texto del prompt activo', Boolean(mensajesVistos && mensajesVistos[0].content.includes('Otro prompt de prueba.')));
  check('el sistema lleva la base verificada', Boolean(mensajesVistos && mensajesVistos[0].content.includes('$160')));

  // Limpieza: la suite no deja la capa encendida.
  ia.fijarTransporte(null);
  cfg.iaApiKey = '';
  check('al final la capa queda apagada de nuevo', ia.iaActiva() === false);

  console.log(`\nPROMPTS: ${ok}/${total} pruebas OK`);
  if (fallos.length) {
    console.log('FALLOS:');
    for (const f of fallos) console.log(' -', f);
    process.exit(1);
  }
})().catch((e) => {
  console.error('Error corriendo la suite de prompts:', e);
  process.exit(1);
});
