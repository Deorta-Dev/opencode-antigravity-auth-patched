# opencode-antigravity-auth-patched

Instalador que aplica dos parches a [`opencode-antigravity-auth`](https://github.com/NoeFabris/opencode-antigravity-auth) para que el plugin vuelva a funcionar con **OpenCode 2.2+ / 2.3.x**.

No es un fork del código fuente: el instalador descarga la versión oficial desde npm, aplica los parches sobre el `dist` compilado y apunta tu configuración de OpenCode a esa copia local. Es **idempotente**, así que puedes ejecutarlo las veces que quieras.

---

## Síntomas que arregla

Con el plugin oficial `2.1.2` en OpenCode 2.2+ aparecen dos fallos distintos:

**1. La lista de cuentas rompe la UI**

```
Error: Server failed to encode its response
Expected JSON value at ["output"]
```

ocurre en `POST /api/rpc/antigravity.accounts/list`. La causa es que `list()` devuelve objetos con propiedades `undefined`, y el serializador RPC de OpenCode 2.2+ los rechaza.

**2. Cualquier petición de inferencia devuelve `Forbidden`**

```
Error: Forbidden
```

Desde ~2026-11-14 el endpoint de Google (`daily-cloudcode-pa.googleapis.com`) devuelve `429 RESOURCE_EXHAUSTED` para peticiones cuyo `systemInstruction` contiene el texto `tools.opencode.session_move` (la firma del prompt de Code Mode de OpenCode V2). El plugin interpreta ese 429 como cuota agotada, prueba otra cuenta y acaba mostrando un `403 Forbidden` engañoso.

---

## Requisitos

- Node.js **20 o superior** (incluye npm)
- OpenCode **2.2+**
- El plugin `opencode-antigravity-auth` funcionando antes del cambio de OpenCode (es decir, una cuenta de Google ya autorizable)

---

## Instalación

### Linux / macOS

```bash
git clone https://github.com/Deorta-Dev/opencode-antigravity-auth-patched.git
cd opencode-antigravity-auth-patched
node scripts/install.mjs
opencode reload
```

### Windows (PowerShell)

```powershell
git clone https://github.com/Deorta-Dev/opencode-antigravity-auth-patched.git
cd opencode-antigravity-auth-patched
node scripts\install.mjs
opencode reload
```

Al terminar, abre OpenCode y ejecuta `/antigravity` (o `/auth`) para conectar la cuenta. Si ya la tenías conectada, normalmente no hace falta repetir el login.

### Verificar

```bash
node scripts/install.mjs --verify-only
```

Salida esperada:

```
[OK] account-management.js serializa sin undefined
[OK] prompt-signature.js presente
[OK] request.js importa el saneador
[OK] request.js llama al saneador en 2 puntos
[OK] el saneador transforma tools.opencode. correctamente
[OK] Verificación correcta.
```

Prueba real de inferencia:

```bash
opencode run --model=google/antigravity-gemini-3.8-flash-high "Reply exactly WORKING and nothing else."
```

---

## Opciones del instalador

| Opción | Descripción |
|---|---|
| `--prefix <ruta>` | Carpeta vendor. Por defecto `~/.config/opencode/vendor/antigravity` |
| `--version <ver>` | Versión del plugin a instalar. Por defecto `2.1.2` |
| `--no-config` | No toca `opencode.json` / `opencode.jsonc`; solo imprime la ruta a añadir |
| `--force` | Reinstala el paquete desde npm antes de parchear |
| `--verify-only` | Solo comprueba que los parches están aplicados |
| `--help`, `-h` | Ayuda |

Ejemplos:

```bash
# Otra ubicación
node scripts/install.mjs --prefix "D:\opencode\vendor\antigravity"

# Fijar el directorio de configuración (útil en Windows con perfiles distintos)
OPENCODE_CONFIG_DIR="$HOME/.config/opencode" node scripts/install.mjs

# Forzar reinstalación + reaplicar parches
node scripts/install.mjs --force
```

---

## Qué hace exactamente

### Parche 1 — `account-management.js`

Equivalente al PR upstream [#612](https://github.com/NoeFabris/opencode-antigravity-auth/pull/612) (issue [#604](https://github.com/NoeFabris/opencode-antigravity-auth/issues/604)).

Antes:

```js
return storage.accounts.map((account, index) => ({
    ...account,
    quota: { ...account.quota }, // puede contener undefined
}));
```

Después:

```js
const accounts = storage.accounts.map((account, index) => ({ ... }));

// OpenCode 2.2+ rejects RPC outputs containing undefined values.
return JSON.parse(JSON.stringify(accounts));
```

El round-trip por JSON elimina todas las propiedades con valor `undefined`.

### Parche 2 — `transform/prompt-signature.js` + `request.js`

Equivalente al PR upstream [#623](https://github.com/NoeFabris/opencode-antigravity-auth/pull/623) (issue [#622](https://github.com/NoeFabris/opencode-antigravity-auth/issues/622)).

Se añade un módulo nuevo que recorre `systemInstruction`, `system_instruction`, `contents`, `messages` y `extra_body.messages`, y sustituye:

```
tools.opencode.session_move   →   tools["opencode"].session_move
```

El cambio se hace sobre el objeto ya parseado, nunca sobre el JSON serializado, para no romper el payload. `request.js` llama al saneador en dos puntos del pipeline (antes del envío principal y antes del envío de respaldo).

---

## Actualizar

El repositorio incluye un `package.json` con dos alias:

```bash
npm run install:patch   # instalar / reparar
npm run verify          # verificar
```

Si quieres subir de versión del plugin:

```bash
node scripts/install.mjs --version 2.1.3 --force
```

Si upstream publica una versión que ya incluye ambos arreglos, **deja de usar este repositorio** y vuelve a la entrada normal de npm en tu configuración:

```json
"plugins": ["opencode-antigravity-auth@latest"]
```

Puedes comprobarlo con:

```bash
npm view opencode-antigravity-auth version
```

---

## Desinstalar

1. Quita la ruta del vendor de `plugins` en `~/.config/opencode/opencode.json` y pon `"opencode-antigravity-auth"` o `"opencode-antigravity-auth@latest"`.
2. Borra la carpeta `~/.config/opencode/vendor/antigravity`.
3. `opencode reload`.

---

## Notas

- `opencode plugin update` y `opencode plugin add` **no** conservan los parches: si actualizas el plugin por esa vía, vuelve a ejecutar `node scripts/install.mjs`.
- En Windows existe además `opencode-manager.ps1`, que aplica estos mismos dos parches de forma automática al instalar o reparar el plugin desde su menú ("Reparar plugin Antigravity").
- El instalador crea una copia de seguridad `opencode.json.bak-<fecha>` cada vez que reescribe la configuración. Si tu archivo era `.jsonc`, los comentarios se pierden (la copia de seguridad los conserva).

---

## Créditos

- Plugin original: [NoeFabris/opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) — MIT, © 2025 Jens.
- Parches: adaptación de los PRs #612 y #623 del mismo proyecto.
- Instalador y documentación: © 2026 Manuel De Orta.

Licencia MIT. Ver [LICENSE](LICENSE).
