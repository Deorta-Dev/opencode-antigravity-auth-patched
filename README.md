# opencode-antigravity-auth-patched

Distribución parcheada de [`opencode-antigravity-auth`](https://github.com/NoeFabris/opencode-antigravity-auth) para que el plugin vuelva a funcionar con **OpenCode 2.2+ / 2.3.x**.

Se instala directamente con OpenCode, sin scripts manuales:

```sh
opencode plugin add github:Deorta-Dev/opencode-antigravity-auth-patched#v2.1.2-patched.1
```

El paquete es un reempaquetado del `dist` oficial 2.1.2 con tres parches aplicados. No incluye código de terceros modificado más allá de esos parches, y conserva la licencia MIT original.

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

## Instalación con `opencode plugin add` (recomendada)

```sh
opencode plugin add github:Deorta-Dev/opencode-antigravity-auth-patched#v2.1.2-patched.1
```

Luego reinicia o recarga OpenCode y abre el menú `/antigravity` (o `/auth`) para conectar la cuenta.

Comprobar que quedó instalado:

```sh
opencode plugin list
```

Debe aparecer `opencode-antigravity-auth` con la spec de Git. Prueba de inferencia:

```sh
opencode run --model=google/antigravity-gemini-3.8-flash-high "Reply exactly WORKING and nothing else."
```

### Fijar a un commit exacto

Una etiqueta puede moverse; un hash completo no. Si quieres una instalación inmutable:

```sh
opencode plugin add github:Deorta-Dev/opencode-antigravity-auth-patched#<sha-completo>
```

OpenCode no busca actualizaciones para versiones npm exactas ni para hashes completos de Git.

### Actualizar

```sh
opencode plugin remove opencode-antigravity-auth
opencode plugin add github:Deorta-Dev/opencode-antigravity-auth-patched#v2.1.2-patched.1
```

---

## Instalación alternativa (copia vendor + script)

Si prefieres una copia local que no dependa del caché de paquetes de OpenCode, el repo incluye un instalador que descarga la versión oficial de npm, aplica los mismos tres parches y apunta `opencode.json` a la copia:

```bash
git clone https://github.com/Deorta-Dev/opencode-antigravity-auth-patched.git
cd opencode-antigravity-auth-patched
node scripts/install.mjs
opencode reload
```

Opciones:

| Opción | Descripción |
|---|---|
| `--prefix <ruta>` | Carpeta vendor. Por defecto `~/.config/opencode/vendor/antigravity` |
| `--version <ver>` | Versión del plugin a instalar. Por defecto `2.1.2` |
| `--no-config` | No toca `opencode.json` / `opencode.jsonc`; solo imprime la ruta a añadir |
| `--force` | Reinstala el paquete desde npm antes de parchear |
| `--verify-only` | Solo comprueba que los parches están aplicados |
| `--help`, `-h` | Ayuda |

Requisitos: Node.js 20+ (incluye npm).

Verificación:

```bash
node scripts/install.mjs --verify-only
```

```
[OK] account-management.js serializa sin undefined
[OK] account-management.js cierra correctamente la llamada a map
[OK] prompt-signature.js presente
[OK] request.js importa el saneador
[OK] request.js llama al saneador en 2 puntos
[OK] config/updater.js reconoce la spec parcheada
[OK] PLUGIN_NAME apunta a la spec parcheada
[OK] el saneador transforma tools.opencode. correctamente
[OK] Verificación correcta.
```

---

## Los tres parches

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

Se añade un módulo que recorre `systemInstruction`, `system_instruction`, `contents`, `messages` y `extra_body.messages`, y sustituye:

```
tools.opencode.session_move   →   tools["opencode"].session_move
```

El cambio se hace sobre el objeto ya parseado, nunca sobre el JSON serializado, para no romper el payload. `request.js` llama al saneador en dos puntos del pipeline (envío principal y envío de respaldo).

### Parche 3 — `config/updater.js` (propio de esta distribución)

El plugin reescribe `opencode.json(c)` cuando eliges "configurar modelos" en el menú `/antigravity`. El código original solo reconoce sus entradas si son `opencode-antigravity-auth`, `opencode-antigravity-auth@...` o una ruta local. Con una spec de Git no la reconocía y **añadía `opencode-antigravity-auth@latest`**, es decir la versión sin parches, que OpenCode cargaría además de esta.

El parche hace que la reconozca y que, si tiene que escribir la entrada, escriba la spec parcheada:

```js
const PLUGIN_NAME = "github:Deorta-Dev/opencode-antigravity-auth-patched#v2.1.2-patched.1";
```

---

## Estructura

| Ruta | Contenido |
|---|---|
| `dist/` | Plugin ya parcheado (punto de entrada `./dist/index.js`) |
| `index.js`, `tui.js` | Reexports del punto de entrada |
| `patches/prompt-signature.js` | Módulo saneador del parche 2 |
| `scripts/install.mjs` | Instalador de la vía vendor |
| `package.json` | Manifiesto del plugin (`exports`, dependencias, `files`) |

Al instalar por Git, OpenCode empaqueta solo `index.js`, `tui.js`, `dist/`, `README.md` y `LICENSE`; los scripts de mantenimiento quedan fuera del paquete instalado.

---

## Notas

- `opencode plugin update` actualiza plugins npm y Git; si usaste una etiqueta, puede mover la versión. Si usaste un hash completo queda fija. En cualquier caso, este repo siempre instala la versión parcheada.
- Si tu configuración todavía tiene la entrada vendor (`.../vendor/antigravity/node_modules/opencode-antigravity-auth`), quítala antes de añadir la spec de Git para no cargar el plugin dos veces.
- En Windows, `opencode-manager.ps1` usa esta misma vía: su opción "Reparar plugin Antigravity" ejecuta `opencode plugin add` con esta spec y verifica los tres parches sobre el paquete de la caché de OpenCode. No mantiene copia vendor.
- El instalador vendor crea una copia de seguridad `opencode.json.bak-<fecha>` cada vez que reescribe la configuración. Si tu archivo era `.jsonc`, los comentarios se pierden (la copia de seguridad los conserva).

---

## Créditos

- Plugin original: [NoeFabris/opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) — MIT, © 2025 Jens.
- Parches 1 y 2: adaptación de los PRs #612 y #623 del mismo proyecto.
- Parche 3, empaquetado y documentación: © 2026 Manuel De Orta.

Licencia MIT. Ver [LICENSE](LICENSE).
