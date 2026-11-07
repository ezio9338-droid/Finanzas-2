/*
 * Hucha · caja fuerte local
 * Los datos guardados en el dispositivo se cifran con AES-GCM 256 (clave de datos aleatoria).
 * Esa clave se guarda "envuelta" con otra derivada de:
 *   - una passkey con Face ID / huella (extensión WebAuthn PRF), o
 *   - una contraseña (PBKDF2-SHA256, 600.000 iteraciones).
 * La clave de datos solo existe en memoria mientras la app está desbloqueada.
 */
var HuchaVault = (function () {
  'use strict';
  var te = new TextEncoder(), td = new TextDecoder(), S = crypto.subtle;
  var PBKDF2_ITER = 600000;

  function rnd(n) { return crypto.getRandomValues(new Uint8Array(n)); }
  function b64(buf) { var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  function ub64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

  function kekDesdePrf(prf, salt) {
    return S.importKey('raw', prf, 'HKDF', false, ['deriveKey']).then(function (base) {
      return S.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: te.encode('hucha-cati-kek-v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
    });
  }
  function kekDesdePassword(pass, salt, iter) {
    return S.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return S.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
    });
  }

  /** Crea una clave de datos nueva, la envuelve con kek y devuelve la versión no exportable. */
  function nuevaClaveEnvuelta(kek, meta) {
    return S.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']).then(function (k) {
      var iv = rnd(12);
      return S.wrapKey('raw', k, kek, { name: 'AES-GCM', iv: iv }).then(function (w) {
        meta.wrapIv = b64(iv); meta.wrapped = b64(w);
        return desenvolver(meta, kek);
      });
    }).then(function (k2) { return { meta: meta, clave: k2 }; });
  }
  function desenvolver(meta, kek) {
    return S.unwrapKey('raw', ub64(meta.wrapped), kek, { name: 'AES-GCM', iv: ub64(meta.wrapIv) }, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  // ---------- Passkey (Face ID / Touch ID / Windows Hello) ----------
  function soportaPasskey() {
    return !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
  }

  function evaluarPrf(credId, salt) {
    return navigator.credentials.get({
      publicKey: {
        challenge: rnd(32), timeout: 60000, userVerification: 'required',
        allowCredentials: [{ type: 'public-key', id: ub64(credId) }],
        extensions: { prf: { eval: { first: salt } } }
      }
    }).then(function (a) {
      var r = a && a.getClientExtensionResults ? a.getClientExtensionResults() : {};
      // null = Face ID verificado, pero el gestor de passkeys no admite PRF
      return r.prf && r.prf.results && r.prf.results.first ? new Uint8Array(r.prf.results.first) : null;
    });
  }

  function configurarPasskey() {
    var salt = rnd(32);
    return navigator.credentials.create({
      publicKey: {
        rp: { name: 'Hucha' },
        user: { id: rnd(16), name: 'Hucha Cati', displayName: 'Hucha (Santander y Trade Republic)' },
        challenge: rnd(32), timeout: 60000,
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
        extensions: { prf: { eval: { first: salt } } }
      }
    }).then(function (cred) {
      // Algunos navegadores (Safari) no informan del PRF al crear la passkey: se comprueba
      // de verdad en el paso siguiente, con una autenticación normal.
      var ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
      var credId = b64(cred.rawId);
      var directo = ext.prf && ext.prf.results && ext.prf.results.first;
      if (directo) return terminarPasskey(credId, salt, new Uint8Array(directo));
      return { pendiente: true, credId: credId, salt: b64(salt) };
    });
  }

  /**
   * Segundo paso (requiere otro toque del usuario en Safari): obtiene el PRF y crea la caja.
   * Si el gestor de passkeys no admite PRF → "modo compatible": clave AES no exportable guardada
   * en el dispositivo (WebKit la protege con el llavero del sistema) y Face ID como cerradura.
   * Devuelve además `llaveLocal`, que la app debe guardar en IndexedDB.
   */
  function completarPasskey(credId, saltB64) {
    var salt = ub64(saltB64);
    return evaluarPrf(credId, salt).then(function (prf) {
      if (prf) return terminarPasskey(credId, salt, prf);
      return S.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']).then(function (k) {
        return { meta: { v: 1, metodo: 'passkey-local', credId: credId }, clave: k, llaveLocal: k };
      });
    });
  }

  function terminarPasskey(credId, salt, prf) {
    return kekDesdePrf(prf, salt).then(function (kek) {
      return nuevaClaveEnvuelta(kek, { v: 1, metodo: 'passkey', credId: credId, salt: b64(salt) });
    });
  }

  // ---------- Contraseña ----------
  function configurarPassword(pass) {
    var salt = rnd(16);
    return kekDesdePassword(pass, salt, PBKDF2_ITER).then(function (kek) {
      return nuevaClaveEnvuelta(kek, { v: 1, metodo: 'password', salt: b64(salt), iter: PBKDF2_ITER });
    });
  }

  /**
   * Abre la caja: devuelve la clave de datos (no exportable).
   * @param cargarLlaveLocal función que devuelve (promesa) la llave guardada, para el modo compatible
   */
  function abrir(meta, pass, cargarLlaveLocal) {
    if (meta.metodo === 'passkey-local') {
      return navigator.credentials.get({
        publicKey: { challenge: rnd(32), timeout: 60000, userVerification: 'required', allowCredentials: [{ type: 'public-key', id: ub64(meta.credId) }] }
      }).then(function () { return cargarLlaveLocal(); }).then(function (k) {
        if (!k) throw new Error('SIN_LLAVE');
        return k;
      });
    }
    var kekP = meta.metodo === 'passkey'
      ? evaluarPrf(meta.credId, ub64(meta.salt)).then(function (prf) {
          if (!prf) throw new Error('NO_PRF');
          return kekDesdePrf(prf, ub64(meta.salt));
        })
      : kekDesdePassword(pass, ub64(meta.salt), meta.iter || PBKDF2_ITER);
    return kekP.then(function (kek) { return desenvolver(meta, kek); }).catch(function (e) {
      if (e && e.name === 'OperationError') throw new Error('CLAVE_INCORRECTA');
      throw e;
    });
  }

  function cifrar(clave, obj) {
    var iv = rnd(12);
    return S.encrypt({ name: 'AES-GCM', iv: iv }, clave, te.encode(JSON.stringify(obj))).then(function (c) { return { iv: b64(iv), ct: b64(c) }; });
  }
  function descifrar(clave, caja) {
    return S.decrypt({ name: 'AES-GCM', iv: ub64(caja.iv) }, clave, ub64(caja.ct)).then(function (p) { return JSON.parse(td.decode(p)); });
  }

  return {
    soportaPasskey: soportaPasskey, configurarPasskey: configurarPasskey, completarPasskey: completarPasskey, configurarPassword: configurarPassword,
    abrir: abrir, cifrar: cifrar, descifrar: descifrar
  };
})();
