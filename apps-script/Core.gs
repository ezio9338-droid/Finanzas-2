/*
 * Hucha · lógica compartida
 * La usan la app (navegador) y el Apps Script (apps-script/Core.gs es una copia exacta:
 * tools/sync-core.sh la regenera). Solo funciones puras: no toca el DOM ni las hojas.
 *
 * Cuentas: 'santander' (cuenta del día a día) y 'trade' (remunerada de Trade Republic).
 * Ciclo: el mes natural ('AAAA-MM').
 */
var HuchaCore = (function () {
  'use strict';

  var SANT = 'santander', TRADE = 'trade';

  // ---------- Fechas (siempre texto 'AAAA-MM-DD' o 'AAAA-MM') ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toISO(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function parseISO(s) { var p = String(s).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +(p[2] || 1))); }
  function addDays(s, n) { var d = parseISO(s); d.setUTCDate(d.getUTCDate() + n); return toISO(d); }
  function diffDays(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
  function mesDe(f) { return String(f).slice(0, 7); }
  function mesSig(m) { var y = +m.slice(0, 4), mm = +m.slice(5, 7) + 1; if (mm > 12) { mm = 1; y++; } return y + '-' + pad(mm); }
  function mesAnt(m) { var y = +m.slice(0, 4), mm = +m.slice(5, 7) - 1; if (mm < 1) { mm = 12; y--; } return y + '-' + pad(mm); }
  function finDeMes(m) { return m + '-' + pad(daysInMonth(+m.slice(0, 4), +m.slice(5, 7) - 1)); }
  /** Meses de `desde` a `hasta`, ambos incluidos, en orden. */
  function rangoMeses(desde, hasta) {
    var out = [], m = desde;
    for (var i = 0; m <= hasta && i < 600; i++) { out.push(m); m = mesSig(m); }
    return out;
  }

  // ---------- Números ----------
  function r2(x) { return Math.round((+x || 0) * 100) / 100; }
  function num(x) {
    if (typeof x === 'number') return isFinite(x) ? x : 0;
    if (x === '' || x == null) return 0;
    var s = String(x).trim().replace(/\s|€/g, '');
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  /** 1234.5 → "1.234,50 €" (con signo − si es negativo; con + si signo=true y es positivo). */
  function fmt(x, signo) {
    var n = r2(x), neg = n < 0, p = Math.abs(n).toFixed(2).split('.');
    var ent = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '−' : (signo && n > 0 ? '+' : '')) + ent + ',' + p[1] + ' €';
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function cfg(st, k, def) {
    var v = (st.config || {})[k];
    return v === undefined || v === null || v === '' ? def : v;
  }

  // ---------- Movimientos ----------
  /** Lo que de verdad te ha costado un gasto (tu parte si es compartido). */
  function parteMia(m) { return m.miParte !== '' && m.miParte != null ? num(m.miParte) : num(m.importe); }

  /** Efecto de un movimiento en el saldo de una cuenta. */
  function efecto(m, cuenta) {
    var imp = num(m.importe);
    if (m.tipo === 'gasto') return m.cuenta === cuenta ? -imp : 0;
    if (m.tipo === 'ingreso') return m.cuenta === cuenta ? imp : 0;
    if (m.tipo === 'transferencia') return (m.cuenta === cuenta ? -imp : 0) + (m.destino === cuenta ? imp : 0);
    return 0;
  }

  /**
   * Saldo de una cuenta: saldo inicial + movimientos. Los movimientos anteriores a la fecha del
   * saldo inicial no lo cambian (ya estaban incluidos), pero sí cuentan en previsión y estadísticas.
   * En Trade Republic se suman además los intereses confirmados (el día 1 del mes siguiente).
   */
  function saldo(st, cuenta, hasta) {
    var desde = cfg(st, 'fechaSaldo', '');
    var s = num(cfg(st, cuenta === SANT ? 'saldoInicialSantander' : 'saldoInicialTrade', 0));
    var movs = st.movimientos || [];
    for (var i = 0; i < movs.length; i++) {
      var m = movs[i];
      if (hasta && m.fecha > hasta) continue;
      if (desde && m.fecha < desde) continue;
      s += efecto(m, cuenta);
    }
    if (cuenta === TRADE) {
      (st.ahorro || []).forEach(function (a) {
        if (!a.interesesOk || a.intereses === '' || a.intereses == null) return;
        var f = mesSig(a.mes) + '-01';
        if (hasta && f > hasta) return;
        if (desde && f < desde) return;
        s += num(a.intereses);
      });
    }
    return r2(s);
  }

  // ---------- Categorías ----------
  function categoriasBase() {
    var def = [
      ['Alimentación', '🛒', 'gasto', ['Supermercado', 'Panadería y mercado', 'Comida a domicilio']],
      ['Vivienda', '🏠', 'gasto', ['Garaje', 'Suministros', 'Hogar', 'Muebles y decoración']],
      ['Transporte', '🚌', 'gasto', ['Transporte público', 'Taxi y VTC', 'Parking', 'Peajes']],
      ['Coche', '🚗', 'gasto', ['Cuota del coche', 'Gasolina', 'Mantenimiento', 'Seguro', 'Lavado']],
      ['Salud y deporte', '🏋️', 'gasto', ['Gimnasio', 'Seguro médico', 'Farmacia', 'Médico', 'Material deportivo']],
      ['Ocio y restaurantes', '🍽️', 'gasto', ['Restaurantes', 'Copas', 'Cafés', 'Cine y conciertos', 'Planes']],
      ['Viajes', '✈️', 'gasto', ['Transporte', 'Alojamiento', 'Comidas', 'Actividades']],
      ['Suscripciones', '📱', 'gasto', ['iCloud', 'Streaming', 'Música', 'Apps']],
      ['Gastos personales', '💅', 'gasto', ['Uñas', 'Depilación', 'Peluquería', 'Ropa', 'Cosmética', 'Regalos']],
      ['Nómina', '💼', 'ingreso', ['Nómina', 'Paga extra']],
      ['Otros ingresos', '💶', 'ingreso', ['Devoluciones', 'Otros']],
      ['Ahorro', '🐷', 'ahorro', ['Trade Republic']]
    ];
    var out = [];
    def.forEach(function (d) {
      out.push({ cat: d[0], sub: '', tipo: d[2], icono: d[1] });
      d[3].forEach(function (s) { out.push({ cat: d[0], sub: s, tipo: d[2], icono: '' }); });
    });
    return out;
  }
  function icono(st, cat) {
    var c = (st.categorias || []).filter(function (x) { return x.cat === cat && !x.sub; })[0];
    return c && c.icono ? c.icono : (cat === 'Ahorro' ? '🐷' : '•');
  }

  // ---------- Gastos fijos y previsión ----------
  function objetivoMes(st, mes) {
    var a = filaAhorro(st, mes);
    return a && a.objetivo !== '' && a.objetivo != null ? num(a.objetivo) : num(cfg(st, 'objetivoAhorro', 0));
  }
  function nombreMes(mes) {
    return ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][+mes.slice(5, 7) - 1];
  }

  /** Veces que un fijo toca en un mes: [{clave, fecha ('' si no tiene día)}]. */
  function ocurrencias(f, mes) {
    if (f.activo === false) return [];
    var ini = mes + '-01', fin = finDeMes(mes), out = [];
    if (f.frecuencia === 'dias') {
      var cada = +f.cada, desde = f.desde;
      if (!cada || !desde) return [];
      // `desde` es el último pago conocido: los siguientes son desde + k·cada (k ≥ 1)
      var k = Math.max(1, Math.ceil(diffDays(desde, ini) / cada));
      for (var d = addDays(desde, k * cada), i = 0; d <= fin && i < 40; d = addDays(d, cada), i++) {
        if (d >= ini) out.push({ clave: 'fijo:' + f.id + ':' + d, fecha: d });
      }
      return out;
    }
    if (f.frecuencia === 'mensual' && f.dia) {
      var y = +mes.slice(0, 4), m = +mes.slice(5, 7) - 1;
      return [{ clave: 'fijo:' + f.id + ':' + mes, fecha: mes + '-' + pad(Math.min(+f.dia, daysInMonth(y, m))) }];
    }
    return [{ clave: 'fijo:' + f.id + ':' + mes, fecha: '' }];
  }

  /** Movimientos que han saldado una partida o un fijo, por clave. */
  function hechos(st) {
    var h = {};
    (st.movimientos || []).forEach(function (m) { if (m.previsto) h[m.previsto] = m; });
    return h;
  }

  /**
   * Previsión de un mes: fijos que tocan + partidas manuales.
   * Cada línea: {clave, origen ('fijo'|'prev'), ref, concepto, importe, cat, sub, fecha, esAhorro, hecho (mov|null), retrasado}
   */
  function prevision(st, mes, hoy) {
    var h = hechos(st), out = [];
    (st.fijos || []).slice().sort(function (a, b) { return (+a.orden || 0) - (+b.orden || 0); }).forEach(function (f) {
      ocurrencias(f, mes).forEach(function (o) {
        var esAhorro = f.tipo === 'ahorro', hecho = h[o.clave] || null;
        out.push({
          clave: o.clave, origen: 'fijo', ref: f, concepto: esAhorro ? 'Ahorro ' + nombreMes(mes) : f.concepto,
          importe: esAhorro ? objetivoMes(st, mes) : num(f.importe), cat: esAhorro ? 'Ahorro' : f.cat, sub: esAhorro ? 'Trade Republic' : f.sub,
          fecha: o.fecha, esAhorro: esAhorro, hecho: hecho,
          retrasado: !hecho && !!o.fecha && !!hoy && diffDays(o.fecha, hoy) >= 2
        });
      });
    });
    (st.previsiones || []).forEach(function (p) {
      if (p.mes !== mes) return;
      var clave = 'prev:' + p.id;
      out.push({ clave: clave, origen: 'prev', ref: p, concepto: p.concepto, importe: num(p.importe), cat: p.cat, sub: p.sub, fecha: '', esAhorro: false, hecho: h[clave] || null, retrasado: false });
    });
    out.sort(function (a, b) {
      if (!!a.hecho !== !!b.hecho) return a.hecho ? 1 : -1;
      var fa = a.fecha || '9999', fb = b.fecha || '9999';
      return fa < fb ? -1 : fa > fb ? 1 : 0;
    });
    return out;
  }

  function resumenPrevision(st, mes, hoy) {
    var lineas = prevision(st, mes, hoy), pendiente = 0, total = 0;
    // El ahorro a Trade Republic aparece en la lista para marcarlo, pero no se resta de «Te quedaría».
    lineas.forEach(function (l) { if (l.esAhorro) return; total += l.importe; if (!l.hecho) pendiente += l.importe; });
    var s = saldo(st, SANT);
    return { lineas: lineas, pendiente: r2(pendiente), total: r2(total), saldo: s, quedaria: r2(s - pendiente) };
  }

  // ---------- Deudas (me deben) ----------
  function clavePersona(n) { return String(n || '').trim().toLowerCase(); }

  /** Por persona: {persona, total, pagado, pendiente, items:[{deuda, restante}]}; solo las que deben algo. */
  function deudas(st) {
    var por = {};
    (st.deudas || []).forEach(function (d) {
      var k = clavePersona(d.persona); if (!k) return;
      (por[k] = por[k] || { persona: String(d.persona).trim(), deudas: [], pagado: 0 }).deudas.push(d);
    });
    (st.movimientos || []).forEach(function (m) {
      if (m.tipo !== 'ingreso' || !m.pagaDeuda) return;
      var k = clavePersona(m.pagaDeuda);
      (por[k] = por[k] || { persona: String(m.pagaDeuda).trim(), deudas: [], pagado: 0 }).pagado += num(m.importe);
    });
    var out = [];
    Object.keys(por).forEach(function (k) {
      var p = por[k], resto = p.pagado, total = 0, items = [];
      p.deudas.sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0; }).forEach(function (d) {
        var imp = num(d.importe), usa = Math.min(imp, Math.max(0, resto));
        resto -= usa; total += imp;
        if (imp - usa > 0.004) items.push({ deuda: d, restante: r2(imp - usa), pagado: r2(usa) });
      });
      var pendiente = r2(total - p.pagado);
      if (pendiente > 0.004) out.push({ persona: p.persona, total: r2(total), pagado: r2(p.pagado), pendiente: pendiente, items: items });
    });
    return out.sort(function (a, b) { return b.pendiente - a.pendiente; });
  }
  function totalMeDeben(st) { return r2(deudas(st).reduce(function (a, d) { return a + d.pendiente; }, 0)); }
  function personasConocidas(st) {
    var vistos = {}, out = [];
    (st.deudas || []).concat((st.debo || [])).forEach(function (d) {
      var k = clavePersona(d.persona); if (k && !vistos[k]) { vistos[k] = 1; out.push(String(d.persona).trim()); }
    });
    return out.sort();
  }

  // ---------- Trade Republic ----------
  function filaAhorro(st, mes) { return (st.ahorro || []).filter(function (a) { return a.mes === mes; })[0] || null; }
  function tasaDiaria(tae) { return Math.pow(1 + num(tae) / 100, 1 / 365) - 1; }

  /**
   * Intereses netos estimados de un mes (se pagan el día 1 del siguiente).
   * TAE por tramos: tae1 hasta `limiteTae`, tae2 por encima. Se descuenta la retención.
   * Si el mes no ha terminado, calcula hasta ayer. Devuelve null si el mes aún no ha empezado.
   */
  function interesEstimado(st, mes, hoy) {
    var ini = mes + '-01', fin = finDeMes(mes);
    if (hoy && ini >= hoy) return null;
    var hasta = hoy && hoy <= fin ? addDays(hoy, -1) : fin;
    var t1 = tasaDiaria(cfg(st, 'tae1', 3)), t2 = tasaDiaria(cfg(st, 'tae2', 2.25));
    var lim = num(cfg(st, 'limiteTae', 50000)), ret = num(cfg(st, 'retencion', 19));
    var total = 0;
    for (var d = ini, i = 0; d <= hasta && i < 31; d = addDays(d, 1), i++) {
      var b = saldo(st, TRADE, d);
      if (b > 0) total += Math.min(b, lim) * t1 + Math.max(0, b - lim) * t2;
    }
    return r2(total * (1 - ret / 100));
  }

  function mesInicio(st, hoy) { return mesDe(cfg(st, 'fechaInicio', hoy)); }

  /** Datos de un mes de ahorro. */
  function ahorroMes(st, mes, hoy) {
    var fila = filaAhorro(st, mes) || {}, aportado = 0, retirado = 0, aportes = [];
    var movs = (st.movimientos || []).filter(function (m) { return m.tipo === 'transferencia'; });
    movs.forEach(function (m) {
      if (mesDe(m.fecha) !== mes) return;
      if (m.destino === TRADE) { aportado += num(m.importe); aportes.push(m.fecha); }
      else if (m.cuenta === TRADE) retirado += num(m.importe);
    });
    // Retiradas desde la aportación de este mes hasta la del mes siguiente (o hasta hoy)
    aportes.sort();
    var desde = aportes[0] || (mes + '-01'), sig = mesSig(mes), hasta = null;
    movs.forEach(function (m) { if (m.destino === TRADE && mesDe(m.fecha) === sig && (!hasta || m.fecha < hasta)) hasta = m.fecha; });
    var retiradas = movs.filter(function (m) { return m.cuenta === TRADE && m.fecha >= desde && (!hasta || m.fecha < hasta); });
    var confirmado = !!fila.interesesOk && fila.intereses !== '' && fila.intereses != null;
    return {
      mes: mes, objetivo: objetivoMes(st, mes), objetivoPropio: fila.objetivo !== undefined && fila.objetivo !== '' && fila.objetivo != null,
      aportado: r2(aportado), retirado: r2(retirado), neto: r2(aportado - retirado),
      interesesOk: confirmado, intereses: confirmado ? num(fila.intereses) : null,
      interesEstimado: interesEstimado(st, mes, hoy), mesTerminado: !!hoy && finDeMes(mes) < hoy,
      estado: fila.estado === 'si' || fila.estado === 'no' ? fila.estado : '',
      retiradas: retiradas
    };
  }

  function resumenAhorro(st, hoy) {
    var meses = rangoMeses(mesInicio(st, hoy), mesDe(hoy)).map(function (m) { return ahorroMes(st, m, hoy); });
    var aportado = num(cfg(st, 'saldoInicialTrade', 0)), intereses = 0;
    meses.forEach(function (a) { aportado += a.neto; if (a.interesesOk) intereses += a.intereses; });
    return { meses: meses, aportado: r2(aportado), intereses: r2(intereses), total: saldo(st, TRADE) };
  }

  // ---------- Estadísticas ----------
  function resumenMes(st, mes) {
    var r = { mes: mes, ingresos: 0, nomina: 0, gastos: 0, ahorro: 0, porCategoria: {}, fueraPrevision: 0, movimientos: 0 };
    (st.movimientos || []).forEach(function (m) {
      if (mesDe(m.fecha) !== mes) return;
      r.movimientos++;
      if (m.tipo === 'ingreso' && !m.pagaDeuda) { r.ingresos += num(m.importe); if (m.cat === 'Nómina') r.nomina += num(m.importe); }
      else if (m.tipo === 'gasto') {
        var p = parteMia(m); r.gastos += p;
        var c = m.cat || 'Sin categoría'; r.porCategoria[c] = (r.porCategoria[c] || 0) + p;
        if (!m.previsto) r.fueraPrevision += p;
      } else if (m.tipo === 'transferencia') {
        if (m.destino === TRADE) r.ahorro += num(m.importe);
        else if (m.cuenta === TRADE) r.ahorro -= num(m.importe);
      }
    });
    ['ingresos', 'nomina', 'gastos', 'ahorro', 'fueraPrevision'].forEach(function (k) { r[k] = r2(r[k]); });
    Object.keys(r.porCategoria).forEach(function (k) { r.porCategoria[k] = r2(r.porCategoria[k]); });
    r.tasaAhorro = r.ingresos > 0 ? r.ahorro / r.ingresos : null;
    return r;
  }

  // ---------- Operaciones (la app las encola; el servidor las aplica) ----------
  function indexBy(arr, k, v) { for (var i = 0; i < arr.length; i++) if (arr[i][k] === v) return i; return -1; }
  function upsert(arr, obj, k) { k = k || 'id'; var i = indexBy(arr, k, obj[k]); if (i >= 0) arr[i] = obj; else arr.push(obj); }

  function aplicarOps(st, ops) {
    ['movimientos', 'deudas', 'previsiones', 'fijos', 'categorias', 'ahorro', 'debo'].forEach(function (k) { st[k] = st[k] || []; });
    st.config = st.config || {};
    (ops || []).forEach(function (op) {
      switch (op.op) {
        case 'mov': upsert(st.movimientos, op.mov); break;
        case 'borrar':
          st.movimientos = st.movimientos.filter(function (m) { return m.id !== op.id; });
          st.deudas = st.deudas.filter(function (d) { return d.movId !== op.id; });
          break;
        case 'deudas':
          st.deudas = st.deudas.filter(function (d) { return d.movId !== op.movId; }).concat(op.lista || []);
          break;
        case 'prev': upsert(st.previsiones, op.prev); break;
        case 'borrarPrev': st.previsiones = st.previsiones.filter(function (p) { return p.id !== op.id; }); break;
        case 'fijo': upsert(st.fijos, op.fijo); break;
        case 'borrarFijo': st.fijos = st.fijos.filter(function (f) { return f.id !== op.id; }); break;
        case 'cats': st.categorias = op.lista || []; break;
        case 'debo': upsert(st.debo, op.debo); break;
        case 'borrarDebo': st.debo = st.debo.filter(function (d) { return d.id !== op.id; }); break;
        case 'ahorro':
          var i = indexBy(st.ahorro, 'mes', op.mes), fila = i >= 0 ? st.ahorro[i] : { mes: op.mes, objetivo: '', intereses: '', interesesOk: false, estado: '' };
          ['objetivo', 'intereses', 'interesesOk', 'estado'].forEach(function (k) { if (op[k] !== undefined) fila[k] = op[k]; });
          if (i < 0) st.ahorro.push(fila);
          break;
        case 'config': st.config[op.clave] = op.valor; break;
      }
    });
    return st;
  }

  // ---------- Datos de ejemplo (modo demo) ----------
  function estadoEjemplo(hoy) {
    var mes = mesDe(hoy), ant = mesAnt(mes), ant2 = mesAnt(ant);
    var st = {
      config: { fechaInicio: ant2 + '-01', fechaSaldo: ant2 + '-01', saldoInicialSantander: 1850, saldoInicialTrade: 0, objetivoAhorro: 1450, tae1: 3, tae2: 2.25, limiteTae: 50000, retencion: 19 },
      categorias: categoriasBase(), movimientos: [], deudas: [], previsiones: [], ahorro: [], debo: [],
      fijos: [
        { id: 'garaje', concepto: 'Garaje', tipo: 'gasto', importe: 85, cat: 'Vivienda', sub: 'Garaje', frecuencia: 'mensual', dia: 1, cada: '', desde: '', activo: true, orden: 1 },
        { id: 'icloud', concepto: 'iCloud', tipo: 'gasto', importe: 2.99, cat: 'Suscripciones', sub: 'iCloud', frecuencia: 'mensual', dia: 5, cada: '', desde: '', activo: true, orden: 2 },
        { id: 'gym', concepto: 'Gimnasio', tipo: 'gasto', importe: 27, cat: 'Salud y deporte', sub: 'Gimnasio', frecuencia: 'dias', dia: '', cada: 28, desde: addDays(ant2 + '-01', -10), activo: true, orden: 3 },
        { id: 'peluqueria', concepto: 'Peluquería', tipo: 'gasto', importe: 30, cat: 'Gastos personales', sub: 'Peluquería', frecuencia: 'sin', dia: '', cada: '', desde: '', activo: true, orden: 4 },
        { id: 'ahorro', concepto: 'Ahorro', tipo: 'ahorro', importe: '', cat: 'Ahorro', sub: 'Trade Republic', frecuencia: 'mensual', dia: 26, cada: '', desde: '', activo: true, orden: 9 }
      ]
    };
    var n = 0;
    function mov(fecha, tipo, importe, cat, sub, concepto, extra) {
      var m = { id: 'ej' + (++n), fecha: fecha, tipo: tipo, importe: importe, cuenta: SANT, destino: '', cat: cat, sub: sub, concepto: concepto, miParte: '', pagaDeuda: '', previsto: '', prevImporte: '', act: n };
      for (var k in extra) m[k] = extra[k];
      if (fecha <= hoy) st.movimientos.push(m);
      return m;
    }
    [ant2, ant].forEach(function (m) {
      mov(m + '-01', 'gasto', 85, 'Vivienda', 'Garaje', 'Garaje', { previsto: 'fijo:garaje:' + m, prevImporte: 85 });
      mov(m + '-05', 'gasto', 2.99, 'Suscripciones', 'iCloud', 'iCloud', { previsto: 'fijo:icloud:' + m, prevImporte: 2.99 });
      mov(m + '-09', 'gasto', 64.2, 'Alimentación', 'Supermercado', 'Mercadona');
      mov(m + '-15', 'gasto', 48.5, 'Coche', 'Gasolina', 'Repsol');
      mov(m + '-19', 'gasto', 38.9, 'Ocio y restaurantes', 'Restaurantes', 'Comida con amigas');
      mov(m + '-22', 'gasto', 52.3, 'Alimentación', 'Supermercado', 'Mercadona');
      mov(m + '-26', 'ingreso', 2150, 'Nómina', 'Nómina', 'Nómina ' + nombreMes(m));
      mov(m + '-26', 'transferencia', 1450, 'Ahorro', 'Trade Republic', 'Ahorro ' + nombreMes(m), { destino: TRADE, previsto: 'fijo:ahorro:' + m, prevImporte: 1450 });
    });
    st.ahorro.push({ mes: ant2, objetivo: '', intereses: 0.95, interesesOk: true, estado: 'si' });
    st.ahorro.push({ mes: ant, objetivo: '', intereses: '', interesesOk: false, estado: '' });
    mov(mes + '-01', 'gasto', 85, 'Vivienda', 'Garaje', 'Garaje', { previsto: 'fijo:garaje:' + mes, prevImporte: 85 });
    var cena = mov(mes + '-02', 'gasto', 120, 'Ocio y restaurantes', 'Restaurantes', 'Cena con Ana y Luis', { miParte: 40 });
    if (cena.fecha <= hoy) {
      st.deudas.push({ id: 'd1', movId: cena.id, fecha: cena.fecha, persona: 'Ana', importe: 40, concepto: cena.concepto });
      st.deudas.push({ id: 'd2', movId: cena.id, fecha: cena.fecha, persona: 'Luis', importe: 40, concepto: cena.concepto });
      mov(mes + '-03', 'ingreso', 40, '', '', 'Bizum de Ana', { pagaDeuda: 'Ana' });
    }
    mov(mes + '-02', 'gasto', 41.75, 'Alimentación', 'Supermercado', 'Mercadona');
    st.previsiones.push({ id: 'p1', mes: mes, concepto: 'Regalo cumpleaños', importe: 50, cat: 'Gastos personales', sub: 'Regalos' });
    st.debo.push({ id: 'b1', persona: 'Marta', concepto: 'Entradas del concierto', importe: 35, fecha: mes + '-01' });
    return st;
  }

  return {
    SANT: SANT, TRADE: TRADE,
    pad: pad, toISO: toISO, parseISO: parseISO, addDays: addDays, diffDays: diffDays, mesDe: mesDe, mesSig: mesSig, mesAnt: mesAnt,
    finDeMes: finDeMes, rangoMeses: rangoMeses, nombreMes: nombreMes,
    r2: r2, num: num, fmt: fmt, uid: uid, cfg: cfg,
    parteMia: parteMia, efecto: efecto, saldo: saldo,
    categoriasBase: categoriasBase, icono: icono,
    ocurrencias: ocurrencias, prevision: prevision, resumenPrevision: resumenPrevision, objetivoMes: objetivoMes,
    deudas: deudas, totalMeDeben: totalMeDeben, personasConocidas: personasConocidas, clavePersona: clavePersona,
    filaAhorro: filaAhorro, interesEstimado: interesEstimado, ahorroMes: ahorroMes, resumenAhorro: resumenAhorro, mesInicio: mesInicio,
    resumenMes: resumenMes, aplicarOps: aplicarOps, estadoEjemplo: estadoEjemplo
  };
})();
