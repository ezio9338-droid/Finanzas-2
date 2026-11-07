/* Hucha · aplicación */
(function () {
  'use strict';
  var C = HuchaCore, SANT = C.SANT, TRADE = C.TRADE;
  var VERSION = '1.0.1';
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  // ---------------------------------------------------------------- utilidades
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(x, signo) { return C.fmt(x, signo); }
  /** Sin decimales si es un número redondo: 1.450 € */
  function fmt0(x) { var n = C.r2(x); return n % 1 === 0 ? C.fmt(n).replace(',00 €', ' €') : C.fmt(n); }
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + C.pad(d.getMonth() + 1) + '-' + C.pad(d.getDate()); }
  function fCorta(s) { var d = C.parseISO(s); return d.getUTCDate() + ' ' + MESES[d.getUTCMonth()] + (s.slice(0, 4) !== hoy().slice(0, 4) ? ' ' + s.slice(0, 4) : ''); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function nombreMes(mes, conAnio) { return cap(C.nombreMes(mes)) + (conAnio ? ' ' + mes.slice(0, 4) : ''); }
  function aInput(n) { return n === '' || n == null ? '' : String(C.r2(n)).replace('.', ','); }
  function normal(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function sw(on, act, attrs, cls) { return '<button class="sw' + (cls ? ' ' + cls : '') + '" role="switch" aria-checked="' + !!on + '" data-act="' + act + '" ' + (attrs || '') + '></button>'; }

  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem('hcati.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('hcati.' + k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem('hcati.' + k); } catch (e) {} }
  };
  var DB = {
    db: null,
    open: function () {
      var self = this;
      return new Promise(function (res) {
        try {
          var r = indexedDB.open('hucha-cati', 1);
          r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
          r.onsuccess = function () { self.db = r.result; res(); };
          r.onerror = function () { res(); };
        } catch (e) { res(); }
      });
    },
    get: function (k) {
      var self = this;
      if (!self.db) return Promise.resolve(LS.get('kv.' + k, null));
      return new Promise(function (res) {
        try { var r = self.db.transaction('kv').objectStore('kv').get(k); r.onsuccess = function () { res(r.result === undefined ? null : r.result); }; r.onerror = function () { res(null); }; }
        catch (e) { res(null); }
      });
    },
    set: function (k, v) {
      var self = this;
      if (!self.db) { LS.set('kv.' + k, v); return Promise.resolve(); }
      return new Promise(function (res) {
        try { var tx = self.db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = res; }
        catch (e) { res(); }
      });
    }
  };
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2200);
  }

  // ---------------------------------------------------------------- estado
  var snapshot = null, queue = [], V = null;
  var ui = { tab: 'santander', sub: null, q: '', rango: 'mes', desde: '', hasta: '', limite: 200, stats: 'mes' };
  var sync = { estado: 'idle', ultimo: 0, error: '' }, syncing = false, syncTimer = null;
  var sesion = { url: '', clave: '' }, llave = null, caja = null, seguridad = null;

  function modo() {
    if (LS.get('demo', false)) return 'demo';
    if (caja && !llave) return 'bloqueado';
    return sesion.url ? 'online' : 'setup';
  }

  function recompute() {
    if (!snapshot) { V = null; return; }
    V = C.aplicarOps(clone(snapshot), queue);
  }

  var cadena = Promise.resolve();
  /** Guarda en el dispositivo. Fuera del modo demo, solo cifrado y solo si la caja está abierta. */
  function persist() {
    if (modo() === 'demo') { DB.set('demo.snapshot', snapshot); DB.set('demo.queue', queue); return; }
    if (!llave || !caja) return;
    var k = llave, meta = caja, datos = { url: sesion.url, clave: sesion.clave, snapshot: snapshot, queue: queue, ultimoSync: sync.ultimo };
    cadena = cadena.then(function () { return HuchaVault.cifrar(k, datos); }).then(function (c) {
      if (caja !== meta) return;
      meta.iv = c.iv; meta.ct = c.ct;
      return DB.set('vault', meta);
    }).catch(function () {});
  }

  function commit(ops) {
    if (modo() === 'demo') C.aplicarOps(snapshot, ops);
    else queue = queue.concat(ops);
    persist(); recompute(); render(); programarSync(300);
  }

  function programarSync(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(hacerSync, ms || 0); }

  function hacerSync() {
    if (modo() !== 'online' || syncing) return Promise.resolve();
    if (!navigator.onLine) { sync.estado = 'off'; pintarEstado(); return Promise.resolve(); }
    syncing = true; sync.estado = 'sync'; pintarEstado();
    var enviadas = queue.length, ops = queue.slice(0, enviadas);
    return fetch(sesion.url, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ clave: sesion.clave, ops: ops })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) throw new Error(j.error || 'Error desconocido');
      snapshot = j.estado; queue = queue.slice(enviadas); seguridad = j.seguridad || null;
      sync.estado = queue.length ? 'pend' : 'ok'; sync.ultimo = Date.now(); sync.error = '';
      persist(); recompute(); if (!hoja) render(); else pintarEstado();
    }).catch(function (e) {
      sync.estado = 'err';
      sync.error = /CLAVE_INCORRECTA/.test(e.message) ? 'La clave secreta no coincide.'
        : /PETICION_INVALIDA/.test(e.message) ? 'La hoja ha rechazado un cambio. Revisa Más → Conexión.'
        : (e.message === 'Failed to fetch' || e.message === 'Load failed' ? 'No se pudo contactar con Google.' : e.message);
      pintarEstado();
    }).then(function () {
      syncing = false;
      if (queue.length && sync.estado === 'ok') programarSync(200);
    });
  }

  function estadoTexto() {
    if (modo() === 'demo') return { cls: '', txt: 'Demo' };
    if (sync.estado === 'sync') return { cls: 'pend', txt: 'Sincronizando…' };
    if (sync.estado === 'err') return { cls: 'err', txt: queue.length ? queue.length + ' sin enviar' : 'Error' };
    if (sync.estado === 'off' || !navigator.onLine) return { cls: 'pend', txt: queue.length ? 'Sin conexión · ' + queue.length : 'Sin conexión' };
    if (queue.length) return { cls: 'pend', txt: queue.length + ' pendientes' };
    return { cls: 'ok', txt: 'Al día' };
  }
  function pillHTML() { var e = estadoTexto(); return '<button class="pill ' + e.cls + '" data-act="sync" id="pill"><span class="dot"></span>' + e.txt + '</button>'; }
  function pintarEstado() { var p = $('#pill'); if (p) p.outerHTML = pillHTML(); }

  // ---------------------------------------------------------------- consultas
  function cats(tipo) { return (V.categorias || []).filter(function (c) { return !c.sub && c.tipo === tipo; }); }
  function subs(cat) { return (V.categorias || []).filter(function (c) { return c.cat === cat && c.sub; }).map(function (c) { return c.sub; }); }
  function icono(cat) { return C.icono(V, cat); }
  function mov(id) { return V.movimientos.filter(function (m) { return m.id === id; })[0]; }
  function lineaPrev(clave) {
    var mes = clave.indexOf('fijo:') === 0 ? clave.split(':')[2].slice(0, 7) : C.mesDe(hoy());
    return C.prevision(V, mes, hoy()).filter(function (l) { return l.clave === clave; })[0];
  }
  function ordenMovs(a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : (b.act || 0) - (a.act || 0); }

  // ---------------------------------------------------------------- render
  function render() {
    var app = $('#app');
    if (modo() === 'bloqueado') { $('#tabbar').hidden = true; app.innerHTML = vistaBloqueo(); return; }
    if (modo() === 'setup' || !V) { $('#tabbar').hidden = true; app.innerHTML = vistaBienvenida(); return; }
    $('#tabbar').hidden = false;
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === ui.tab); });
    var vistas = { santander: vistaSantander, ahorro: vistaAhorro, deudas: vistaDeudas, mas: vistaMas };
    var subvistas = { movs: vistaMovimientos, stats: vistaStats, fijos: vistaFijos, cats: vistaCategorias, meses: vistaMeses, seguridad: vistaSeguridad, conexion: vistaConexion };
    var html = ui.sub && subvistas[ui.sub] ? subvistas[ui.sub]() : vistas[ui.tab]();
    var y = window.scrollY;
    app.innerHTML = '<div class="view">' + html + '</div>';
    window.scrollTo(0, y);
  }

  function vistaBienvenida() {
    return '<div class="view welcome">' +
      '<img class="logo" src="icons/icon-192.png" alt="">' +
      '<h1>Hucha</h1><p class="lead">Santander, previsión del mes, deudas y ahorro.</p>' +
      '<div class="field">' +
      '<div class="frow"><span class="k">URL</span><input id="w-url" placeholder="https://script.google.com/…/exec" autocomplete="off" autocapitalize="off" spellcheck="false"></div>' +
      '<div class="frow"><span class="k">Clave secreta</span><input id="w-clave" autocomplete="off" autocapitalize="off" spellcheck="false"></div>' +
      '</div>' +
      '<button class="btn primary block" data-act="conectar">Conectar con mi hoja</button>' +
      '<p class="err" id="w-err"></p>' +
      '<button class="link" data-act="demo">Probar con datos de ejemplo</button></div>';
  }

  function avisosGenerales() {
    var h = '';
    if (sync.estado === 'err' && modo() === 'online') h += '<div class="alert red">⚠️<div class="grow"><b class="k">No se ha podido sincronizar.</b> ' + esc(sync.error) + '</div></div>';
    if (seguridad && seguridad.ultimo && seguridad.ultimo > LS.get('fallosVistos', 0)) {
      h += '<div class="alert red">🚨<div class="grow">Alguien ha intentado entrar en tu hoja con una clave incorrecta (último intento: ' + esc(new Date(seguridad.ultimo).toLocaleString('es-ES')) + '). Si no fuiste tú, cambia la clave desde el menú Hucha de la hoja.' +
        '<div class="acts"><button class="btn small" data-act="fallos-ok" data-id="' + seguridad.ultimo + '">Fui yo / Entendido</button></div></div></div>';
    }
    if (modo() === 'online' && !caja) h += '<div class="alert">🔓<div class="grow">Este móvil aún no está protegido. <button class="link" data-act="proteger">Protegerlo ahora</button></div></div>';
    return h;
  }

  // ---------- Santander ----------
  function vistaSantander() {
    var t = hoy(), mes = C.mesDe(t), rp = C.resumenPrevision(V, mes, t), ds = C.deudas(V), deben = C.totalMeDeben(V);
    var h = '<div class="title"><span>' + nombreMes(mes) + '</span>' + pillHTML() + '</div>' + avisosGenerales();
    h += '<div class="hero"><span class="label">Santander · saldo real</span><span class="big amt">' + fmt(rp.saldo) + '</span>' +
      '<div class="sub"><span>Te quedaría</span><b class="amt">' + fmt(rp.quedaria) + '</b></div></div>';
    if (deben > 0) h += '<button class="debts" data-act="ir" data-id="deudas"><span>Te ' + (ds.length === 1 ? 'debe ' + esc(ds[0].persona) : 'deben ' + ds.length + ' personas') + '</span><b class="amt">' + fmt(deben) + '</b></button>';
    rp.lineas.filter(function (l) { return l.retrasado; }).forEach(function (l) {
      h += '<div class="alert">⏰<div class="grow"><b class="k">' + esc(l.concepto) + '</b> debía cobrarse el ' + fCorta(l.fecha) + ' y aún no está marcado.</div></div>';
    });

    var pend = rp.lineas.filter(function (l) { return !l.hecho; }), hechas = rp.lineas.filter(function (l) { return l.hecho; });
    h += '<div class="card"><h3>Previsión del mes <span class="amt">' + (pend.length ? fmt(rp.pendiente) + ' pendientes' : 'todo pagado') + '</span></h3>';
    if (!rp.lineas.length) h += '<div class="empty">Añade lo que prevés gastar este mes.</div>';
    h += pend.map(filaPrev).join('');
    if (hechas.length) {
      var totalH = hechas.reduce(function (a, l) { return a + C.num(l.hecho.importe); }, 0);
      h += '<details class="done-list"><summary>Ya pagados (' + hechas.length + ') · ' + fmt(totalH) + '</summary>' + hechas.map(filaPrev).join('') + '</details>';
    }
    h += '<button class="addrow" data-act="partida-nueva">＋ Añadir partida</button></div>';

    var ult = V.movimientos.slice().sort(ordenMovs).slice(0, 5);
    h += '<div class="card"><h3>Últimos movimientos <button data-act="sub" data-id="movs">Ver todos</button></h3>' +
      (ult.length ? ult.map(filaMov).join('') : '<div class="empty">Aún no hay movimientos. Pulsa ＋ para apuntar el primero.</div>') + '</div>';
    h += '<div class="card"><div class="item tap" data-act="ir" data-id="ahorro"><div class="emo tr">🐷</div><div class="grow"><div class="t">Trade Republic</div></div><span class="amt"><b>' + fmt(C.saldo(V, TRADE)) + '</b></span><span class="chev">›</span></div></div>';
    return h;
  }

  function filaPrev(l) {
    var info;
    if (l.hecho) {
      var real = C.num(l.hecho.importe);
      info = 'Pagado el ' + fCorta(l.hecho.fecha) + (Math.abs(real - l.importe) > 0.004 ? ' · previsto ' + fmt(l.importe) : '');
    } else if (l.esAhorro) info = (l.fecha ? 'Día ' + +l.fecha.slice(8) + ' · ' : '') + 'a Trade Republic · no se resta';
    else if (l.origen === 'prev') info = 'Añadido a mano';
    else if (!l.fecha) info = 'Sin día fijo';
    else info = (l.ref.frecuencia === 'dias' ? fCorta(l.fecha) : 'Día ' + +l.fecha.slice(8)) + (l.retrasado ? ' · con retraso' : '');
    var importe = l.hecho ? C.num(l.hecho.importe) : l.importe;
    var tap = l.origen === 'prev' ? ' tap" data-act="partida" data-id="' + esc(l.ref.id) : '';
    return '<div class="item' + (l.retrasado ? ' late' : '') + (l.hecho ? ' done' : '') + tap + '">' +
      '<div class="emo' + (l.esAhorro ? ' tr' : '') + '">' + (l.esAhorro ? '🐷' : icono(l.cat)) + '</div>' +
      '<div class="grow"><div class="t">' + esc(l.concepto) + '</div><small>' + info + '</small></div>' +
      '<span class="amt">' + fmt(importe) + '</span>' +
      sw(!!l.hecho, l.hecho ? 'desmarcar' : 'marcar', 'data-k="' + esc(l.clave) + '" aria-label="' + esc(l.concepto) + ' pagado"') + '</div>';
  }

  function filaMov(m) {
    var emo, cls = '', titulo, sub = [fCorta(m.fecha)], imp, signo;
    if (m.tipo === 'transferencia') {
      var aTR = m.destino === TRADE;
      emo = '<div class="emo tr">🐷</div>'; titulo = m.concepto || (aTR ? 'Ahorro' : 'Desde Trade Republic');
      sub.push(aTR ? 'A Trade Republic' : 'De Trade Republic a Santander');
      imp = (aTR ? '−' : '+') + fmt(m.importe); cls = aTR ? '' : 'pos';
    } else if (m.tipo === 'ingreso') {
      emo = '<div class="emo">' + (m.pagaDeuda ? '💸' : icono(m.cat)) + '</div>';
      titulo = m.concepto || (m.pagaDeuda ? 'Pago de ' + m.pagaDeuda : m.sub || m.cat || 'Ingreso');
      sub.push(m.pagaDeuda ? 'Salda deuda de ' + esc(m.pagaDeuda) : esc(m.cat + (m.sub && m.sub !== m.cat ? ' › ' + m.sub : '')));
      imp = '+' + fmt(m.importe); cls = 'pos';
    } else {
      emo = '<div class="emo">' + icono(m.cat) + '</div>'; titulo = m.concepto || m.sub || m.cat || 'Gasto';
      sub.push(esc(m.cat + (m.sub ? ' › ' + m.sub : '')));
      if (m.miParte !== '' && m.miParte != null) sub.push('tu parte ' + fmt(m.miParte));
      imp = '−' + fmt(m.importe); cls = 'neg';
    }
    signo = imp;
    return '<div class="item tap" data-act="editar" data-id="' + esc(m.id) + '">' + emo + '<div class="grow"><div class="t">' + esc(titulo) + '</div><small>' + sub.join(' · ') + '</small></div><span class="amt ' + cls + '">' + signo + '</span></div>';
  }

  // ---------- Movimientos (buscador) ----------
  function rangoFechas() {
    var t = hoy(), mes = C.mesDe(t);
    if (ui.rango === 'mes') return [mes + '-01', '9999-12-31'];
    if (ui.rango === '3m') return [C.mesAnt(C.mesAnt(mes)) + '-01', '9999-12-31'];
    if (ui.rango === 'anio') return [t.slice(0, 4) + '-01-01', '9999-12-31'];
    if (ui.rango === 'fechas') return [ui.desde || '0000-01-01', ui.hasta || '9999-12-31'];
    return ['0000-01-01', '9999-12-31'];
  }
  function vistaMovimientos() {
    var r = rangoFechas(), q = normal(ui.q).trim();
    var movs = V.movimientos.filter(function (m) {
      if (m.fecha < r[0] || m.fecha > r[1]) return false;
      if (!q) return true;
      return normal([m.concepto, m.cat, m.sub, m.pagaDeuda].join(' ')).indexOf(q) >= 0;
    }).sort(ordenMovs);
    var total = movs.reduce(function (a, m) { return a + C.efecto(m, SANT); }, 0);
    var h = '<button class="back" data-act="atras">‹ Santander</button><div class="title">Movimientos</div>' +
      '<label class="search">🔍<input id="f-q" type="search" placeholder="Buscar por concepto" value="' + esc(ui.q) + '" autocomplete="off"></label>' +
      '<div class="chips">' + [['mes', 'Este mes'], ['3m', 'Últimos 3 meses'], ['anio', 'Este año'], ['todo', 'Todo'], ['fechas', '📅 Fechas']].map(function (c) {
        return '<button class="chip' + (ui.rango === c[0] ? ' on' : '') + '" data-act="rango" data-id="' + c[0] + '">' + c[1] + '</button>';
      }).join('') + '</div>';
    if (ui.rango === 'fechas') h += '<div class="daterange"><input class="input" type="date" id="f-desde" value="' + esc(ui.desde) + '" aria-label="Desde"><span class="mut">a</span><input class="input" type="date" id="f-hasta" value="' + esc(ui.hasta) + '" aria-label="Hasta"></div>';
    h += '<div class="total"><span>' + movs.length + ' movimiento' + (movs.length === 1 ? '' : 's') + '</span><b class="amt ' + (total < 0 ? 'neg' : total > 0 ? 'pos' : '') + '">' + fmt(total, true) + '</b></div>';
    if (!movs.length) return h + '<div class="empty">No hay movimientos con ese filtro.</div>';
    var mesAct = null, grupo = [];
    function cerrar() {
      if (!grupo.length) return;
      var tm = grupo.reduce(function (a, m) { return a + C.efecto(m, SANT); }, 0);
      h += '<div class="month"><span>' + nombreMes(mesAct, true) + '</span><span class="amt">' + fmt(tm, true) + '</span></div><div class="card">' + grupo.map(filaMov).join('') + '</div>';
      grupo = [];
    }
    movs.slice(0, ui.limite).forEach(function (m) {
      var mm = C.mesDe(m.fecha);
      if (mm !== mesAct) { cerrar(); mesAct = mm; }
      grupo.push(m);
    });
    cerrar();
    if (movs.length > ui.limite) h += '<button class="btn block" data-act="mas-movs">Ver más (' + (movs.length - ui.limite) + ')</button>';
    return h;
  }

  // ---------- Ahorro (Trade Republic) ----------
  function vistaAhorro() {
    var t = hoy(), ra = C.resumenAhorro(V, t);
    var h = '<div class="title"><span>Ahorro</span>' + pillHTML() + '</div>';
    h += '<div class="hero tr"><span class="label">Trade Republic · total</span><span class="big amt">' + fmt(ra.total) + '</span>' +
      '<div class="pair"><div>Aportado<b class="amt">' + fmt(ra.aportado) + '</b></div><div>Intereses<b class="amt">' + fmt(ra.intereses) + '</b></div></div></div>';
    ra.meses.forEach(function (a) {
      if (a.estado || !a.retiradas.length) return;
      a.retiradas.forEach(function (r) {
        h += '<div class="alert red">⚠️<div class="grow">El <b class="k">' + fCorta(r.fecha) + '</b> pasaste <b class="k">' + fmt(r.importe) + '</b> de Trade Republic a Santander. Revisa el ahorro de ' + C.nombreMes(a.mes) + '.</div></div>';
      });
    });
    var porAnio = {};
    ra.meses.forEach(function (a) { (porAnio[a.mes.slice(0, 4)] = porAnio[a.mes.slice(0, 4)] || []).push(a); });
    Object.keys(porAnio).sort().reverse().forEach(function (y, i) {
      var ms = porAnio[y].slice().reverse(), ap = 0, int = 0, si = 0, ev = 0;
      ms.forEach(function (a) { ap += a.neto; if (a.interesesOk) int += a.intereses; if (a.estado) { ev++; if (a.estado === 'si') si++; } });
      var abierto = LS.get('anio.' + y, i === 0);
      h += '<details class="year" data-anio="' + y + '"' + (abierto ? ' open' : '') + '><summary><span>' + y + '</span><small class="amt">' + fmt0(ap) + ' · ' + fmt(int) + ' int.</small></summary>' +
        '<div class="ysum"><div>Aportado<b class="amt">' + fmt0(ap) + '</b></div><div>Intereses<b class="amt">' + fmt(int) + '</b></div><div>Cumplidos<b>' + si + ' de ' + ev + '</b></div></div>' +
        ms.map(filaAhorro).join('') + '</details>';
    });
    h += '<p class="note">Las aportaciones se apuntan solas al marcar el ahorro en Santander, o con ＋ → Transferencia. Los intereses de cada mes se pagan el día 1 del siguiente.</p>';
    return h;
  }

  function filaAhorro(a) {
    var pct = a.objetivo > 0 ? Math.min(100, a.aportado / a.objetivo * 100) : (a.aportado > 0 ? 100 : 0);
    var h = '<div class="mrow"><div class="mtop"><span>' + nombreMes(a.mes) + '</span><button class="amt" data-act="objetivo" data-id="' + a.mes + '" aria-label="Cambiar objetivo de ' + C.nombreMes(a.mes) + '">' + fmt0(a.aportado) + ' / ' + fmt0(a.objetivo) + '</button></div>' +
      '<div class="bar"><i class="' + (pct >= 100 ? 'ok' : '') + '" style="width:' + pct + '%"></i></div>';
    if (a.retirado > 0) h += '<div class="mline"><span class="k">Retirado a Santander</span><b class="amt neg">−' + fmt(a.retirado) + '</b></div>';
    if (a.interesesOk) {
      h += '<div class="mline"><span class="k">Intereses <button class="amt" data-act="intereses" data-id="' + a.mes + '">' + fmt(a.intereses) + '</button></span>' + sw(true, 'int-off', 'data-id="' + a.mes + '" aria-label="Intereses recibidos"', 'green') + '</div>';
    } else if (a.mesTerminado) {
      h += '<div class="mline"><span class="k">Intereses (estimado) <b class="amt">' + fmt(a.interesEstimado || 0) + '</b></span>' + sw(false, 'int-on', 'data-id="' + a.mes + '" aria-label="Intereses recibidos"', 'green') + '</div>';
    } else {
      h += '<div class="mline"><span class="k">Intereses hasta hoy (est.) <b class="amt">' + fmt(a.interesEstimado || 0) + '</b></span><span class="small mut">se pagan el 1 ' + MESES[+C.mesSig(a.mes).slice(5) - 1] + '</span></div>';
    }
    h += '<div class="mline"><span class="k">Ahorro</span><div class="tri" role="radiogroup" aria-label="Ahorro de ' + C.nombreMes(a.mes) + '">' +
      [['', 'p', 'Pendiente'], ['si', 'y', '✓ Cumplido'], ['no', 'n', '✗ No']].map(function (o) {
        return '<button class="' + o[1] + (a.estado === o[0] ? ' on' : '') + '" role="radio" aria-checked="' + (a.estado === o[0]) + '" data-act="estado" data-id="' + a.mes + '" data-v="' + o[0] + '">' + o[2] + '</button>';
      }).join('') + '</div></div>';
    if (a.retiradas.length) h += '<div class="mwarn">⚠️ ' + a.retiradas.map(function (r) { return 'Sacaste ' + fmt(r.importe) + ' el ' + fCorta(r.fecha); }).join(' · ') + '</div>';
    return h + '</div>';
  }

  // ---------- Deudas ----------
  function vistaDeudas() {
    var ds = C.deudas(V), total = C.totalMeDeben(V);
    var h = '<div class="title"><span>Deudas</span>' + pillHTML() + '</div>';
    if (total > 0) h += '<div class="debts"><span>Te deben en total</span><b class="amt" style="font-size:20px">' + fmt(total) + '</b></div>';
    h += '<div class="card"><h3>Me deben <span>' + (ds.length ? 'Toca para ver el detalle' : '') + '</span></h3>' +
      (ds.length ? ds.map(function (d) {
        var p = d.items[0], resto = d.items.length - 1;
        var info = p ? esc(p.deuda.concepto || 'Gasto compartido') + ' · ' + fCorta(p.deuda.fecha) + (resto > 0 ? ' y ' + resto + ' más' : '') : '';
        if (d.pagado > 0) info += ' · pagado ' + fmt(d.pagado);
        return '<div class="item tap" data-act="persona" data-id="' + esc(d.persona) + '"><div class="emo">👤</div><div class="grow"><div class="t">' + esc(d.persona) + '</div><small>' + info + '</small></div><span class="amt neg">' + fmt(d.pendiente) + '</span><span class="chev">›</span></div>';
      }).join('') : '<div class="empty">Nadie te debe nada.</div>') + '</div>';
    h += '<p class="note">Cuando te paguen, pulsa ＋ → Ingreso y activa «Salda una deuda». Se descuenta sola.</p>';
    var debo = (V.debo || []).slice().sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
    h += '<div class="card"><h3>Debo <span>Solo recordatorio</span></h3>' +
      debo.map(function (d) {
        return '<div class="item tap" data-act="debo" data-id="' + esc(d.id) + '"><div class="emo">🧾</div><div class="grow"><div class="t">A ' + esc(d.persona) + '</div><small>' + esc(d.concepto || fCorta(d.fecha)) + '</small></div>' +
          (d.importe !== '' && d.importe != null ? '<span class="amt">' + fmt(d.importe) + '</span>' : '') + sw(false, 'debo-ok', 'data-id="' + esc(d.id) + '" aria-label="Pagado a ' + esc(d.persona) + '"') + '</div>';
      }).join('') + '<button class="addrow" data-act="debo-nuevo">＋ Añadir recordatorio</button></div>';
    return h;
  }

  // ---------- Más ----------
  function vistaMas() {
    var activos = (V.fijos || []).filter(function (f) { return f.activo !== false; }).length;
    var met = caja ? ({ passkey: 'Face ID', 'passkey-local': 'Face ID', password: 'Contraseña' }[caja.metodo] || caja.metodo) + ' · bloqueo a los 30 s' : (modo() === 'demo' ? 'Modo demo' : 'Sin proteger');
    var e = estadoTexto();
    function fila(emo, t, s, act, id) { return '<div class="item tap" data-act="' + act + '" data-id="' + id + '"><div class="emo">' + emo + '</div><div class="grow"><div class="t">' + t + '</div>' + (s ? '<small>' + s + '</small>' : '') + '</div><span class="chev">›</span></div>'; }
    var h = '<div class="title"><span>Más</span>' + pillHTML() + '</div>' + avisosGenerales();
    h += '<div class="card">' + fila('📊', 'Estadísticas', '', 'sub', 'stats') + fila('📌', 'Gastos fijos', activos + ' activos', 'sub', 'fijos') +
      fila('🏷️', 'Categorías', cats('gasto').length + cats('ingreso').length + ' categorías', 'sub', 'cats') + fila('📅', 'Meses anteriores', 'Previsto frente a real', 'sub', 'meses') + '</div>';
    h += '<div class="card">' + fila('🔒', 'Seguridad', met, 'sub', 'seguridad') +
      (modo() === 'demo' ? '' : fila('🔗', 'Conexión con la hoja', e.txt + (sync.ultimo ? ' · ' + new Date(sync.ultimo).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : ''), 'sub', 'conexion')) + '</div>';
    if (modo() === 'demo') h += '<button class="btn block" data-act="salir-demo">Salir del modo de ejemplo</button>';
    h += '<p class="note" style="text-align:center">Hucha ' + VERSION + '</p>';
    return h;
  }
  function cabSub(t) { return '<button class="back" data-act="atras">‹ Más</button><div class="title">' + t + '</div>'; }

  function vistaFijos() {
    var fs = (V.fijos || []).slice().sort(function (a, b) { return (+a.orden || 0) - (+b.orden || 0); });
    var h = cabSub('Gastos fijos') + '<div class="card">' + fs.map(function (f) {
      var ahorro = f.tipo === 'ahorro';
      var frec = f.frecuencia === 'mensual' ? 'Día ' + f.dia : f.frecuencia === 'dias' ? 'Cada ' + f.cada + ' días' : 'Sin día fijo';
      if (ahorro) frec += ' · a Trade Republic';
      if (f.activo === false) frec += ' · pausado';
      return '<div class="item tap' + (f.activo === false ? ' done' : '') + '" data-act="fijo" data-id="' + esc(f.id) + '"><div class="emo' + (ahorro ? ' tr' : '') + '">' + (ahorro ? '🐷' : icono(f.cat)) + '</div><div class="grow"><div class="t">' + esc(f.concepto) + '</div><small>' + frec + '</small></div>' +
        '<span class="amt">' + (ahorro ? fmt(C.objetivoMes(V, C.mesDe(hoy()))) : fmt(f.importe)) + '</span><span class="chev">›</span></div>';
    }).join('') + '<button class="addrow" data-act="fijo-nuevo">＋ Añadir gasto fijo</button></div>' +
      '<p class="note">No se apuntan solos: cada mes aparecen en la previsión y tú los marcas cuando te los cobren.</p>';
    return h;
  }

  function vistaCategorias() {
    function lista(tipo, titulo) {
      return '<div class="card"><h3>' + titulo + '</h3>' + cats(tipo).map(function (c) {
        return '<div class="item tap" data-act="cat" data-id="' + esc(c.cat) + '"><div class="emo">' + esc(c.icono || '•') + '</div><div class="grow"><div class="t">' + esc(c.cat) + '</div><small>' + esc(subs(c.cat).join(', ') || 'Sin subcategorías') + '</small></div><span class="chev">›</span></div>';
      }).join('') + '<button class="addrow" data-act="cat-nueva" data-id="' + tipo + '">＋ Nueva categoría</button></div>';
    }
    return cabSub('Categorías') + lista('gasto', 'Gastos') + lista('ingreso', 'Ingresos');
  }

  function vistaMeses() {
    var t = hoy(), meses = C.rangoMeses(C.mesInicio(V, t), C.mesDe(t)).reverse();
    return cabSub('Meses anteriores') + '<div class="card">' + meses.map(function (m) {
      var r = C.resumenMes(V, m);
      return '<div class="item tap" data-act="mes" data-id="' + m + '"><div class="emo">📅</div><div class="grow"><div class="t">' + nombreMes(m, true) + '</div><small>Ingresos ' + fmt(r.ingresos) + ' · ahorro ' + fmt(r.ahorro) + '</small></div><span class="amt neg">−' + fmt(r.gastos) + '</span><span class="chev">›</span></div>';
    }).join('') + '</div>';
  }

  function hbars(porCat) {
    var ks = Object.keys(porCat).filter(function (k) { return porCat[k] > 0; }).sort(function (a, b) { return porCat[b] - porCat[a]; });
    if (!ks.length) return '<div class="empty">Sin gastos en este periodo.</div>';
    var max = porCat[ks[0]];
    return ks.map(function (k) {
      return '<div class="hbar"><span>' + icono(k) + '</span><div><div class="small" style="margin-bottom:3px">' + esc(k) + '</div><div class="track"><i style="width:' + Math.max(2, porCat[k] / max * 100) + '%"></i></div></div><span class="amt">' + fmt(porCat[k]) + '</span></div>';
    }).join('') + '<div style="height:8px"></div>';
  }

  function vistaStats() {
    var t = hoy(), mes = C.mesDe(t), ini = C.mesInicio(V, t), todos = C.rangoMeses(ini, mes);
    var sel = ui.stats === 'mes' ? [mes] : ui.stats === 'anio' ? todos.filter(function (m) { return m.slice(0, 4) === mes.slice(0, 4); }) : todos;
    var tot = { ingresos: 0, gastos: 0, ahorro: 0, porCategoria: {} };
    sel.forEach(function (m) {
      var r = C.resumenMes(V, m);
      tot.ingresos += r.ingresos; tot.gastos += r.gastos; tot.ahorro += r.ahorro;
      Object.keys(r.porCategoria).forEach(function (k) { tot.porCategoria[k] = (tot.porCategoria[k] || 0) + r.porCategoria[k]; });
    });
    var tasa = tot.ingresos > 0 ? Math.round(tot.ahorro / tot.ingresos * 100) + ' %' : '—';
    var h = cabSub('Estadísticas') + '<div class="seg">' + [['mes', 'Este mes'], ['anio', 'Este año'], ['todo', 'Todo']].map(function (o) {
      return '<button class="' + (ui.stats === o[0] ? 'on' : '') + '" data-act="stats" data-id="' + o[0] + '">' + o[1] + '</button>';
    }).join('') + '</div>';
    h += '<div class="card"><h3>Resumen</h3><div class="tiles">' +
      '<div class="tile"><div class="k">Ingresos</div><div class="v amt pos">' + fmt(tot.ingresos) + '</div></div>' +
      '<div class="tile"><div class="k">Gastos (tu parte)</div><div class="v amt neg">' + fmt(tot.gastos) + '</div></div>' +
      '<div class="tile"><div class="k">Ahorro</div><div class="v amt">' + fmt(tot.ahorro) + '</div></div>' +
      '<div class="tile"><div class="k">Tasa de ahorro</div><div class="v">' + tasa + '</div></div></div></div>';
    h += '<div class="card"><h3>Gasto por categoría <span class="amt">' + fmt(tot.gastos) + '</span></h3>' + hbars(tot.porCategoria) + '</div>';

    var ult = todos.slice(-6), rs = ult.map(function (m) { return C.resumenMes(V, m); });
    var max = Math.max.apply(null, rs.map(function (r) { return Math.max(r.ingresos, r.gastos, 1); }));
    h += '<div class="card"><h3>Ingresos y gastos <span>Últimos meses</span></h3><div class="cols">' + rs.map(function (r) {
      return '<div class="col" title="' + nombreMes(r.mes) + ': ingresos ' + fmt(r.ingresos) + ', gastos ' + fmt(r.gastos) + '"><i class="a" style="height:' + (r.ingresos / max * 100) + '%"></i><i class="b" style="height:' + (r.gastos / max * 100) + '%"></i></div>';
    }).join('') + '</div><div class="collabels">' + ult.map(function (m) { return '<span>' + cap(MESES[+m.slice(5) - 1]) + '</span>'; }).join('') + '</div>' +
      '<div class="legend"><span><i style="background:var(--pos)"></i>Ingresos</span><span><i style="background:var(--acc2)"></i>Gastos</span></div></div>';

    var rp = C.resumenPrevision(V, mes, t), realH = 0, prevH = 0;
    rp.lineas.forEach(function (l) { if (l.hecho) { realH += C.num(l.hecho.importe); prevH += l.importe; } });
    var fuera = C.resumenMes(V, mes).fueraPrevision;
    h += '<div class="card"><h3>Previsión de ' + C.nombreMes(mes) + '</h3><table class="data">' +
      '<tr><td>Previsto en total</td><td class="amt">' + fmt(rp.total) + '</td></tr>' +
      '<tr><td>Pagado de lo previsto</td><td class="amt">' + fmt(realH) + (Math.abs(realH - prevH) > 0.004 ? ' <span class="mut">(previsto ' + fmt(prevH) + ')</span>' : '') + '</td></tr>' +
      '<tr><td>Pendiente</td><td class="amt">' + fmt(rp.pendiente) + '</td></tr>' +
      '<tr><td>Gastos fuera de la previsión</td><td class="amt">' + fmt(fuera) + '</td></tr></table><div style="height:6px"></div></div>';

    var ult12 = todos.slice(-12), saldos = ult12.map(function (m) { var f = C.finDeMes(m); return C.saldo(V, TRADE, f > t ? t : f); });
    var maxT = Math.max.apply(null, saldos.concat([1]));
    h += '<div class="card"><h3>Trade Republic <span class="amt">' + fmt(saldos[saldos.length - 1] || 0) + '</span></h3><div class="cols">' + saldos.map(function (s, i) {
      return '<div class="col" title="' + nombreMes(ult12[i]) + ': ' + fmt(s) + '"><i class="c" style="height:' + Math.max(0, s / maxT * 100) + '%"></i></div>';
    }).join('') + '</div><div class="collabels">' + ult12.map(function (m) { return '<span>' + cap(MESES[+m.slice(5) - 1]).slice(0, ult12.length > 8 ? 1 : 3) + '</span>'; }).join('') + '</div></div>';

    var am = todos.map(function (m) { return C.ahorroMes(V, m, t); }), cumplidos = am.filter(function (a) { return a.estado === 'si'; }).length, eval_ = am.filter(function (a) { return a.estado; }).length;
    h += '<div class="card"><h3>Meses de ahorro <span>' + cumplidos + ' de ' + eval_ + ' cumplidos</span></h3><div class="cal">' + am.map(function (a) {
      return '<div class="' + (a.estado === 'si' ? 'y' : a.estado === 'no' ? 'n' : '') + '" title="' + nombreMes(a.mes, true) + '">' + cap(MESES[+a.mes.slice(5) - 1]) + (a.mes.slice(0, 4) !== mes.slice(0, 4) ? " '" + a.mes.slice(2, 4) : '') + '</div>';
    }).join('') + '</div></div>';
    return h;
  }

  function vistaSeguridad() {
    var h = cabSub('Seguridad');
    if (modo() === 'demo') return h + '<p class="note">En el modo de ejemplo no se guarda nada protegido. Conecta tu hoja para activar Face ID.</p>';
    h += '<div class="card"><div class="pad" style="padding-top:12px">' + (caja
      ? '🔒 Los datos de este móvil están cifrados (AES-256). Se abren con ' + (caja.metodo === 'password' ? 'tu contraseña' : 'Face ID') + ' y se bloquean solos a los 30 s fuera de la app.'
      : '⚠️ Este móvil aún no está protegido.') + '</div></div>';
    if (caja) h += '<button class="btn block" data-act="bloquear">Bloquear ahora</button>';
    h += '<button class="btn block" data-act="proteger">' + (caja ? 'Cambiar Face ID / contraseña' : 'Proteger con Face ID') + '</button>';
    if (seguridad) h += '<p class="note">Intentos con clave incorrecta en los últimos 7 días: ' + (seguridad.fallos7d || 0) + '.</p>';
    return h;
  }

  function vistaConexion() {
    var e = estadoTexto();
    var h = cabSub('Conexión') + '<div class="field">' +
      '<div class="frow"><span class="k">URL</span><input id="a-url" value="' + esc(sesion.url) + '" autocomplete="off" autocapitalize="off" spellcheck="false"></div>' +
      '<div class="frow"><span class="k">Clave secreta</span><input id="a-clave" type="password" value="' + esc(sesion.clave) + '" autocomplete="off"></div></div>' +
      '<button class="btn block" data-act="guardar-conexion">Guardar</button>' +
      '<div class="card"><div class="item"><div class="grow"><div class="t">Estado: ' + e.txt + '</div>' + (sync.error ? '<small class="neg">' + esc(sync.error) + '</small>' : '') +
      (sync.ultimo ? '<small>Última sincronización: ' + new Date(sync.ultimo).toLocaleString('es-ES') + '</small>' : '') + '</div><button class="btn small" data-act="sync">Sincronizar</button></div></div>';
    if (queue.length && sync.estado === 'err') h += '<button class="btn block danger" data-act="descartar-cola">Descartar ' + queue.length + ' cambio(s) sin enviar</button>';
    h += '<button class="btn block danger" data-act="reconectar">Reconectar desde cero</button>' +
      '<p class="note">«Reconectar desde cero» borra los datos de este móvil (tu hoja de Google no se toca) y vuelve a pedir la URL y la clave.</p>';
    return h;
  }

  // ---------------------------------------------------------------- hojas (ventanas inferiores)
  var hoja = null;
  /**
   * o: {titulo, html, guardar (texto del botón), onGuardar(), onClick(e), onInput(e), onMount(body), fija}
   */
  function abrirHoja(o) {
    cerrarHoja();
    hoja = document.createElement('div');
    hoja.className = 'overlay';
    if (o.fija) hoja.dataset.fija = '1';
    hoja.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(o.titulo) + '"><div class="sheet-top"><div class="grab"></div><div class="sheet-head">' +
      (o.fija ? '<span style="min-width:70px"></span>' : '<button class="cancel" data-h="cancel">Cancelar</button>') + '<b>' + esc(o.titulo) + '</b>' +
      (o.guardar ? '<button class="save" data-h="save">' + esc(o.guardar) + '</button>' : '<span style="min-width:70px"></span>') +
      '</div></div><div class="sheet-body">' + (o.html || '') + '</div></div>';
    var el = hoja, body = $('.sheet-body', el);
    el._o = o;
    el.addEventListener('click', function (e) {
      if (e.target === el) { if (!o.fija) cerrarHoja(true); return; }
      var hb = e.target.closest('[data-h]');
      if (hb) { if (hb.dataset.h === 'cancel') cerrarHoja(true); else if (o.onGuardar) o.onGuardar(); return; }
      if (o.onClick) o.onClick(e);
    });
    if (o.onInput) { el.addEventListener('input', o.onInput); el.addEventListener('change', o.onInput); }
    if (!o.fija) deslizarParaCerrar(el);
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    if (o.onMount) o.onMount(body);
    return body;
  }
  function cerrarHoja(animado) {
    var el = hoja;
    if (el) {
      hoja = null;
      if (animado) {
        var sh = $('.sheet', el);
        sh.style.transition = 'transform .2s ease-in'; sh.style.transform = 'translateY(100%)';
        el.style.transition = 'opacity .2s'; el.style.opacity = '0';
        setTimeout(function () { el.remove(); }, 200);
      } else el.remove();
      render();
    }
    document.body.style.overflow = '';
  }
  /** Arrastrar la hoja hacia abajo (desde arriba del todo) la cierra. */
  function deslizarParaCerrar(ov) {
    var sh = $('.sheet', ov), y0 = 0, x0 = 0, t0 = 0, dy = 0, estado = 0;
    sh.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { estado = -1; return; }
      var enCabecera = !!e.target.closest('.sheet-top');
      estado = (sh.scrollTop <= 0 || enCabecera) && !e.target.closest('input,select,textarea') ? 1 : -1;
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; t0 = Date.now(); dy = 0;
    }, { passive: true });
    sh.addEventListener('touchmove', function (e) {
      if (estado <= 0) return;
      var y = e.touches[0].clientY - y0, x = e.touches[0].clientX - x0;
      if (estado === 1) {
        if (Math.abs(y) < 6 && Math.abs(x) < 6) return;
        if (y <= 0 || Math.abs(x) > Math.abs(y)) { estado = -1; return; }
        estado = 2; sh.style.transition = 'none';
      }
      dy = Math.max(0, y);
      sh.style.transform = 'translateY(' + dy + 'px)';
      ov.style.backgroundColor = 'rgba(0,0,0,' + (0.35 * Math.max(0, 1 - dy / 400)) + ')';
      e.preventDefault();
    }, { passive: false });
    function fin() {
      if (estado !== 2) { estado = 0; return; }
      estado = 0;
      var v = dy / Math.max(1, Date.now() - t0);
      if (dy > 110 || (dy > 40 && v > 0.6)) { cerrarHoja(true); return; }
      sh.style.transition = 'transform .2s ease-out'; sh.style.transform = '';
      ov.style.backgroundColor = '';
    }
    sh.addEventListener('touchend', fin);
    sh.addEventListener('touchcancel', fin);
  }
  /** Repinta el contenido de la hoja abierta conservando el desplazamiento. */
  function repintar(body, html) {
    var sh = body.parentNode, y = sh.scrollTop;
    body.innerHTML = html; sh.scrollTop = y;
  }
  function error(body, msg) { var e = $('.hint.bad', body) || $('[data-err]', body); if (e) { e.textContent = msg; e.className = 'hint bad'; } else toast(msg); }

  // ---------- Formulario de movimiento ----------
  function abrirMovimiento(m, preset) {
    var t = hoy(), f;
    if (m) {
      var ds = (V.deudas || []).filter(function (d) { return d.movId === m.id; });
      f = {
        id: m.id, tipo: m.tipo, cat: m.cat, sub: m.sub, concepto: m.concepto || '', importe: aInput(m.importe), fecha: m.fecha,
        compartido: m.tipo === 'gasto' && m.miParte !== '' && m.miParte != null, miParte: aInput(m.miParte),
        personas: ds.map(function (d) { return { nombre: d.persona, importe: aInput(d.importe) }; }),
        salda: m.pagaDeuda || '', dir: m.cuenta === TRADE ? 'ts' : 'st', previsto: m.previsto || '', prevImporte: m.prevImporte === undefined ? '' : m.prevImporte
      };
    } else {
      f = { id: '', tipo: 'gasto', cat: '', sub: '', concepto: '', importe: '', fecha: t, compartido: false, miParte: '', personas: [], salda: '', dir: 'st', previsto: '', prevImporte: '' };
      for (var k in (preset || {})) f[k] = preset[k];
    }
    if (f.compartido && !f.personas.length) f.personas.push({ nombre: '', importe: '' });

    function pintar() {
      var h = '<div class="seg">' + [['gasto', 'Gasto'], ['ingreso', 'Ingreso'], ['transferencia', 'Transferencia']].map(function (o) {
        return '<button class="' + (f.tipo === o[0] ? 'on' : '') + '" data-set="tipo" data-v="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div>';
      if (f.tipo === 'transferencia') {
        h += '<div class="seg"><button class="' + (f.dir === 'st' ? 'on' : '') + '" data-set="dir" data-v="st">Santander → Trade</button><button class="' + (f.dir === 'ts' ? 'on' : '') + '" data-set="dir" data-v="ts">Trade → Santander</button></div>';
      }
      if (f.tipo === 'ingreso') {
        var ds = C.deudas(V), nombres = ds.map(function (d) { return d.persona; });
        if (f.salda && nombres.map(C.clavePersona).indexOf(C.clavePersona(f.salda)) < 0) nombres.unshift(f.salda);
        h += '<div class="field"><div class="frow"><span>Salda una deuda</span>' + sw(!!f.salda || f.saldaOn, 'toggle-salda') + '</div></div>';
        if (f.salda || f.saldaOn) {
          h += nombres.length ? '<div class="chips wrap">' + nombres.map(function (n) {
            var d = ds.filter(function (x) { return C.clavePersona(x.persona) === C.clavePersona(n); })[0];
            return '<button class="chip' + (C.clavePersona(f.salda) === C.clavePersona(n) ? ' on' : '') + '" data-set="salda" data-v="' + esc(n) + '">' + esc(n) + (d ? ' · ' + fmt(d.pendiente) : '') + '</button>';
          }).join('') + '</div>' : '<p class="hint">Nadie te debe nada ahora mismo.</p>';
        }
      }
      if ((f.tipo === 'gasto' || f.tipo === 'ingreso') && !(f.tipo === 'ingreso' && (f.salda || f.saldaOn))) {
        h += '<div class="cats">' + cats(f.tipo).map(function (c) {
          return '<button class="cat' + (f.cat === c.cat ? ' on' : '') + '" data-set="cat" data-v="' + esc(c.cat) + '"><span>' + esc(c.icono || '•') + '</span>' + esc(c.cat) + '</button>';
        }).join('') + '</div>';
        var ss = f.cat ? subs(f.cat) : [];
        if (ss.length) h += '<div class="chips">' + ss.map(function (s) { return '<button class="chip' + (f.sub === s ? ' on' : '') + '" data-set="sub" data-v="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div>';
      }
      h += '<div class="field">' +
        '<div class="frow"><span class="k">Concepto</span><input data-f="concepto" value="' + esc(f.concepto) + '" placeholder="' + esc(placeholderConcepto()) + '" maxlength="120" enterkeyhint="done"></div>' +
        '<div class="frow"><span class="k">Cantidad</span><input class="big amt" data-f="importe" inputmode="decimal" placeholder="0,00 €" value="' + esc(f.importe) + '" enterkeyhint="done"></div>' +
        '<div class="frow"><span class="k">Fecha</span><input type="date" data-f="fecha" value="' + esc(f.fecha) + '"></div></div>';
      if (f.tipo === 'gasto') {
        h += '<div class="field"><div class="frow"><span>Compartido</span>' + sw(f.compartido, 'toggle-comp') + '</div>';
        if (f.compartido) {
          h += '<div class="frow"><span class="k">Mi parte</span><input class="amt" data-f="miParte" inputmode="decimal" placeholder="0,00 €" value="' + esc(f.miParte) + '"></div>';
          f.personas.forEach(function (p, i) {
            h += '<div class="person"><span>👤</span><input class="name" data-p="' + i + '" data-pk="nombre" list="dl-personas" placeholder="Nombre" value="' + esc(p.nombre) + '" maxlength="40" autocapitalize="words">' +
              '<input class="imp amt" data-p="' + i + '" data-pk="importe" inputmode="decimal" placeholder="0,00 €" value="' + esc(p.importe) + '"><button class="x" data-act="quitar-persona" data-i="' + i + '" aria-label="Quitar">✕</button></div>';
          });
          h += '<div class="frow"><button class="link" data-act="add-persona">＋ Añadir persona</button><button class="link" data-act="repartir">Repartir a partes iguales</button></div>';
        }
        h += '</div><datalist id="dl-personas">' + C.personasConocidas(V).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>';
      }
      h += '<p class="hint" data-err>' + esc(pista()) + '</p>';
      if (f.previsto) h += '<p class="note">Viene de la previsión del mes' + (f.prevImporte !== '' ? ' (previsto ' + fmt(f.prevImporte) + ')' : '') + '.</p>';
      if (f.id) h += '<button class="btn block danger" data-act="borrar-mov">Borrar movimiento</button>';
      return h;
    }
    function placeholderConcepto() {
      if (f.tipo === 'transferencia') return f.dir === 'st' ? 'Ahorro ' + C.nombreMes(C.mesDe(f.fecha || t)) : 'Traspaso a Santander';
      if (f.salda) return 'Bizum de ' + f.salda;
      return f.sub || f.cat || 'Ej.: Mercadona';
    }
    function pista() {
      if (f.tipo !== 'gasto' || !f.compartido) return '';
      var imp = C.num(f.importe), mia = C.num(f.miParte), otros = f.personas.reduce(function (a, p) { return a + C.num(p.importe); }, 0);
      var falta = C.r2(imp - mia - otros);
      if (!imp) return '';
      if (Math.abs(falta) < 0.005) return 'Te deben ' + fmt(otros) + ' en total.';
      return falta > 0 ? 'Falta repartir ' + fmt(falta) + '.' : 'Te pasas en ' + fmt(-falta) + '.';
    }
    function actualizarPista() { var p = $('[data-err]', body); if (p) { p.textContent = pista(); p.className = 'hint'; } }

    var body = abrirHoja({
      titulo: f.id ? 'Editar' : 'Nuevo', guardar: 'Guardar', html: pintar(),
      onGuardar: guardar,
      onInput: function (e) {
        var el = e.target;
        if (el.dataset.f) { f[el.dataset.f] = el.value; actualizarPista(); }
        else if (el.dataset.p !== undefined) { f.personas[+el.dataset.p][el.dataset.pk] = el.value; actualizarPista(); }
      },
      onClick: function (e) {
        var s = e.target.closest('[data-set]'), a = e.target.closest('[data-act]');
        if (s) {
          var k = s.dataset.set, v = s.dataset.v;
          if (k === 'tipo' && f.tipo !== v) { f.tipo = v; f.cat = ''; f.sub = ''; }
          else if (k === 'cat') { f.cat = v; f.sub = ''; }
          else if (k === 'sub') f.sub = f.sub === v ? '' : v;
          else if (k === 'salda') { f.salda = v; var d = C.deudas(V).filter(function (x) { return C.clavePersona(x.persona) === C.clavePersona(v); })[0]; if (d && !f.importe) f.importe = aInput(d.pendiente); }
          else f[k] = v;
          repintar(body, pintar()); return;
        }
        if (!a) return;
        var act = a.dataset.act;
        if (act === 'toggle-comp') { f.compartido = !f.compartido; if (f.compartido && !f.personas.length) f.personas.push({ nombre: '', importe: '' }); }
        else if (act === 'toggle-salda') { if (f.salda || f.saldaOn) { f.salda = ''; f.saldaOn = false; } else f.saldaOn = true; }
        else if (act === 'add-persona') f.personas.push({ nombre: '', importe: '' });
        else if (act === 'quitar-persona') f.personas.splice(+a.dataset.i, 1);
        else if (act === 'repartir') {
          var n = f.personas.length, resto = C.num(f.importe) - C.num(f.miParte);
          if (n && resto > 0) {
            var cada = Math.floor(resto / n * 100) / 100;
            f.personas.forEach(function (p, i) { p.importe = aInput(i === n - 1 ? C.r2(resto - cada * (n - 1)) : cada); });
          }
        } else if (act === 'borrar-mov') { confirmarBorrado(f); return; }
        else return;
        repintar(body, pintar());
      }
    });

    function guardar() {
      var importe = C.r2(C.num(f.importe));
      if (!(importe > 0)) return error(body, 'Escribe la cantidad.');
      if (!f.fecha) return error(body, 'Elige la fecha.');
      if (f.tipo === 'ingreso' && f.saldaOn && !f.salda) return error(body, 'Elige quién te ha pagado.');
      if (f.tipo !== 'transferencia' && !f.salda && !f.cat) return error(body, 'Elige una categoría.');
      var m2 = {
        id: f.id || C.uid(), fecha: f.fecha, tipo: f.tipo, importe: importe, cuenta: SANT, destino: '',
        cat: f.cat, sub: f.sub, concepto: (f.concepto || '').trim() || placeholderConcepto().replace(/^Ej\.: .*/, ''),
        miParte: '', pagaDeuda: '', previsto: f.previsto || '', prevImporte: f.prevImporte, act: Date.now()
      };
      if (!m2.concepto) m2.concepto = f.sub || f.cat;
      var ops = [];
      if (f.tipo === 'transferencia') {
        m2.cuenta = f.dir === 'st' ? SANT : TRADE; m2.destino = f.dir === 'st' ? TRADE : SANT; m2.cat = 'Ahorro'; m2.sub = 'Trade Republic';
      } else if (f.tipo === 'ingreso' && f.salda) { m2.cat = ''; m2.sub = ''; m2.pagaDeuda = f.salda.trim(); }
      var lista = [];
      if (f.tipo === 'gasto' && f.compartido) {
        var mia = C.r2(C.num(f.miParte));
        var ps = f.personas.filter(function (p) { return p.nombre.trim() || C.num(p.importe); });
        if (!ps.length) return error(body, 'Añade quién te debe su parte.');
        for (var i = 0; i < ps.length; i++) {
          if (!ps[i].nombre.trim()) return error(body, 'Falta el nombre de una persona.');
          if (!(C.num(ps[i].importe) > 0)) return error(body, 'Falta lo que debe ' + ps[i].nombre.trim() + '.');
        }
        var suma = C.r2(mia + ps.reduce(function (a, p) { return a + C.num(p.importe); }, 0));
        if (Math.abs(suma - importe) > 0.005) return error(body, 'Tu parte más lo que te deben tiene que sumar ' + fmt(importe) + '.');
        m2.miParte = mia;
        lista = ps.map(function (p) { return { id: C.uid(), movId: m2.id, fecha: m2.fecha, persona: p.nombre.trim(), importe: C.r2(C.num(p.importe)), concepto: m2.concepto }; });
      }
      ops.push({ op: 'mov', mov: m2 });
      var teniaDeudas = f.id && (V.deudas || []).some(function (d) { return d.movId === f.id; });
      if (lista.length || teniaDeudas) ops.push({ op: 'deudas', movId: m2.id, lista: lista });
      var nuevo = !f.id;
      cerrarHoja(true);
      commit(ops);
      toast(nuevo ? 'Apuntado' : 'Guardado');
      if (nuevo && m2.tipo === 'ingreso' && m2.cat === 'Nómina') {
        var ah = C.prevision(V, C.mesDe(hoy()), hoy()).filter(function (l) { return l.esAhorro && !l.hecho; })[0];
        if (ah) setTimeout(function () { abrirMarcar(ah, '¿Transfieres ya el ahorro a Trade Republic?'); }, 400);
      }
    }
  }

  function confirmarBorrado(f) {
    abrirHoja({
      titulo: 'Borrar movimiento', html: '<p>Se borrará «' + esc(f.concepto || 'movimiento') + '» de ' + fmt(C.num(f.importe)) + (f.previsto ? ' y la partida volverá a pendientes' : '') + '.</p><button class="btn block danger" data-act="si">Borrar</button>',
      onClick: function (e) { if (e.target.closest('[data-act="si"]')) { cerrarHoja(true); commit([{ op: 'borrar', id: f.id }]); toast('Borrado'); } }
    });
  }

  // ---------- Marcar / desmarcar partidas y fijos ----------
  function abrirMarcar(l, mensaje) {
    var s = { importe: aInput(l.importe), fecha: hoy() };
    var html = (mensaje ? '<p class="note" style="margin:0">' + esc(mensaje) + '</p>' : '') +
      '<div class="field"><div class="frow"><span class="k">Cantidad</span><input class="big amt" data-f="importe" inputmode="decimal" value="' + esc(s.importe) + '"></div>' +
      '<div class="frow"><span class="k">Fecha</span><input type="date" data-f="fecha" value="' + s.fecha + '"></div></div>' +
      '<p class="hint">' + (l.esAhorro ? 'Se apuntará como transferencia de Santander a Trade Republic.' : 'Se apuntará como gasto en ' + esc(l.cat || 'su categoría') + '. Corrige la cantidad si no coincide.') + '</p>' +
      '<button class="btn primary block" data-act="ok">Marcar como pagado</button>';
    var body = abrirHoja({
      titulo: l.concepto, guardar: '', html: html,
      onInput: function (e) { if (e.target.dataset.f) s[e.target.dataset.f] = e.target.value; },
      onClick: function (e) { if (e.target.closest('[data-act="ok"]')) ok(); }
    });
    function ok() {
      var imp = C.r2(C.num(s.importe));
      if (!(imp > 0)) return error(body, 'Escribe la cantidad.');
      if (!s.fecha) return error(body, 'Elige la fecha.');
      var m = {
        id: C.uid(), fecha: s.fecha, tipo: l.esAhorro ? 'transferencia' : 'gasto', importe: imp, cuenta: SANT, destino: l.esAhorro ? TRADE : '',
        cat: l.cat || '', sub: l.sub || '', concepto: l.concepto, miParte: '', pagaDeuda: '', previsto: l.clave, prevImporte: C.r2(l.importe), act: Date.now()
      };
      cerrarHoja(true);
      commit([{ op: 'mov', mov: m }]);
      toast('✓ ' + l.concepto);
    }
  }
  function abrirDesmarcar(l) {
    var m = l.hecho;
    abrirHoja({
      titulo: 'Desmarcar', html: '<p>Se borrará el movimiento «' + esc(l.concepto) + '» de ' + fmt(m.importe) + ' del ' + fCorta(m.fecha) + ' y volverá a la lista de pendientes.</p><button class="btn block danger" data-act="si">Desmarcar</button>',
      onClick: function (e) { if (e.target.closest('[data-act="si"]')) { cerrarHoja(true); commit([{ op: 'borrar', id: m.id }]); } }
    });
  }

  // ---------- Partida de previsión ----------
  function opcionesCat(tipo, sel, vacio) {
    return (vacio ? '<option value="">' + vacio + '</option>' : '') + cats(tipo).map(function (c) { return '<option value="' + esc(c.cat) + '"' + (c.cat === sel ? ' selected' : '') + '>' + esc((c.icono ? c.icono + ' ' : '') + c.cat) + '</option>'; }).join('');
  }
  function opcionesSub(cat, sel) {
    return '<option value="">—</option>' + subs(cat).map(function (s) { return '<option' + (s === sel ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('');
  }
  function abrirPartida(p) {
    var s = p ? clone(p) : { id: '', mes: C.mesDe(hoy()), concepto: '', importe: '', cat: '', sub: '' };
    s.importe = aInput(s.importe);
    function pintar() {
      return '<div class="field"><div class="frow"><span class="k">Concepto</span><input data-f="concepto" value="' + esc(s.concepto) + '" placeholder="Ej.: Cena cumpleaños" maxlength="80"></div>' +
        '<div class="frow"><span class="k">Importe previsto</span><input class="big amt" data-f="importe" inputmode="decimal" placeholder="0,00 €" value="' + esc(s.importe) + '"></div>' +
        '<div class="frow"><span class="k">Categoría</span><select data-f="cat">' + opcionesCat('gasto', s.cat, 'Elegir…') + '</select></div>' +
        (s.cat && subs(s.cat).length ? '<div class="frow"><span class="k">Subcategoría</span><select data-f="sub">' + opcionesSub(s.cat, s.sub) + '</select></div>' : '') + '</div>' +
        '<p class="hint" data-err>Para ' + C.nombreMes(s.mes) + '. Cuando ocurra, marca el interruptor y corrige el importe real.</p>' +
        (s.id ? '<button class="btn block danger" data-act="borrar">Borrar partida</button>' : '');
    }
    var body = abrirHoja({
      titulo: s.id ? 'Partida' : 'Nueva partida', guardar: 'Guardar', html: pintar(),
      onInput: function (e) {
        var k = e.target.dataset.f; if (!k) return;
        s[k] = e.target.value;
        if (k === 'cat' && e.type === 'change') { s.sub = ''; repintar(body, pintar()); }
      },
      onClick: function (e) { if (e.target.closest('[data-act="borrar"]')) { cerrarHoja(true); commit([{ op: 'borrarPrev', id: s.id }]); toast('Partida borrada'); } },
      onGuardar: function () {
        var imp = C.r2(C.num(s.importe));
        if (!s.concepto.trim()) return error(body, 'Escribe el concepto.');
        if (!(imp > 0)) return error(body, 'Escribe el importe previsto.');
        cerrarHoja(true);
        commit([{ op: 'prev', prev: { id: s.id || C.uid(), mes: s.mes, concepto: s.concepto.trim(), importe: imp, cat: s.cat, sub: s.sub } }]);
        toast('Partida guardada');
      }
    });
  }

  // ---------- Ahorro: objetivo e intereses ----------
  function abrirObjetivo(mes) {
    var a = C.ahorroMes(V, mes, hoy()), s = { v: aInput(a.objetivo) };
    var body = abrirHoja({
      titulo: 'Objetivo de ' + C.nombreMes(mes), html:
        '<div class="field"><div class="frow"><span class="k">Objetivo</span><input class="big amt" data-f="v" inputmode="decimal" value="' + esc(s.v) + '"></div></div>' +
        '<p class="hint" data-err>Lo que quieres meter en Trade Republic ese mes.</p>' +
        '<button class="btn primary block" data-act="solo">Solo para ' + C.nombreMes(mes) + '</button>' +
        '<button class="btn block" data-act="siempre">Para ' + C.nombreMes(mes) + ' y los meses siguientes</button>',
      onInput: function (e) { if (e.target.dataset.f) s.v = e.target.value; },
      onClick: function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var v = C.r2(C.num(s.v));
        if (!(v >= 0)) return error(body, 'Escribe un importe.');
        var ops = [];
        if (b.dataset.act === 'solo') ops.push({ op: 'ahorro', mes: mes, objetivo: v });
        else {
          // Los meses anteriores conservan el objetivo que tenían.
          var viejo = C.num(C.cfg(V, 'objetivoAhorro', 0));
          C.rangoMeses(C.mesInicio(V, hoy()), C.mesAnt(mes)).forEach(function (m) {
            var fila = C.filaAhorro(V, m);
            if (!fila || fila.objetivo === '' || fila.objetivo == null) ops.push({ op: 'ahorro', mes: m, objetivo: viejo });
          });
          ops.push({ op: 'config', clave: 'objetivoAhorro', valor: v });
          ops.push({ op: 'ahorro', mes: mes, objetivo: '' });
          (V.ahorro || []).forEach(function (f) { if (f.mes > mes && f.objetivo !== '' && f.objetivo != null) ops.push({ op: 'ahorro', mes: f.mes, objetivo: '' }); });
        }
        cerrarHoja(true); commit(ops); toast('Objetivo guardado');
      }
    });
  }
  function abrirIntereses(mes) {
    var a = C.ahorroMes(V, mes, hoy()), s = { v: aInput(a.interesesOk ? a.intereses : (a.interesEstimado || 0)) };
    var body = abrirHoja({
      titulo: 'Intereses de ' + C.nombreMes(mes), guardar: 'Guardar', html:
        '<div class="field"><div class="frow"><span class="k">Recibido (neto)</span><input class="big amt" data-f="v" inputmode="decimal" value="' + esc(s.v) + '"></div></div>' +
        '<p class="hint" data-err>Estimado: ' + fmt(a.interesEstimado || 0) + ' netos. Se pagan el 1 de ' + C.nombreMes(C.mesSig(mes)) + '. Si no coincide, escribe lo que ha llegado.</p>',
      onInput: function (e) { if (e.target.dataset.f) s.v = e.target.value; },
      onGuardar: function () {
        var v = C.r2(C.num(s.v));
        if (!(v >= 0)) return error(body, 'Escribe el importe.');
        cerrarHoja(true); commit([{ op: 'ahorro', mes: mes, intereses: v, interesesOk: true }]); toast('Intereses confirmados');
      }
    });
  }

  // ---------- Deudas ----------
  function abrirPersona(nombre) {
    var d = C.deudas(V).filter(function (x) { return C.clavePersona(x.persona) === C.clavePersona(nombre); })[0];
    if (!d) return;
    abrirHoja({
      titulo: d.persona, html:
        '<div class="debts"><span>Te debe</span><b class="amt" style="font-size:20px">' + fmt(d.pendiente) + '</b></div>' +
        '<div class="card">' + d.items.map(function (it) {
          return '<div class="item"><div class="emo">' + icono((mov(it.deuda.movId) || {}).cat) + '</div><div class="grow"><div class="t">' + esc(it.deuda.concepto || 'Gasto compartido') + '</div><small>' + fCorta(it.deuda.fecha) + ' · ' + fmt(it.deuda.importe) + (it.pagado > 0 ? ' · pagado ' + fmt(it.pagado) : '') + '</small></div><span class="amt neg">' + fmt(it.restante) + '</span></div>';
        }).join('') + '</div>' +
        (d.pagado > 0 ? '<p class="hint">Te ha pagado ' + fmt(d.pagado) + ' hasta ahora.</p>' : '') +
        '<button class="btn primary block" data-act="pago">Registrar un pago (Bizum)</button>',
      onClick: function (e) {
        if (!e.target.closest('[data-act="pago"]')) return;
        cerrarHoja();
        abrirMovimiento(null, { tipo: 'ingreso', salda: d.persona, importe: aInput(d.pendiente) });
      }
    });
  }
  function abrirDebo(d) {
    var s = d ? clone(d) : { id: '', persona: '', concepto: '', importe: '', fecha: hoy() };
    s.importe = aInput(s.importe);
    var body = abrirHoja({
      titulo: s.id ? 'Recordatorio' : 'Nuevo recordatorio', guardar: 'Guardar', html:
        '<div class="field"><div class="frow"><span class="k">A quién</span><input data-f="persona" value="' + esc(s.persona) + '" placeholder="Nombre" maxlength="40" autocapitalize="words"></div>' +
        '<div class="frow"><span class="k">Por qué</span><input data-f="concepto" value="' + esc(s.concepto) + '" placeholder="Ej.: Regalo de Paula" maxlength="120"></div>' +
        '<div class="frow"><span class="k">Cantidad</span><input class="amt" data-f="importe" inputmode="decimal" placeholder="Opcional" value="' + esc(s.importe) + '"></div></div>' +
        '<p class="hint" data-err>Solo es un recordatorio: no cambia tu saldo. Cuando pagues, apúntalo como un gasto normal.</p>' +
        (s.id ? '<button class="btn block danger" data-act="borrar">Quitar de la lista</button>' : ''),
      onInput: function (e) { if (e.target.dataset.f) s[e.target.dataset.f] = e.target.value; },
      onClick: function (e) { if (e.target.closest('[data-act="borrar"]')) { cerrarHoja(true); commit([{ op: 'borrarDebo', id: s.id }]); } },
      onGuardar: function () {
        if (!s.persona.trim()) return error(body, 'Escribe a quién se lo debes.');
        cerrarHoja(true);
        commit([{ op: 'debo', debo: { id: s.id || C.uid(), persona: s.persona.trim(), concepto: s.concepto.trim(), importe: s.importe === '' ? '' : C.r2(C.num(s.importe)), fecha: s.fecha } }]);
      }
    });
  }

  // ---------- Gastos fijos ----------
  function abrirFijo(fj) {
    var s = fj ? clone(fj) : { id: '', concepto: '', tipo: 'gasto', importe: '', cat: '', sub: '', frecuencia: 'mensual', dia: '', cada: '', desde: '', activo: true, orden: '' };
    s.importe = aInput(s.importe); s.dia = s.dia === '' ? '' : String(s.dia); s.cada = s.cada === '' ? '' : String(s.cada);
    function pintar() {
      var h = '<div class="seg"><button class="' + (s.tipo === 'gasto' ? 'on' : '') + '" data-set="tipo" data-v="gasto">Gasto</button><button class="' + (s.tipo === 'ahorro' ? 'on' : '') + '" data-set="tipo" data-v="ahorro">Ahorro a Trade Republic</button></div>' +
        '<div class="field"><div class="frow"><span class="k">Concepto</span><input data-f="concepto" value="' + esc(s.concepto) + '" placeholder="Ej.: Seguro médico" maxlength="80"></div>';
      if (s.tipo === 'gasto') {
        h += '<div class="frow"><span class="k">Importe</span><input class="big amt" data-f="importe" inputmode="decimal" placeholder="0,00 €" value="' + esc(s.importe) + '"></div>' +
          '<div class="frow"><span class="k">Categoría</span><select data-f="cat">' + opcionesCat('gasto', s.cat, 'Elegir…') + '</select></div>' +
          (s.cat && subs(s.cat).length ? '<div class="frow"><span class="k">Subcategoría</span><select data-f="sub">' + opcionesSub(s.cat, s.sub) + '</select></div>' : '');
      }
      h += '</div>';
      if (s.tipo === 'ahorro') h += '<p class="hint">El importe es el objetivo de cada mes (' + fmt(C.objetivoMes(V, C.mesDe(hoy()))) + ' este mes). Se cambia en Ahorro, tocando la cifra del mes.</p>';
      h += '<div class="seg">' + [['mensual', 'Día del mes'], ['dias', 'Cada X días'], ['sin', 'Sin día fijo']].map(function (o) {
        return '<button class="' + (s.frecuencia === o[0] ? 'on' : '') + '" data-set="frecuencia" data-v="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div><div class="field">';
      if (s.frecuencia === 'mensual') h += '<div class="frow"><span class="k">Día</span><input data-f="dia" inputmode="numeric" placeholder="1–31" value="' + esc(s.dia) + '"></div>';
      if (s.frecuencia === 'dias') h += '<div class="frow"><span class="k">Cada (días)</span><input data-f="cada" inputmode="numeric" placeholder="28" value="' + esc(s.cada) + '"></div>' +
        '<div class="frow"><span class="k">Último pago</span><input type="date" data-f="desde" value="' + esc(s.desde) + '"></div>';
      h += '<div class="frow"><span>Activo</span>' + sw(s.activo !== false, 'toggle-activo') + '</div></div>' +
        '<p class="hint" data-err>' + (s.frecuencia === 'sin' ? 'Aparecerá cada mes en la previsión, sin aviso de retraso.' : 'Si pasan 2 días del día previsto sin marcarlo, verás un aviso.') + ' Desactívalo para pausarlo.</p>' +
        (s.id ? '<button class="btn block danger" data-act="borrar">Borrar gasto fijo</button>' : '');
      return h;
    }
    var body = abrirHoja({
      titulo: s.id ? 'Gasto fijo' : 'Nuevo gasto fijo', guardar: 'Guardar', html: pintar(),
      onInput: function (e) {
        var k = e.target.dataset.f; if (!k) return;
        s[k] = e.target.value;
        if (k === 'cat' && e.type === 'change') { s.sub = ''; repintar(body, pintar()); }
      },
      onClick: function (e) {
        var st = e.target.closest('[data-set]'), a = e.target.closest('[data-act]');
        if (st) { s[st.dataset.set] = st.dataset.v; if (st.dataset.set === 'tipo' && s.tipo === 'ahorro' && !s.concepto) s.concepto = 'Ahorro'; repintar(body, pintar()); return; }
        if (!a) return;
        if (a.dataset.act === 'toggle-activo') { s.activo = s.activo === false; repintar(body, pintar()); }
        else if (a.dataset.act === 'borrar') { cerrarHoja(true); commit([{ op: 'borrarFijo', id: s.id }]); toast('Gasto fijo borrado'); }
      },
      onGuardar: function () {
        if (!s.concepto.trim()) return error(body, 'Escribe el concepto.');
        var f = { id: s.id || C.uid(), concepto: s.concepto.trim(), tipo: s.tipo, importe: '', cat: '', sub: '', frecuencia: s.frecuencia, dia: '', cada: '', desde: '', activo: s.activo !== false, orden: s.orden };
        if (s.tipo === 'gasto') {
          f.importe = C.r2(C.num(s.importe));
          if (!(f.importe > 0)) return error(body, 'Escribe el importe.');
          if (!s.cat) return error(body, 'Elige una categoría.');
          f.cat = s.cat; f.sub = s.sub;
        } else { f.cat = 'Ahorro'; f.sub = 'Trade Republic'; }
        if (s.frecuencia === 'mensual') { f.dia = +s.dia; if (!(f.dia >= 1 && f.dia <= 31 && f.dia % 1 === 0)) return error(body, 'El día tiene que estar entre 1 y 31.'); }
        if (s.frecuencia === 'dias') {
          f.cada = +s.cada; f.desde = s.desde;
          if (!(f.cada >= 1 && f.cada <= 366 && f.cada % 1 === 0)) return error(body, 'Indica cada cuántos días.');
          if (!f.desde) return error(body, 'Indica la fecha del último pago.');
        }
        if (f.orden === '' || f.orden == null) f.orden = (V.fijos || []).reduce(function (a, x) { return Math.max(a, +x.orden || 0); }, 0) + 1;
        cerrarHoja(true); commit([{ op: 'fijo', fijo: f }]); toast('Gasto fijo guardado');
      }
    });
  }

  // ---------- Categorías ----------
  function abrirCategoria(nombre, tipoNuevo) {
    var base = nombre ? (V.categorias || []).filter(function (c) { return c.cat === nombre && !c.sub; })[0] : null;
    var s = { cat: nombre || '', icono: base ? base.icono : '', tipo: base ? base.tipo : (tipoNuevo || 'gasto'), subs: nombre ? subs(nombre).join('\n') : '' };
    var body = abrirHoja({
      titulo: nombre ? 'Categoría' : 'Nueva categoría', guardar: 'Guardar', html:
        '<div class="field"><div class="frow"><span class="k">Emoji</span><input data-f="icono" value="' + esc(s.icono) + '" placeholder="🛒" maxlength="8"></div>' +
        '<div class="frow"><span class="k">Nombre</span><input data-f="cat" value="' + esc(s.cat) + '" maxlength="60"></div></div>' +
        '<label class="hint" for="c-subs">Subcategorías (una por línea)</label><textarea class="input" id="c-subs" data-f="subs" rows="6">' + esc(s.subs) + '</textarea>' +
        '<p class="hint" data-err>' + (nombre ? 'Si cambias el nombre, los movimientos ya apuntados conservan el antiguo.' : '') + '</p>' +
        (nombre ? '<button class="btn block danger" data-act="borrar">Borrar categoría</button>' : ''),
      onInput: function (e) { if (e.target.dataset.f) s[e.target.dataset.f] = e.target.value; },
      onClick: function (e) {
        if (!e.target.closest('[data-act="borrar"]')) return;
        cerrarHoja(true);
        commit([{ op: 'cats', lista: (V.categorias || []).filter(function (c) { return c.cat !== nombre; }) }]);
        toast('Categoría borrada');
      },
      onGuardar: function () {
        var cat = s.cat.trim();
        if (!cat) return error(body, 'Escribe el nombre.');
        if (cat !== nombre && (V.categorias || []).some(function (c) { return c.cat === cat; })) return error(body, 'Ya existe una categoría con ese nombre.');
        var lista = (V.categorias || []).filter(function (c) { return c.cat !== nombre; });
        var nuevas = [{ cat: cat, sub: '', tipo: s.tipo, icono: s.icono.trim() }];
        s.subs.split(/\n|,/).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (sb) {
          if (!nuevas.some(function (n) { return n.sub === sb; })) nuevas.push({ cat: cat, sub: sb, tipo: s.tipo, icono: '' });
        });
        // Se mantiene en su sitio si ya existía
        var pos = (V.categorias || []).map(function (c) { return c.cat; }).indexOf(nombre);
        if (nombre && pos >= 0) { var antes = (V.categorias || []).slice(0, pos).filter(function (c) { return c.cat !== nombre; }).length; lista.splice.apply(lista, [antes, 0].concat(nuevas)); }
        else lista = lista.concat(nuevas);
        cerrarHoja(true); commit([{ op: 'cats', lista: lista }]); toast('Categoría guardada');
      }
    });
  }

  // ---------- Meses anteriores ----------
  function abrirMes(mes) {
    var t = hoy(), r = C.resumenMes(V, mes), ls = C.prevision(V, mes, t), prev = 0, real = 0;
    ls.forEach(function (l) { prev += l.importe; if (l.hecho) real += C.num(l.hecho.importe); });
    var a = C.ahorroMes(V, mes, t);
    abrirHoja({
      titulo: nombreMes(mes, true), html:
        '<div class="card"><div class="tiles" style="padding-top:12px">' +
        '<div class="tile"><div class="k">Ingresos</div><div class="v amt pos">' + fmt(r.ingresos) + '</div></div>' +
        '<div class="tile"><div class="k">Gastos (tu parte)</div><div class="v amt neg">' + fmt(r.gastos) + '</div></div>' +
        '<div class="tile"><div class="k">Ahorro</div><div class="v amt">' + fmt(r.ahorro) + '</div></div>' +
        '<div class="tile"><div class="k">Ahorro cumplido</div><div class="v">' + (a.estado === 'si' ? '✓ Sí' : a.estado === 'no' ? '✗ No' : 'Pendiente') + '</div></div></div></div>' +
        '<div class="card"><h3>Previsto frente a real</h3><table class="data">' + ls.map(function (l) {
          return '<tr><td>' + esc(l.concepto) + '<br><span class="small mut">previsto ' + fmt(l.importe) + '</span></td><td class="amt">' + (l.hecho ? fmt(l.hecho.importe) : '<span class="mut">sin marcar</span>') + '</td></tr>';
        }).join('') +
        '<tr><td><b>Total</b><br><span class="small mut">previsto ' + fmt(prev) + '</span></td><td class="amt"><b>' + fmt(real) + '</b></td></tr>' +
        '<tr><td>Gastos fuera de la previsión</td><td class="amt">' + fmt(r.fueraPrevision) + '</td></tr></table><div style="height:6px"></div></div>' +
        '<div class="card"><h3>Gasto por categoría</h3>' + hbars(r.porCategoria) + '</div>'
    });
  }

  // ---------------------------------------------------------------- caja fuerte (cifrado local)
  function vistaBloqueo() {
    var pk = caja.metodo.indexOf('passkey') === 0;
    return '<div class="view welcome"><img class="logo" src="icons/icon-192.png" alt=""><h1>Hucha</h1><p class="lead">🔒 Bloqueada</p>' +
      (pk ? '<button class="btn primary block" data-act="desbloquear">🙂 Desbloquear con Face ID</button>'
        : '<div class="field"><div class="frow"><span class="k">Contraseña</span><input id="l-pass" type="password" autocomplete="current-password" enterkeyhint="go"></div></div><button class="btn primary block" data-act="desbloquear">Desbloquear</button>') +
      '<p class="err" id="l-err"></p>' +
      '<button class="link" data-act="reconectar">¿No puedes entrar? Reconectar desde cero</button></div>';
  }

  var abriendo = false;
  function desbloquear(silencioso) {
    if (abriendo || !caja) return;
    abriendo = true;
    var campo = $('#l-pass'), pass = campo ? campo.value : null;
    HuchaVault.abrir(caja, pass, function () { return DB.get('llaveLocal'); }).then(function (k) {
      return HuchaVault.descifrar(k, caja).then(function (d) {
        llave = k; sesion = { url: d.url, clave: d.clave }; snapshot = d.snapshot; queue = d.queue || []; sync.ultimo = d.ultimoSync || 0;
        recompute(); render(); hacerSync();
      });
    }).catch(function (e) {
      var err = $('#l-err');
      if (err && silencioso !== true) err.textContent = e.message === 'CLAVE_INCORRECTA' ? 'Contraseña incorrecta.' : e.message === 'SIN_LLAVE' ? 'No se encuentra la llave en este móvil. Pulsa «Reconectar desde cero».' : (e.name === 'NotAllowedError' ? 'Cancelado. Vuelve a intentarlo.' : 'No se pudo desbloquear: ' + e.message);
    }).then(function () { abriendo = false; });
  }

  function bloquear() {
    if (!caja || !llave) return;
    if (hoja) { hoja.remove(); hoja = null; document.body.style.overflow = ''; }
    llave = null; snapshot = null; queue = []; V = null; sesion = { url: '', clave: '' }; seguridad = null;
    render();
  }

  function abrirProteccion(obligatorio) {
    var pk = HuchaVault.soportaPasskey(), pendiente = null;
    var html = '<p>Lo que Hucha guarda en este móvil se cifrará (AES-256) y solo se abrirá contigo.</p>' +
      (pk ? '<button class="btn primary block" data-x="pk">🙂 Usar Face ID</button><p class="hint">Recomendado. Se crea una passkey «Hucha» en tu llavero de iCloud.</p>' : '') +
      '<div class="field"><div class="frow"><span class="k">' + (pk ? 'O una contraseña' : 'Contraseña') + '</span><input type="password" id="p-1" autocomplete="new-password" placeholder="Mínimo 8 caracteres"></div>' +
      '<div class="frow"><span class="k">Repítela</span><input type="password" id="p-2" autocomplete="new-password"></div></div>' +
      '<button class="btn block" data-x="pw">Usar contraseña</button>' +
      '<p class="hint bad" id="p-err"></p>';
    abrirHoja({
      titulo: 'Protege tus datos', fija: obligatorio, html: html,
      onClick: function (e) {
        var x = e.target.closest('[data-x]'); if (!x) return;
        var err = $('#p-err'), p;
        if (x.dataset.x === 'pk') p = HuchaVault.configurarPasskey();
        else if (x.dataset.x === 'pk2') p = HuchaVault.completarPasskey(pendiente.credId, pendiente.salt);
        else {
          var a = $('#p-1').value, b = $('#p-2').value;
          if (a.length < 8) { err.textContent = 'Mínimo 8 caracteres.'; return; }
          if (a !== b) { err.textContent = 'Las contraseñas no coinciden.'; return; }
          p = HuchaVault.configurarPassword(a);
        }
        x.disabled = true; err.textContent = '';
        p.then(function (r) {
          if (r.pendiente) {
            // Passkey creada; Safari exige un segundo toque para obtener la llave.
            pendiente = r;
            x.outerHTML = '<button class="btn primary block" data-x="pk2">Último paso: confirmar con Face ID</button>';
            return;
          }
          caja = r.meta; llave = r.clave;
          DB.set('llaveLocal', r.llaveLocal || null);
          persist();
          cerrarHoja(); toast('🔒 Datos protegidos');
        }).catch(function (e2) {
          x.disabled = false;
          err.textContent = e2.message === 'NO_PRF'
            ? 'Este móvil no permite cifrar con Face ID (necesita iOS 18 o posterior y Contraseñas de iCloud). De momento, usa una contraseña.'
            : (e2.name === 'NotAllowedError' ? 'Cancelado o no permitido. Vuelve a pulsar.' : 'Error: ' + (e2.name || '') + ' ' + e2.message);
        });
      }
    });
  }

  function borrarTodo() {
    ['demo'].forEach(LS.del);
    snapshot = null; queue = []; V = null; llave = null; caja = null; seguridad = null; sesion = { url: '', clave: '' };
    DB.set('vault', null); DB.set('llaveLocal', null); DB.set('demo.snapshot', null); DB.set('demo.queue', []);
    if (hoja) { hoja.remove(); hoja = null; document.body.style.overflow = ''; }
    ui.tab = 'santander'; ui.sub = null;
    render();
  }

  function confirmar(titulo, texto, boton, accion) {
    abrirHoja({
      titulo: titulo, html: '<p>' + texto + '</p><button class="btn block danger" data-act="si">' + boton + '</button>',
      onClick: function (e) { if (e.target.closest('[data-act="si"]')) { cerrarHoja(); accion(); } }
    });
  }

  // ---------------------------------------------------------------- eventos
  function irA(tab) { ui.tab = tab; ui.sub = null; ui.limite = 200; render(); window.scrollTo(0, 0); }

  document.addEventListener('click', function (e) {
    if (hoja && hoja.contains(e.target)) return;
    var tab = e.target.closest('.tab');
    if (tab) { if (tab.dataset.tab === 'nuevo') abrirMovimiento(null); else irA(tab.dataset.tab); return; }
    var y = e.target.closest('.year > summary');
    if (y) { var d = y.parentNode; setTimeout(function () { LS.set('anio.' + d.dataset.anio, d.open); }, 0); return; }
    var a = e.target.closest('[data-act]');
    if (!a) return;
    var act = a.dataset.act, id = a.dataset.id;
    if (act === 'sync') { if (modo() === 'online') hacerSync(); else toast('Modo de ejemplo: no se sincroniza'); }
    else if (act === 'conectar') conectar($('#w-url').value, $('#w-clave').value);
    else if (act === 'demo') entrarDemo();
    else if (act === 'ir') irA(id);
    else if (act === 'sub') { ui.sub = id; render(); window.scrollTo(0, 0); }
    else if (act === 'atras') { ui.sub = null; render(); window.scrollTo(0, 0); }
    else if (act === 'editar') { var m = mov(id); if (m) abrirMovimiento(m); }
    else if (act === 'marcar') { var l = lineaPrev(a.dataset.k); if (l) abrirMarcar(l); }
    else if (act === 'desmarcar') { var l2 = lineaPrev(a.dataset.k); if (l2 && l2.hecho) abrirDesmarcar(l2); }
    else if (act === 'partida') { var p = (V.previsiones || []).filter(function (x) { return x.id === id; })[0]; if (p) abrirPartida(p); }
    else if (act === 'partida-nueva') abrirPartida(null);
    else if (act === 'rango') { ui.rango = id; ui.limite = 200; render(); }
    else if (act === 'mas-movs') { ui.limite += 200; render(); }
    else if (act === 'objetivo') abrirObjetivo(id);
    else if (act === 'intereses' || act === 'int-on') abrirIntereses(id);
    else if (act === 'int-off') commit([{ op: 'ahorro', mes: id, interesesOk: false }]);
    else if (act === 'estado') commit([{ op: 'ahorro', mes: id, estado: a.dataset.v }]);
    else if (act === 'persona') abrirPersona(id);
    else if (act === 'debo') { var dd = (V.debo || []).filter(function (x) { return x.id === id; })[0]; if (dd) abrirDebo(dd); }
    else if (act === 'debo-nuevo') abrirDebo(null);
    else if (act === 'debo-ok') { a.setAttribute('aria-checked', 'true'); setTimeout(function () { commit([{ op: 'borrarDebo', id: id }]); toast('Quitado de la lista'); }, 250); }
    else if (act === 'fijo') { var fj = (V.fijos || []).filter(function (x) { return x.id === id; })[0]; if (fj) abrirFijo(fj); }
    else if (act === 'fijo-nuevo') abrirFijo(null);
    else if (act === 'cat') abrirCategoria(id);
    else if (act === 'cat-nueva') abrirCategoria(null, id);
    else if (act === 'mes') abrirMes(id);
    else if (act === 'stats') { ui.stats = id; render(); }
    else if (act === 'fallos-ok') { LS.set('fallosVistos', +id); render(); }
    else if (act === 'guardar-conexion') {
      var u = $('#a-url').value.trim(), c = $('#a-clave').value.trim();
      if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(u)) { toast('La URL debe acabar en /exec'); return; }
      sesion = { url: u, clave: c }; persist(); toast('Guardado'); hacerSync();
    }
    else if (act === 'descartar-cola') confirmar('Descartar cambios', 'Se descartarán ' + queue.length + ' cambio(s) que la hoja no ha aceptado.', 'Descartar', function () { queue = []; sync.estado = 'idle'; sync.error = ''; persist(); recompute(); render(); hacerSync(); });
    else if (act === 'desbloquear') desbloquear(false);
    else if (act === 'bloquear') bloquear();
    else if (act === 'proteger') abrirProteccion(false);
    else if (act === 'reconectar') confirmar('Reconectar desde cero', 'Se borrarán los datos guardados en este móvil (tu hoja de Google no se toca) y tendrás que volver a poner la URL y la clave secreta.' + (queue.length ? ' Hay ' + queue.length + ' cambio(s) sin enviar que se perderán.' : ''), 'Borrar y reconectar', borrarTodo);
    else if (act === 'salir-demo') { LS.del('demo'); snapshot = null; V = null; queue = []; ui.tab = 'santander'; ui.sub = null; render(); }
  });

  var qTimer = null;
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (hoja && hoja.contains(t)) return;
    if (t.id === 'f-q') {
      ui.q = t.value; clearTimeout(qTimer);
      qTimer = setTimeout(function () { var pos = t.selectionStart; render(); var n = $('#f-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) {} } }, 250);
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (hoja && hoja.contains(t)) return;
    if (t.id === 'f-desde') { ui.desde = t.value; render(); }
    else if (t.id === 'f-hasta') { ui.hasta = t.value; render(); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.target.id === 'l-pass' && e.key === 'Enter') { desbloquear(); return; }
    if (e.target.id === 'w-clave' && e.key === 'Enter') { conectar($('#w-url').value, $('#w-clave').value); return; }
    if (!hoja) return;
    if (e.key === 'Escape' && !hoja.dataset.fija) { cerrarHoja(); return; }
    if (e.key === 'Enter' && (e.target.tagName || '').toLowerCase() === 'input' && !e.target.closest('.person') && hoja._o && hoja._o.onGuardar) { e.preventDefault(); e.target.blur(); hoja._o.onGuardar(); }
  });

  var ocultoDesde = 0;
  document.addEventListener('visibilitychange', function () {
    document.body.classList.toggle('oculto', document.hidden && modo() === 'online');
    if (document.hidden) { ocultoDesde = Date.now(); return; }
    if (ocultoDesde && Date.now() - ocultoDesde > 30000 && caja && llave) { bloquear(); return; }
    if (V && modo() === 'online') hacerSync();
    if (V && !hoja) render();
  });
  window.addEventListener('online', function () { programarSync(100); });
  window.addEventListener('offline', function () { sync.estado = 'off'; pintarEstado(); });

  // ---------------------------------------------------------------- acciones
  function conectar(url, clave) {
    url = (url || '').trim(); clave = (clave || '').trim();
    var err = $('#w-err');
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) { err.textContent = 'La URL debe empezar por https://script.google.com y acabar en /exec.'; return; }
    if (!clave) { err.textContent = 'Falta la clave secreta.'; return; }
    sesion = { url: url, clave: clave }; LS.del('demo');
    queue = []; snapshot = null; err.textContent = 'Conectando…';
    hacerSync().then(function () {
      if (!snapshot) { sesion = { url: '', clave: '' }; render(); var e2 = $('#w-err'); if (e2) e2.textContent = sync.error || 'No se pudo conectar.'; return; }
      toast('¡Conectada!');
      abrirProteccion(true);
    });
  }

  function entrarDemo() {
    LS.set('demo', true);
    DB.get('demo.snapshot').then(function (s) {
      snapshot = s || C.estadoEjemplo(hoy()); queue = [];
      persist(); recompute(); render();
    });
  }

  // ---------------------------------------------------------------- arranque
  function iniciar() {
    DB.open().then(function () {
      if (LS.get('demo', false)) {
        return DB.get('demo.snapshot').then(function (s) {
          snapshot = s || C.estadoEjemplo(hoy()); queue = [];
          recompute(); render();
        });
      }
      return DB.get('vault').then(function (v) {
        caja = v && v.metodo && v.ct ? v : null;
        render();
        if (caja && caja.metodo.indexOf('passkey') === 0) setTimeout(function () { desbloquear(true); }, 150);
      });
    });
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
    setInterval(function () { if (V && modo() === 'online' && !document.hidden && !hoja) hacerSync(); }, 5 * 60000);
  }
  iniciar();
})();
