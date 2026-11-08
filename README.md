# Hucha 🐷

App web (PWA) de finanzas personales para iPhone. Guarda los datos en una hoja de Google con Apps Script.

- **Santander:** saldo real y **lo que te quedaría** tras restar lo que aún falta por pagar de la previsión del mes.
- **Previsión del mes:** gastos fijos preconfigurados más partidas que añades a mano. Las marcas con un interruptor cuando ocurren, corriges el importe real y se apunta el movimiento.
- **Gastos fijos** no automáticos: día del mes, cada X días (gimnasio) o sin día fijo. Si uno con día pasa 2 días sin marcarse, aparece un aviso.
- **Movimientos:** gasto, ingreso o transferencia, con categoría, concepto, cantidad y fecha. Buscador por concepto y filtros de fecha, con el total de lo filtrado.
- **Gastos compartidos:** pagas 200 € y tu parte son 20 €. El saldo baja 200 €, en las estadísticas solo cuentan 20 € y cada persona queda debiéndote su parte.
- **Deudas:** lo que te deben por persona, con pagos parciales: un Bizum salda la deuda sin contar como ingreso. También hay una lista de recordatorios de lo que debes tú.
- **Ahorro en Trade Republic:**
  - Total = aportaciones + intereses.
  - Desplegable por años con cada mes: objetivo (1.450 €, editable por mes), lo aportado y los intereses estimados (3 % TAE hasta 50.000 €, 2,25 % por encima, netos del 19 %), que confirmas cuando llegan.
  - Cada mes tiene un estado: pendiente, cumplido o no cumplido. Si sacas dinero de Trade Republic, la app te avisa.
- **Estadísticas:** gasto por categoría, ingresos y gastos por mes, tasa de ahorro, previsto frente a real, evolución de Trade Republic y calendario de meses cumplidos.
- Funciona **sin conexión** y sincroniza al volver la cobertura.
- **Datos cifrados en el móvil** (AES-256) que se abren con **Face ID**. Ver [Seguridad](#seguridad).

> 🔒 Este repositorio es público, pero **solo contiene el código**. Los movimientos y saldos están en la hoja de Google y en el móvil, nunca aquí.

---

## Instalación (una sola vez, mejor desde un ordenador)

### 1. Publica la app en GitHub Pages

En este repositorio de GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**. Elige la rama `main` y la carpeta `/ (root)` y pulsa **Save**. Al cabo de un minuto, la app estará en:

**https://ezio9338-droid.github.io/Finanzas-2/**

### 2. Crea la hoja de cálculo

Con la cuenta de Google de la persona que va a usar la app:

1. Entra en [sheets.new](https://sheets.new) y crea una hoja en blanco. Llámala, por ejemplo, `Hucha`.
2. En el menú, ve a **Extensiones → Apps Script**.

### 3. Pega el código

En el editor de Apps Script:

1. Borra lo que haya en `Código.gs` y pega el contenido de [`apps-script/Code.gs`](apps-script/Code.gs).
2. Crea otro archivo con **＋ → Secuencia de comandos**, llámalo `Core` y pega [`apps-script/Core.gs`](apps-script/Core.gs).
3. *(Recomendado)* Crea otro archivo llamado `Datos` y pega el `Datos.gs` privado, con los gastos fijos ya preparados. Este archivo **no está en el repositorio**. Si no lo pegas, solo se crea el fijo de ahorro y los demás se añaden desde la app (**Más → Gastos fijos**).
4. Ve a **⚙ Configuración del proyecto** y elige la zona horaria **Europe/Madrid**.
5. Pulsa 💾 para guardar.

### 4. Ejecuta la instalación

1. Arriba, en el desplegable de funciones, elige **`instalar`** y pulsa **▶ Ejecutar**.
2. Google pedirá permisos: **Revisar permisos → tu cuenta → Configuración avanzada → Ir a Hucha (no seguro) → Permitir**. El aviso sale porque el script es tuyo y Google no lo ha verificado; es normal.
   Los permisos son: **ver y editar solo esta hoja** (no el resto de tu Drive) y **enviarte emails** de aviso de seguridad.
3. Se crean las pestañas `Movimientos`, `Deudas`, `Previsiones`, `Fijos`, `Categorias`, `Ahorro`, `Debo`, `Config` y `Resumen`.
4. En la pestaña **`Config`**, escribe los saldos iniciales:
   - `saldoInicialSantander`: el saldo de la cuenta Santander.
   - `saldoInicialTrade`: el saldo de Trade Republic.
   - `fechaSaldo`: la fecha de esos saldos (por defecto, el día de la instalación). Los movimientos anteriores a esa fecha cuentan en la previsión y en las estadísticas, pero no cambian el saldo, porque ya estaban incluidos.
5. Para ver la **clave secreta**, abre el menú **Hucha → Ver clave secreta** de la hoja. Si no aparece el menú, recarga la hoja.

### 5. Publica la API

1. Ve a **Implementar → Nueva implementación**, pulsa ⚙ y elige **Aplicación web**.
2. Configúrala así:
   - **Ejecutar como:** Yo
   - **Quién tiene acceso:** Cualquier usuario
3. Pulsa **Implementar** y copia la **URL**. Termina en `/exec`.

> "Cualquier usuario" significa que la URL responde a cualquiera, pero sin la clave secreta no devuelve ni guarda nada.

### 6. Instala la app en el iPhone

1. Abre en **Safari** https://ezio9338-droid.github.io/Finanzas-2/
2. Pulsa **Compartir → Añadir a pantalla de inicio**.
3. Abre Hucha desde el icono, pega la **URL** y la **clave secreta** y pulsa **Conectar con mi hoja**.
4. Elige **Usar Face ID**. Se crea una passkey «Hucha» en el llavero de iCloud.

Antes de conectar, puedes pulsar **Probar con datos de ejemplo** para ver la app con datos inventados.

---

## Uso diario

| Quiero… | Cómo |
|---|---|
| Apuntar un gasto | **＋** → categoría → concepto, cantidad y fecha → **Guardar**. |
| Una cena que me pagarán | En el gasto, activa **Compartido**, pon **tu parte** y quién te debe el resto (**Repartir a partes iguales** lo calcula). |
| Registrar un Bizum que salda una deuda | **＋ → Ingreso → Salda una deuda** y elige la persona. O en **Deudas**, toca la persona → **Registrar un pago**. |
| Cobrar la nómina | **＋ → Ingreso → Nómina**. Después la app ofrece marcar el ahorro del mes. |
| Pagar un gasto fijo o una partida | Activa su interruptor en **Previsión del mes**, corrige el importe si hace falta y pulsa **Marcar como pagado**. |
| Preparar la previsión del mes | En Santander, **＋ Añadir partida** (por ejemplo, «Cena invitación, 100 €»). |
| Pasar dinero entre cuentas | **＋ → Transferencia**, en un sentido o en el otro. Las transferencias a Trade Republic cuentan como aportación de ese mes. |
| Confirmar los intereses | En **Ahorro**, a partir del día 1, activa el interruptor del mes anterior y corrige el importe si no coincide. |
| Verificar el ahorro de un mes | En **Ahorro**, en el mes correspondiente: **✓ Cumplido** o **✗ No**. |
| Cambiar el objetivo de ahorro | En **Ahorro**, toca la cifra «aportado / objetivo» del mes. |
| Gastos fijos y categorías | **Más → Gastos fijos** (cada fijo puede tener su propio emoji) y **Más → Categorías**. |
| Buscar movimientos antiguos | **Santander → Ver todos**: busca por concepto y filtra por fechas. |

### Cómo se calcula

```
Saldo Santander = saldo inicial + ingresos − gastos ± transferencias
Te quedaría     = saldo Santander − (fijos del mes sin marcar + partidas sin marcar)
                  (el ahorro a Trade Republic no se resta: aparece al apuntar la nómina, para marcarlo)
Trade Republic  = saldo inicial + aportaciones − retiradas + intereses confirmados
```

- Un gasto compartido baja el saldo por el total, pero en las estadísticas solo cuenta tu parte.
- Los intereses de un mes se pagan el día 1 del siguiente y aparecen en la fila del mes en que se generaron.

---

## Seguridad

| Capa | Protección |
|---|---|
| **Hoja de Google** | Privada, solo accesible con tu cuenta. El script tiene permiso **solo sobre esta hoja** (`@OnlyCurrentDoc`). Google guarda el historial de versiones. |
| **API (Apps Script)** | Clave secreta aleatoria de 244 bits, comparada en tiempo constante. Rechaza peticiones mal formadas o de más de 1 MB, y solo acepta operaciones y campos conocidos. Protege contra la inyección de fórmulas. |
| **Intentos de acceso** | Cada intento con una clave incorrecta queda anotado en la pestaña `Seguridad`, llega un **email** (como máximo uno por hora) y la app avisa. Cada respuesta fallida tarda 1,5 s más. |
| **Transporte** | Solo HTTPS. Una política de seguridad (CSP) impide que la página hable con algo que no sea Google Apps Script o cargue código de terceros. |
| **Móvil** | Movimientos, URL y clave se guardan **cifrados con AES-256-GCM**. La llave solo existe en memoria con la app desbloqueada y se abre con **Face ID** (passkey con la extensión WebAuthn PRF) o con una contraseña (PBKDF2, 600.000 iteraciones). Se bloquea sola a los **30 s** fuera de la app, y el contenido se difumina en el selector de apps. |
| **Código** | Sin dependencias externas: todo el código está en este repositorio. |

### Lo que depende de ti

- **Verificación en 2 pasos en Google** ([activar](https://myaccount.google.com/signinoptions/twosv)). Protege la hoja.
- **Verificación en 2 pasos en GitHub**. Evita que alguien modifique la app.
- **Código de desbloqueo en el iPhone**, que es lo que activa el cifrado de iOS.
- **No compartas la hoja** con nadie, y no hagas capturas en las que se vea la clave secreta.
- Si sospechas algo: en la hoja, menú **Hucha → Cambiar clave secreta**, y pon la nueva clave en la app (**Más → Conexión**).

Si no puedes desbloquear la app (por ejemplo, porque has cambiado de móvil), pulsa **Reconectar desde cero** y vuelve a poner la URL y la clave: todo se descarga de nuevo desde la hoja. Solo se perderían los cambios que aún no se hubieran sincronizado.

---

## Estructura del proyecto

```
index.html, css/, js/       App web (GitHub Pages)
js/vault.js                 Cifrado local (AES-GCM + passkey PRF / PBKDF2)
js/core.js                  Lógica compartida (cálculos), la misma en la app y en Apps Script
apps-script/Code.gs         Servidor: API, validación y pestaña Resumen
apps-script/Core.gs         Copia de js/core.js (tools/sync-core.sh la regenera)
sw.js, manifest.webmanifest Modo sin conexión e instalación como app
```

### Actualizar el Apps Script

Cuando una versión cambia `apps-script/Code.gs` o `apps-script/Core.gs`:

1. En el editor de Apps Script, pega el contenido nuevo de los archivos que hayan cambiado y guarda (💾).
2. Ve a **Implementar → Gestionar implementaciones**, pulsa **✏️ (editar)**, en **Versión** elige **Nueva versión** y pulsa **Implementar**.

⚠️ No uses «Nueva implementación», porque crearía otra URL. Si editas la implementación existente, la URL se mantiene y no hay que tocar nada en la app.
