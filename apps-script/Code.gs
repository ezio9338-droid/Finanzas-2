/**
 * @OnlyCurrentDoc  ← el script solo puede acceder a ESTA hoja, no al resto de tu Drive.
 */
/**
 * Hucha · servidor en Google Apps Script
 *
 * Archivos de este proyecto de Apps Script:
 *   Code.gs   → este archivo
 *   Core.gs   → copia exacta de js/core.js del repositorio
 *   Datos.gs  → (opcional) gastos fijos iniciales, NO está en el repositorio público
 *
 * Primer uso: ejecuta la función `instalar` una vez (▶ Ejecutar) y acepta los permisos.
 * Después: Implementar → Nueva implementación → Aplicación web
 *          (Ejecutar como: yo · Quién tiene acceso: Cualquier usuario).
 */

var ZONA = 'Europe/Madrid';
var API_VERSION = 3; // 2: emoji propio en los gastos fijos · 3: devoluciones

var HOJAS = {
  Movimientos: {
    cols: [
      ['id', 'ID'], ['fecha', 'Fecha'], ['tipo', 'Tipo'], ['importe', 'Importe'], ['cuenta', 'Cuenta'], ['destino', 'Cuenta destino'],
      ['cat', 'Categoría'], ['sub', 'Subcategoría'], ['concepto', 'Concepto'], ['miParte', 'Mi parte'],
      ['pagaDeuda', 'Salda deuda de'], ['previsto', 'Partida de previsión'], ['prevImporte', 'Importe previsto'], ['act', 'Actualizado'],
      ['devuelto', 'Devuelto'], ['fechaDevuelto', 'Fecha devolución']
    ],
    fechas: ['fecha', 'fechaDevuelto'], dinero: ['importe', 'miParte', 'prevImporte', 'devuelto'], bool: [], meses: []
  },
  Deudas: {
    cols: [['id', 'ID'], ['movId', 'Movimiento'], ['fecha', 'Fecha'], ['persona', 'Persona'], ['importe', 'Importe'], ['concepto', 'Concepto']],
    fechas: ['fecha'], dinero: ['importe'], bool: [], meses: []
  },
  Previsiones: {
    cols: [['id', 'ID'], ['mes', 'Mes'], ['concepto', 'Concepto'], ['importe', 'Importe previsto'], ['cat', 'Categoría'], ['sub', 'Subcategoría']],
    fechas: [], dinero: ['importe'], bool: [], meses: ['mes']
  },
  Fijos: {
    cols: [
      ['id', 'ID'], ['concepto', 'Concepto'], ['tipo', 'Tipo'], ['importe', 'Importe'], ['cat', 'Categoría'], ['sub', 'Subcategoría'],
      ['frecuencia', 'Frecuencia'], ['dia', 'Día del mes'], ['cada', 'Cada (días)'], ['desde', 'Último pago'], ['activo', 'Activo'], ['orden', 'Orden'], ['icono', 'Emoji']
    ],
    fechas: ['desde'], dinero: ['importe'], bool: ['activo'], meses: []
  },
  Categorias: {
    cols: [['cat', 'Categoría'], ['sub', 'Subcategoría'], ['tipo', 'Tipo'], ['icono', 'Icono']],
    fechas: [], dinero: [], bool: [], meses: []
  },
  Ahorro: {
    cols: [['mes', 'Mes'], ['objetivo', 'Objetivo'], ['intereses', 'Intereses'], ['interesesOk', 'Intereses recibidos'], ['estado', 'Ahorro cumplido']],
    fechas: [], dinero: ['objetivo', 'intereses'], bool: ['interesesOk'], meses: ['mes']
  },
  Debo: {
    cols: [['id', 'ID'], ['persona', 'Persona'], ['concepto', 'Concepto'], ['importe', 'Importe'], ['fecha', 'Fecha']],
    fechas: ['fecha'], dinero: ['importe'], bool: [], meses: []
  },
  Config: {
    cols: [['clave', 'Clave'], ['valor', 'Valor'], ['desc', 'Descripción']],
    fechas: [], dinero: [], bool: [], meses: []
  }
};

var DESC_CONFIG = {
  fechaInicio: 'Primer día que usa la app (los meses empiezan aquí)',
  fechaSaldo: 'Fecha de los saldos iniciales: los movimientos anteriores no cambian el saldo',
  saldoInicialSantander: 'Saldo de la cuenta Santander en la fecha de los saldos iniciales',
  saldoInicialTrade: 'Saldo de Trade Republic en la fecha de los saldos iniciales',
  objetivoAhorro: 'Objetivo de ahorro mensual (se puede cambiar mes a mes en la app)',
  tae1: 'TAE % de Trade Republic hasta el límite',
  tae2: 'TAE % de Trade Republic por encima del límite',
  limiteTae: 'Límite del primer tramo de TAE (€)',
  retencion: 'Retención sobre los intereses (%)'
};
var NUM_CONFIG = ['saldoInicialSantander', 'saldoInicialTrade', 'objetivoAhorro', 'tae1', 'tae2', 'limiteTae', 'retencion'];

// ---------------------------------------------------------------- Instalación

function instalar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(ZONA);
  var hoy = hoyISO();
  var datos = plantilla(hoy);
  if (typeof DATOS_INICIALES === 'function') {
    var p = DATOS_INICIALES(hoy) || {};
    if (p.fijos) datos.fijos = p.fijos;
    if (p.config) Object.keys(p.config).forEach(function (k) { datos.config[k] = p.config[k]; });
  }

  Object.keys(HOJAS).forEach(function (nombre) {
    var sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
    if (sh.getLastRow() === 0) {
      var spec = HOJAS[nombre];
      sh.getRange(1, 1, 1, spec.cols.length).setValues([spec.cols.map(function (c) { return c[1]; })])
        .setFontWeight('bold').setBackground('#7c6cf0').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
  });

  var st = leerEstado();
  if (!st.categorias.length) st.categorias = datos.categorias;
  if (!st.fijos.length) st.fijos = datos.fijos;
  Object.keys(datos.config).forEach(function (k) { if (st.config[k] === undefined) st.config[k] = datos.config[k]; });
  escribirTodo(st, { categorias: true, fijos: true, config: true });

  var hoja1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hoja1 && hoja1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(hoja1);

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CLAVE')) props.setProperty('CLAVE', claveAleatoria());
  try { props.setProperty('EMAIL', Session.getEffectiveUser().getEmail()); } catch (e) {}

  actualizarResumen(st);
  Logger.log('Hucha instalada. Tu clave secreta es: ' + props.getProperty('CLAVE'));
  try { ss.toast('Instalación completada. Ve al menú Hucha → Ver clave secreta.', 'Hucha ✅', 15); } catch (e) {}
}

function plantilla(hoy) {
  var mes = hoy.slice(0, 7);
  return {
    config: {
      fechaInicio: mes + '-01', fechaSaldo: hoy, saldoInicialSantander: 0, saldoInicialTrade: 0,
      objetivoAhorro: 1450, tae1: 3, tae2: 2.25, limiteTae: 50000, retencion: 19
    },
    categorias: HuchaCore.categoriasBase(),
    fijos: [
      { id: 'ahorro', concepto: 'Ahorro', tipo: 'ahorro', importe: '', cat: 'Ahorro', sub: 'Trade Republic', frecuencia: 'mensual', dia: 26, cada: '', desde: '', activo: true, orden: 99 }
    ]
  };
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Hucha')
    .addItem('Actualizar resumen', 'actualizarResumenMenu')
    .addItem('Ver clave secreta', 'verClave')
    .addItem('Cambiar clave secreta', 'nuevaClave')
    .addToUi();
}

function actualizarResumenMenu() { actualizarResumen(leerEstado()); }

function verClave() {
  SpreadsheetApp.getUi().alert('Clave secreta:\n' + PropertiesService.getScriptProperties().getProperty('CLAVE'));
}

function claveAleatoria() {
  // 2 UUID v4 → 244 bits aleatorios
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function nuevaClave() {
  var c = claveAleatoria();
  PropertiesService.getScriptProperties().setProperty('CLAVE', c);
  SpreadsheetApp.getUi().alert('Nueva clave (actualízala en la app, en Más → Conexión):\n' + c);
}

// ---------------------------------------------------------------- API web

function doGet() {
  return ContentService.createTextOutput('Hucha API funcionando. Usa la app para conectar.');
}

function doPost(e) {
  var res;
  try {
    var cuerpo = e && e.postData && e.postData.contents || '';
    if (cuerpo.length > 1000000) throw new Error('PETICION_INVALIDA');
    var req;
    try { req = JSON.parse(cuerpo); } catch (x) { throw new Error('PETICION_INVALIDA'); }
    var clave = PropertiesService.getScriptProperties().getProperty('CLAVE');
    if (!clave || !igualSeguro(String(req && req.clave || ''), clave)) {
      registrarFallo('Clave incorrecta');
      throw new Error('CLAVE_INCORRECTA');
    }
    var ops = validarOps(req.ops || []);
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var st = leerEstado();
      var antes = firma(st);
      HuchaCore.aplicarOps(st, ops);
      var despues = firma(st);
      var cambios = {};
      Object.keys(despues).forEach(function (k) { cambios[k] = despues[k] !== antes[k]; });
      escribirTodo(st, cambios);
      if (ops.length) actualizarResumen(st);
      res = { ok: true, version: API_VERSION, estado: st, hoy: hoyISO(), aplicadas: ops.length, seguridad: resumenSeguridad() };
    } finally { lock.releaseLock(); }
  } catch (err) {
    res = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- Seguridad

/** Comparación en tiempo constante (no revela cuántos caracteres coinciden). */
function igualSeguro(a, b) {
  var d = a.length ^ b.length;
  for (var i = 0; i < b.length; i++) d |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ b.charCodeAt(i);
  return d === 0;
}

function registrarFallo(motivo) {
  var props = PropertiesService.getScriptProperties(), ahora = Date.now();
  var lista = [];
  try { lista = JSON.parse(props.getProperty('FALLOS') || '[]'); } catch (x) {}
  lista.push(ahora);
  lista = lista.filter(function (t) { return ahora - t < 30 * 86400000; }).slice(-300);
  props.setProperty('FALLOS', JSON.stringify(lista));
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Seguridad') || ss.insertSheet('Seguridad');
    if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, 2).setValues([['Fecha y hora', 'Evento']]).setFontWeight('bold');
    sh.appendRow([new Date(), motivo]);
  } catch (x) {}
  var email = props.getProperty('EMAIL'), ultimo = +(props.getProperty('ULTIMO_EMAIL') || 0);
  if (email && ahora - ultimo > 3600000) {
    var dia = lista.filter(function (t) { return ahora - t < 86400000; }).length;
    try {
      MailApp.sendEmail(email, '⚠️ Hucha: intento de acceso con clave incorrecta',
        'Alguien ha intentado acceder a tu hoja de Hucha con una clave secreta incorrecta.\n\n' +
        'Intentos en las últimas 24 horas: ' + dia + '\n' +
        'Último: ' + Utilities.formatDate(new Date(ahora), ZONA, 'dd/MM/yyyy HH:mm') + '\n\n' +
        'Si no has sido tú (por ejemplo, al escribir mal la clave), te recomendamos:\n' +
        '1. Abrir la hoja → menú Hucha → Cambiar clave secreta.\n' +
        '2. Poner la nueva clave en la app (Más → Conexión).\n\n' +
        'Tus datos no se han enviado: sin la clave correcta la API no devuelve nada.\n' +
        'Solo recibirás un aviso como máximo cada hora.');
      props.setProperty('ULTIMO_EMAIL', String(ahora));
    } catch (x) {}
  }
  Utilities.sleep(1500); // frena los intentos automáticos
}

function resumenSeguridad() {
  var lista = [];
  try { lista = JSON.parse(PropertiesService.getScriptProperties().getProperty('FALLOS') || '[]'); } catch (x) {}
  var ahora = Date.now(), sem = lista.filter(function (t) { return ahora - t < 7 * 86400000; });
  return { fallos7d: sem.length, ultimo: sem.length ? sem[sem.length - 1] : null };
}

// ---------------------------------------------------------------- Validación

var RE_ID = /^[A-Za-z0-9_-]{1,80}$/, RE_FECHA = /^\d{4}-\d{2}-\d{2}$/, RE_MES = /^\d{4}-\d{2}$/;
var RE_PREVISTO = /^(fijo:[A-Za-z0-9_-]{1,60}:\d{4}-\d{2}(-\d{2})?|prev:[A-Za-z0-9_-]{1,80})$/;
var CUENTAS = ['santander', 'trade'];

function invalida() { return new Error('PETICION_INVALIDA'); }
function vTexto(v, max) { v = v === null || v === undefined ? '' : String(v); if (v.length > max) throw invalida(); return v; }
function vId(v, opcional) { v = vTexto(v, 80); if (v === '' && opcional) return ''; if (!RE_ID.test(v)) throw invalida(); return v; }
function vFecha(v, opcional) { v = vTexto(v, 10); if (v === '' && opcional) return ''; if (!RE_FECHA.test(v)) throw invalida(); return v; }
function vMes(v) { v = vTexto(v, 7); if (!RE_MES.test(v)) throw invalida(); return v; }
function vNum(v, opcional) {
  if ((v === '' || v === null || v === undefined) && opcional) return '';
  if (typeof v !== 'number' || !isFinite(v) || Math.abs(v) > 1e7) throw invalida();
  return Math.round(v * 100) / 100;
}
function vPos(v, opcional) { v = vNum(v, opcional); if (v !== '' && v < 0) throw invalida(); return v; }
function vEntero(v, min, max, opcional) {
  if ((v === '' || v === null || v === undefined) && opcional) return '';
  if (typeof v !== 'number' || Math.floor(v) !== v || v < min || v > max) throw invalida();
  return v;
}
function vUna(v, lista) { if (lista.indexOf(v) < 0) throw invalida(); return v; }

/** Solo se aceptan operaciones conocidas y con datos del tipo y tamaño esperados. */
function validarOps(ops) {
  if (!Array.isArray(ops) || ops.length > 500) throw invalida();
  return ops.map(function (op) {
    if (!op || typeof op !== 'object') throw invalida();
    switch (op.op) {
      case 'mov':
        var m = op.mov || {}, tipo = vUna(m.tipo, ['gasto', 'ingreso', 'transferencia']);
        var cuenta = vUna(m.cuenta, CUENTAS), destino = tipo === 'transferencia' ? vUna(m.destino, CUENTAS) : '';
        if (tipo === 'transferencia' && destino === cuenta) throw invalida();
        var previsto = vTexto(m.previsto, 100);
        if (previsto && !RE_PREVISTO.test(previsto)) throw invalida();
        var importe = vPos(m.importe), devuelto = vPos(m.devuelto, true), fechaDev = vFecha(m.fechaDevuelto, true);
        if (devuelto !== '' && (tipo !== 'gasto' || devuelto > importe)) throw invalida();
        if (devuelto === '' || devuelto === 0) { devuelto = ''; fechaDev = ''; }
        else if (!fechaDev) throw invalida();
        return { op: 'mov', mov: {
          id: vId(m.id), fecha: vFecha(m.fecha), tipo: tipo, importe: importe, cuenta: cuenta, destino: destino,
          cat: vTexto(m.cat, 60), sub: vTexto(m.sub, 60), concepto: vTexto(m.concepto, 120),
          miParte: vPos(m.miParte, true), pagaDeuda: vTexto(m.pagaDeuda, 40), previsto: previsto, prevImporte: vPos(m.prevImporte, true), devuelto: devuelto, fechaDevuelto: fechaDev,
          act: typeof m.act === 'number' && isFinite(m.act) ? m.act : Date.now()
        } };
      case 'borrar': return { op: 'borrar', id: vId(op.id) };
      case 'deudas':
        var movId = vId(op.movId);
        if (!Array.isArray(op.lista) || op.lista.length > 30) throw invalida();
        return { op: 'deudas', movId: movId, lista: op.lista.map(function (d) {
          var persona = vTexto(d.persona, 40).trim();
          if (!persona) throw invalida();
          return { id: vId(d.id), movId: movId, fecha: vFecha(d.fecha), persona: persona, importe: vPos(d.importe), concepto: vTexto(d.concepto, 120) };
        }) };
      case 'prev':
        var p = op.prev || {}, cp = vTexto(p.concepto, 80).trim();
        if (!cp) throw invalida();
        return { op: 'prev', prev: { id: vId(p.id), mes: vMes(p.mes), concepto: cp, importe: vPos(p.importe), cat: vTexto(p.cat, 60), sub: vTexto(p.sub, 60) } };
      case 'borrarPrev': return { op: 'borrarPrev', id: vId(op.id) };
      case 'fijo':
        var f = op.fijo || {}, frec = vUna(f.frecuencia, ['mensual', 'dias', 'sin']), cf = vTexto(f.concepto, 80).trim();
        if (!cf) throw invalida();
        return { op: 'fijo', fijo: {
          id: vId(f.id), concepto: cf, tipo: vUna(f.tipo, ['gasto', 'ahorro']), importe: vPos(f.importe, true),
          cat: vTexto(f.cat, 60), sub: vTexto(f.sub, 60), frecuencia: frec,
          dia: frec === 'mensual' ? vEntero(f.dia, 1, 31) : '', cada: frec === 'dias' ? vEntero(f.cada, 1, 366) : '',
          desde: frec === 'dias' ? vFecha(f.desde) : '', activo: f.activo !== false, orden: vEntero(f.orden, 0, 10000, true),
          icono: vTexto(f.icono, 16).trim()
        } };
      case 'borrarFijo': return { op: 'borrarFijo', id: vId(op.id) };
      case 'cats':
        if (!Array.isArray(op.lista) || op.lista.length > 400) throw invalida();
        return { op: 'cats', lista: op.lista.map(function (c) {
          var cat = vTexto(c.cat, 60).trim();
          if (!cat) throw invalida();
          return { cat: cat, sub: vTexto(c.sub, 60).trim(), tipo: vUna(c.tipo, ['gasto', 'ingreso', 'ahorro']), icono: vTexto(c.icono, 16) };
        }) };
      case 'debo':
        var b = op.debo || {}, pb = vTexto(b.persona, 40).trim();
        if (!pb) throw invalida();
        return { op: 'debo', debo: { id: vId(b.id), persona: pb, concepto: vTexto(b.concepto, 120), importe: vPos(b.importe, true), fecha: vFecha(b.fecha) } };
      case 'borrarDebo': return { op: 'borrarDebo', id: vId(op.id) };
      case 'ahorro':
        var o = { op: 'ahorro', mes: vMes(op.mes) };
        if (op.objetivo !== undefined) o.objetivo = vPos(op.objetivo, true);
        if (op.intereses !== undefined) o.intereses = vPos(op.intereses, true);
        if (op.interesesOk !== undefined) o.interesesOk = op.interesesOk === true;
        if (op.estado !== undefined) o.estado = vUna(op.estado, ['', 'si', 'no']);
        return o;
      case 'config':
        if (!DESC_CONFIG.hasOwnProperty(op.clave)) throw invalida();
        var v = NUM_CONFIG.indexOf(op.clave) >= 0 ? vNum(op.valor) : vFecha(op.valor);
        return { op: 'config', clave: op.clave, valor: v };
    }
    throw invalida();
  });
}

function firma(st) {
  var f = {};
  ['movimientos', 'deudas', 'previsiones', 'fijos', 'categorias', 'ahorro', 'debo', 'config'].forEach(function (k) { f[k] = JSON.stringify(st[k]); });
  return f;
}

// ---------------------------------------------------------------- Lectura / escritura

function hoyISO() { return Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd'); }

function aISO(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ZONA, 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v);
}
function aMes(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ZONA, 'yyyy-MM');
  return v === null || v === undefined ? '' : String(v).slice(0, 7);
}

function aBool(v) {
  if (v === true) return true;
  var s = String(v).trim().toLowerCase();
  return s === 'sí' || s === 'si' || s === 'true' || s === 'x' || s === '1';
}

function leerHoja(nombre) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return [];
  var spec = HOJAS[nombre];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, spec.cols.length).getValues();
  return vals.filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = {};
    spec.cols.forEach(function (c, i) {
      var k = c[0], v = r[i];
      if (spec.fechas.indexOf(k) >= 0) v = aISO(v);
      else if (spec.meses.indexOf(k) >= 0) v = aMes(v);
      else if (spec.bool.indexOf(k) >= 0) v = aBool(v);
      else if (spec.dinero.indexOf(k) >= 0) v = v === '' ? '' : HuchaCore.num(v);
      else if (v instanceof Date) v = aISO(v);
      o[k] = v;
    });
    return o;
  });
}

function leerEstado() {
  var cfg = {};
  leerHoja('Config').forEach(function (r) { if (r.clave) cfg[r.clave] = r.valor instanceof Date ? aISO(r.valor) : r.valor; });
  NUM_CONFIG.forEach(function (k) { if (cfg[k] !== undefined && cfg[k] !== '') cfg[k] = HuchaCore.num(cfg[k]); });
  ['fechaInicio', 'fechaSaldo'].forEach(function (k) { if (cfg[k]) cfg[k] = aISO(cfg[k]); });
  var texto = function (v) { return v === null || v === undefined ? '' : String(v); };
  var movs = leerHoja('Movimientos').map(function (m) {
    m.id = texto(m.id); m.tipo = texto(m.tipo).toLowerCase(); m.cuenta = texto(m.cuenta).toLowerCase(); m.destino = texto(m.destino).toLowerCase();
    ['cat', 'sub', 'concepto', 'pagaDeuda', 'previsto'].forEach(function (k) { m[k] = texto(m[k]); });
    m.act = +m.act || 0;
    return m;
  });
  var fijos = leerHoja('Fijos').map(function (f) {
    f.id = texto(f.id); f.tipo = texto(f.tipo || 'gasto').toLowerCase(); f.frecuencia = texto(f.frecuencia || 'mensual').toLowerCase();
    f.dia = f.dia === '' ? '' : +f.dia; f.cada = f.cada === '' ? '' : +f.cada; f.orden = f.orden === '' ? '' : +f.orden;
    f.concepto = texto(f.concepto); f.cat = texto(f.cat); f.sub = texto(f.sub); f.icono = texto(f.icono);
    return f;
  });
  var cats = leerHoja('Categorias').map(function (c) {
    return { cat: texto(c.cat), sub: texto(c.sub), tipo: texto(c.tipo || 'gasto').toLowerCase(), icono: texto(c.icono) };
  });
  var ahorro = leerHoja('Ahorro').map(function (a) {
    var e = texto(a.estado).toLowerCase();
    a.estado = e === 'sí' || e === 'si' ? 'si' : e === 'no' ? 'no' : '';
    return a;
  });
  var deudas = leerHoja('Deudas').map(function (d) { d.id = texto(d.id); d.movId = texto(d.movId); d.persona = texto(d.persona); d.concepto = texto(d.concepto); return d; });
  var prevs = leerHoja('Previsiones').map(function (p) { p.id = texto(p.id); p.concepto = texto(p.concepto); p.cat = texto(p.cat); p.sub = texto(p.sub); return p; });
  var debo = leerHoja('Debo').map(function (d) { d.id = texto(d.id); d.persona = texto(d.persona); d.concepto = texto(d.concepto); return d; });
  return { config: cfg, movimientos: movs, deudas: deudas, previsiones: prevs, fijos: fijos, categorias: cats, ahorro: ahorro, debo: debo };
}

function escribirHoja(nombre, filas) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  var spec = HOJAS[nombre], n = spec.cols.length, claves = spec.cols.map(function (c) { return c[0]; });
  var last = sh.getLastRow();
  // Cabecera al día (por si una versión nueva añade columnas a una hoja ya creada)
  var cab = sh.getRange(1, 1, 1, n), titulos = spec.cols.map(function (c) { return c[1]; });
  if (cab.getValues()[0].join('|') !== titulos.join('|')) cab.setValues([titulos]).setFontWeight('bold').setBackground('#7c6cf0').setFontColor('#ffffff');
  if (last > 1) sh.getRange(2, 1, last - 1, n).clearContent();
  if (!filas.length) return;
  var vals = filas.map(function (o) {
    return claves.map(function (k) {
      var v = o[k];
      if (v === undefined || v === null) return '';
      if (spec.bool.indexOf(k) >= 0) return v ? 'Sí' : '';
      if (nombre === 'Ahorro' && k === 'estado') return v === 'si' ? 'Sí' : v === 'no' ? 'No' : '';
      if (spec.fechas.indexOf(k) >= 0 && v) { var p = String(v).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
      // Evita la inyección de fórmulas: un texto que empiece por = + - @ se guarda como texto literal.
      if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
      return v;
    });
  });
  // Las columnas de texto se marcan como texto para que Sheets no convierta "1/2" o "2026-11" en fechas.
  claves.forEach(function (k, i) {
    var r = sh.getRange(2, i + 1, vals.length, 1);
    if (spec.fechas.indexOf(k) >= 0) r.setNumberFormat('dd/mm/yyyy');
    else if (spec.dinero.indexOf(k) >= 0) r.setNumberFormat('#,##0.00 "€"');
    else if (spec.bool.indexOf(k) < 0 && ['act', 'dia', 'cada', 'orden'].indexOf(k) < 0 && !(nombre === 'Config' && k === 'valor')) r.setNumberFormat('@');
  });
  sh.getRange(2, 1, vals.length, n).setValues(vals);
}

function escribirTodo(st, que) {
  if (que.movimientos) {
    st.movimientos.sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.act || 0) - (b.act || 0); });
    escribirHoja('Movimientos', st.movimientos);
  }
  if (que.deudas) escribirHoja('Deudas', st.deudas);
  if (que.previsiones) escribirHoja('Previsiones', st.previsiones);
  if (que.fijos) escribirHoja('Fijos', st.fijos);
  if (que.categorias) escribirHoja('Categorias', st.categorias);
  if (que.ahorro) escribirHoja('Ahorro', st.ahorro.sort(function (a, b) { return a.mes < b.mes ? -1 : 1; }));
  if (que.debo) escribirHoja('Debo', st.debo);
  if (que.config) escribirHoja('Config', Object.keys(st.config).map(function (k) {
    return { clave: k, valor: st.config[k], desc: DESC_CONFIG[k] || '' };
  }));
}

// ---------------------------------------------------------------- Resumen mensual

function actualizarResumen(st) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Resumen') || ss.insertSheet('Resumen');
  var hoy = hoyISO(), C = HuchaCore;
  var cats = [];
  (st.categorias || []).forEach(function (c) { if (c.tipo === 'gasto' && !c.sub && cats.indexOf(c.cat) < 0) cats.push(c.cat); });
  var cab = ['Mes', 'Ingresos', 'Gastos (mi parte)', 'Ahorro a Trade Republic', 'Tasa de ahorro', 'Intereses', 'Ahorro cumplido', 'Saldo Santander a fin de mes', 'Saldo Trade Republic a fin de mes'].concat(cats);
  var meses = C.rangoMeses(C.mesInicio(st, hoy), C.mesDe(hoy)).reverse();
  var filas = meses.map(function (mes) {
    var r = C.resumenMes(st, mes), a = C.ahorroMes(st, mes, hoy), fin = C.finDeMes(mes);
    if (fin > hoy) fin = hoy;
    var f = [mes, r.ingresos, r.gastos, r.ahorro, r.tasaAhorro === null ? '' : r.tasaAhorro, a.interesesOk ? a.intereses : '',
      a.estado === 'si' ? 'Sí' : a.estado === 'no' ? 'No' : '', C.saldo(st, C.SANT, fin), C.saldo(st, C.TRADE, fin)];
    cats.forEach(function (c) { f.push(r.porCategoria[c] || 0); });
    return f;
  });
  sh.clear();
  sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#7c6cf0').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  if (filas.length) {
    sh.getRange(2, 1, filas.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, filas.length, cab.length).setValues(filas);
    sh.getRange(2, 2, filas.length, 3).setNumberFormat('#,##0.00 "€"');
    sh.getRange(2, 5, filas.length, 1).setNumberFormat('0.0%');
    sh.getRange(2, 6, filas.length, 1).setNumberFormat('#,##0.00 "€"');
    sh.getRange(2, 8, filas.length, cab.length - 7).setNumberFormat('#,##0.00 "€"');
  }
  sh.getRange(filas.length + 3, 1).setValue('Se actualiza solo con cada cambio desde la app. Los gastos compartidos cuentan solo tu parte.').setFontStyle('italic').setFontColor('#777777');
}
