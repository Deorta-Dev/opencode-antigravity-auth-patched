#!/usr/bin/env node
/**
 * Instalador de la copia parcheada de opencode-antigravity-auth para OpenCode 2.2+.
 *
 * Este script descarga la versión oficial del plugin desde npm, aplica dos
 * parches sobre el `dist` compilado y apunta la configuración de OpenCode a la
 * copia local. Es idempotente: se puede ejecutar varias veces sin duplicar nada.
 *
 * Uso:
 *   node scripts/install.mjs [opciones]
 *
 * Opciones:
 *   --prefix <ruta>   Carpeta vendor (por defecto ~/.config/opencode/vendor/antigravity)
 *   --version <ver>   Versión del plugin (por defecto 2.1.2)
 *   --no-config       No modificar opencode.json / opencode.jsonc
 *   --force           Reinstalar el paquete desde npm antes de parchear
 *   --verify-only     Solo verificar que los parches estén aplicados
 *   --help, -h        Mostrar esta ayuda
 */

import { spawnSync } from "node:child_process";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_VERSION = "2.1.2";
// Spec de Git de esta distribución parcheada. El plugin se reconoce a sí mismo
// en la configuración y, si falta, escribe esta entrada en vez de la de npm.
const PATCHED_SPEC = "github:Deorta-Dev/opencode-antigravity-auth-patched#v2.1.2-patched.1";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const PATCH_DIR = join(REPO_ROOT, "patches");

const ok = (msg) => console.log(`[OK] ${msg}`);
const warn = (msg) => console.log(`[!]  ${msg}`);
const fail = (msg) => console.error(`[X]  ${msg}`);
const step = (msg) => console.log(`\n==> ${msg}`);

function printHelp() {
    console.log(`opencode-antigravity-auth-patched

Uso:
  node scripts/install.mjs [opciones]

Opciones:
  --prefix <ruta>   Carpeta vendor (por defecto ~/.config/opencode/vendor/antigravity)
  --version <ver>   Versión del plugin (por defecto ${DEFAULT_VERSION})
  --no-config       No modificar opencode.json / opencode.jsonc
  --force           Reinstalar el paquete desde npm antes de parchear
  --verify-only     Solo verificar que los parches estén aplicados
  --help, -h        Mostrar esta ayuda

Ejemplos:
  node scripts/install.mjs
  node scripts/install.mjs --prefix "D:\\opencode\\vendor\\antigravity"
  node scripts/install.mjs --verify-only
`);
}

function parseArgs(argv) {
    const opts = {
        prefix: null,
        version: DEFAULT_VERSION,
        config: true,
        force: false,
        verifyOnly: false,
        help: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") opts.help = true;
        else if (arg === "--no-config") opts.config = false;
        else if (arg === "--force") opts.force = true;
        else if (arg === "--verify-only") opts.verifyOnly = true;
        else if (arg === "--prefix") {
            if (!argv[i + 1]) throw new Error("Falta el valor de --prefix");
            opts.prefix = argv[++i];
        } else if (arg.startsWith("--prefix=")) {
            opts.prefix = arg.slice("--prefix=".length);
        } else if (arg === "--version") {
            if (!argv[i + 1]) throw new Error("Falta el valor de --version");
            opts.version = argv[++i];
        } else if (arg.startsWith("--version=")) {
            opts.version = arg.slice("--version=".length);
        } else {
            throw new Error(`Opción desconocida: ${arg}`);
        }
    }
    return opts;
}

function shellQuote(value) {
    const text = String(value);
    return /[\s"]/g.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

function runNpm(args) {
    const command = ["npm", ...args.map(shellQuote)].join(" ");
    console.log(`> ${command}`);
    const result = spawnSync(command, { stdio: "inherit", shell: true });
    if (result.error) throw result.error;
    return result.status ?? 1;
}

function npmAvailable() {
    const result = spawnSync("npm --version", { shell: true, encoding: "utf8" });
    return result.status === 0;
}

function readJson(file) {
    return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

/**
 * Elimina comentarios de línea/bloque y comas finales de un JSONC.
 * Respeta las cadenas, incluidas las comillas escapadas.
 */
function stripJsonComments(text) {
    const source = text.replace(/^\uFEFF/, "");
    let out = "";
    let inString = false;
    let inLine = false;
    let inBlock = false;

    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        const next = source[i + 1];

        if (inLine) {
            if (c === "\n") {
                inLine = false;
                out += c;
            }
            continue;
        }
        if (inBlock) {
            if (c === "*" && next === "/") {
                inBlock = false;
                i++;
            }
            continue;
        }
        if (inString) {
            out += c;
            if (c === "\\") {
                out += source[++i] ?? "";
            } else if (c === '"') {
                inString = false;
            }
            continue;
        }
        if (c === '"') {
            inString = true;
            out += c;
            continue;
        }
        if (c === "/" && next === "/") {
            inLine = true;
            i++;
            continue;
        }
        if (c === "/" && next === "*") {
            inBlock = true;
            i++;
            continue;
        }
        out += c;
    }

    return out.replace(/,\s*([}\]])/g, "$1");
}

function findConfigFile(configDir) {
    const jsonc = join(configDir, "opencode.jsonc");
    const json = join(configDir, "opencode.json");
    if (existsSync(jsonc)) return jsonc;
    if (existsSync(json)) return json;
    return json;
}

function updateConfig(configDir, moduleDir) {
    const file = findConfigFile(configDir);
    let cfg = {};

    if (existsSync(file)) {
        try {
            cfg = JSON.parse(stripJsonComments(readFileSync(file, "utf8")));
        } catch (error) {
            warn(`No se pudo interpretar ${file}: ${error.message}`);
            warn("Añade esta entrada manualmente a la lista \"plugins\":");
            console.log(`    ${JSON.stringify(moduleDir)}`);
            return false;
        }
    }

    const current = Array.isArray(cfg.plugins) ? cfg.plugins : [];
    const filtered = current.filter(
        (entry) => typeof entry !== "string" || !entry.includes("opencode-antigravity-auth"),
    );
    filtered.push(moduleDir);

    const unchanged =
        filtered.length === current.length &&
        filtered.every((entry, index) => entry === current[index]);

    if (unchanged) {
        ok(`${file} ya apunta a la copia local.`);
        return true;
    }

    if (existsSync(file)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        copyFileSync(file, `${file}.bak-${stamp}`);
    }

    cfg.plugins = filtered;
    writeJson(file, cfg);
    ok(`Configuración actualizada: ${file}`);
    if (file.endsWith(".jsonc")) {
        warn("El archivo era .jsonc y se reescribió como JSON: los comentarios se pierden (hay respaldo).");
    }
    return true;
}

function ensurePackage(vendorDir, moduleDir, version, force) {
    mkdirSync(vendorDir, { recursive: true });

    const vendorPkg = join(vendorDir, "package.json");
    if (!existsSync(vendorPkg)) {
        writeJson(vendorPkg, { private: true });
    }

    if (force && existsSync(moduleDir)) {
        rmSync(moduleDir, { recursive: true, force: true });
    }

    const modulePkg = join(moduleDir, "package.json");
    const requestFile = join(moduleDir, "dist", "src", "plugin", "request.js");
    let needInstall = true;

    if (existsSync(modulePkg) && existsSync(requestFile)) {
        try {
            needInstall = readJson(modulePkg).version !== version;
        } catch {
            needInstall = true;
        }
    }

    if (!needInstall) {
        ok(`opencode-antigravity-auth@${version} ya está instalado en la copia local.`);
        return;
    }

    step(`Instalando opencode-antigravity-auth@${version}`);
    const code = runNpm([
        "install",
        "--prefix",
        vendorDir,
        `opencode-antigravity-auth@${version}`,
        "--no-audit",
        "--no-fund",
    ]);

    if (code !== 0 || !existsSync(modulePkg) || !existsSync(requestFile)) {
        throw new Error("npm no pudo instalar el paquete. Revisa la salida anterior.");
    }
}

function patchAccountList(moduleDir) {
    const file = join(moduleDir, "dist", "src", "plugin", "account-management.js");
    if (!existsSync(file)) throw new Error(`No se encontró ${file}`);

    let text = readFileSync(file, "utf8");
    if (text.includes("JSON.parse(JSON.stringify(accounts))")) return false;

    const pattern = /return\s+(storage\.accounts\.map\(\(account, index\) => \(\{[\s\S]*?\}\)\));/;
    if (!pattern.test(text)) {
        throw new Error("No se reconoce el bloque list() de account-management.js. ¿Versión distinta?");
    }

    text = text.replace(
        pattern,
        (_, expression) =>
            `const accounts = ${expression};\n` +
            "        // OpenCode 2.2+ rejects RPC outputs containing undefined values.\n" +
            "        return JSON.parse(JSON.stringify(accounts));",
    );

    writeFileSync(file, text);
    return true;
}

function writePromptSignature(moduleDir) {
    const source = join(PATCH_DIR, "prompt-signature.js");
    const destination = join(moduleDir, "dist", "src", "plugin", "transform", "prompt-signature.js");
    if (!existsSync(source)) throw new Error(`Falta el archivo ${source}`);

    mkdirSync(dirname(destination), { recursive: true });
    const desired = readFileSync(source, "utf8");
    const current = existsSync(destination) ? readFileSync(destination, "utf8") : null;
    if (current === desired) return false;

    writeFileSync(destination, desired);
    return true;
}

function patchRequest(moduleDir) {
    const file = join(moduleDir, "dist", "src", "plugin", "request.js");
    if (!existsSync(file)) throw new Error(`No se encontró ${file}`);

    const original = readFileSync(file, "utf8");
    let text = original;

    if (!text.includes("prompt-signature.js")) {
        const anchor = 'import { sanitizeCrossModelPayloadInPlace } from "./transform/cross-model-sanitizer.js";';
        if (!text.includes(anchor)) {
            throw new Error("No se encontró el import de cross-model-sanitizer en request.js.");
        }
        text = text.replace(
            anchor,
            `${anchor}\nimport { sanitizeOpenCodePromptSignatureInPlace } from "./transform/prompt-signature.js";`,
        );
    }

    if (!text.includes("sanitizeOpenCodePromptSignatureInPlace(req);")) {
        const anchor = "applyToolPairingFixes(req, true);";
        if (!text.includes(anchor)) {
            throw new Error("No se encontró applyToolPairingFixes en request.js.");
        }
        text = text.replace(
            anchor,
            `${anchor}\n` +
                "                        // Neutralize the OpenCode Code Mode prompt signature (upstream #622 / PR #623)\n" +
                "                        sanitizeOpenCodePromptSignatureInPlace(req);",
        );
    }

    if (!text.includes("sanitizeOpenCodePromptSignatureInPlace(requestPayload);")) {
        const anchor = "sanitizeRequestPayloadForAntigravity(requestPayload);";
        if (!text.includes(anchor)) {
            throw new Error("No se encontró sanitizeRequestPayloadForAntigravity en request.js.");
        }
        text = text.replace(
            anchor,
            `${anchor}\n                sanitizeOpenCodePromptSignatureInPlace(requestPayload);`,
        );
    }

    if (text === original) return false;
    writeFileSync(file, text);
    return true;
}

/**
 * El plugin reescribe `opencode.json(c)` en la opción "configurar modelos" del
 * menú /antigravity. Sin este parche no reconocería su propia spec de Git y
 * añadiría `opencode-antigravity-auth@latest` (la versión sin parches), que
 * OpenCode cargaría además de esta.
 */
function patchSelfReference(moduleDir) {
    const file = join(moduleDir, "dist", "src", "plugin", "config", "updater.js");
    if (!existsSync(file)) throw new Error(`No se encontró ${file}`);

    const original = readFileSync(file, "utf8");
    let text = original;

    const guard = 'name.includes("opencode-antigravity-auth-patched")';
    if (!text.includes(guard)) {
        const anchor = 'if (name === "opencode-antigravity-auth" || name.startsWith("opencode-antigravity-auth@"))';
        if (!text.includes(anchor)) {
            throw new Error("No se reconoce isAntigravityEntry en config/updater.js.");
        }
        text = text.replace(
            anchor,
            'if (name === "opencode-antigravity-auth" || name.startsWith("opencode-antigravity-auth@") || name.includes("opencode-antigravity-auth-patched"))',
        );
    }

    if (!text.includes(PATCHED_SPEC)) {
        const pattern = /const PLUGIN_NAME = "[^"]*";/;
        if (!pattern.test(text)) {
            throw new Error("No se encontró la constante PLUGIN_NAME en config/updater.js.");
        }
        text = text.replace(pattern, `const PLUGIN_NAME = ${JSON.stringify(PATCHED_SPEC)};`);
    }

    if (text === original) return false;
    writeFileSync(file, text);
    return true;
}

function verifyPatches(moduleDir) {
    const accountFile = join(moduleDir, "dist", "src", "plugin", "account-management.js");
    const requestFile = join(moduleDir, "dist", "src", "plugin", "request.js");
    const signatureFile = join(moduleDir, "dist", "src", "plugin", "transform", "prompt-signature.js");

    const account = existsSync(accountFile) ? readFileSync(accountFile, "utf8") : "";
    const request = existsSync(requestFile) ? readFileSync(requestFile, "utf8") : "";
    const updaterFile = join(moduleDir, "dist", "src", "plugin", "config", "updater.js");
    const updater = existsSync(updaterFile) ? readFileSync(updaterFile, "utf8") : "";
    const calls = (request.match(/sanitizeOpenCodePromptSignatureInPlace\(/g) || []).length;

    const checks = [
        ["account-management.js serializa sin undefined", account.includes("JSON.parse(JSON.stringify(accounts))")],
        [
            "account-management.js cierra correctamente la llamada a map",
            /const accounts = storage\.accounts\.map\([\s\S]*?\}\)\);/.test(account),
        ],
        ["prompt-signature.js presente", existsSync(signatureFile)],
        ["request.js importa el saneador", request.includes("./transform/prompt-signature.js")],
        ["request.js llama al saneador en 2 puntos", calls >= 2],
        ["config/updater.js reconoce la spec parcheada", updater.includes('name.includes("opencode-antigravity-auth-patched")')],
        ["PLUGIN_NAME apunta a la spec parcheada", updater.includes(PATCHED_SPEC)],
    ];

    let allOk = true;
    for (const [name, pass] of checks) {
        if (pass) ok(name);
        else {
            fail(name);
            allOk = false;
        }
    }

    if (existsSync(signatureFile)) {
        const url = pathToFileURL(signatureFile).href;
        const probe = [
            `const m = await import(${JSON.stringify(url)});`,
            'const request = { systemInstruction: { parts: [{ text: "Code Mode tools.opencode.session_move" }] } };',
            "m.sanitizeOpenCodePromptSignatureInPlace(request);",
            'if (request.systemInstruction.parts[0].text !== \'Code Mode tools["opencode"].session_move\') process.exit(1);',
        ].join("\n");
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
            stdio: "inherit",
        });
        if (result.status === 0) ok("el saneador transforma tools.opencode. correctamente");
        else {
            fail("el saneador no produjo la transformación esperada");
            allOk = false;
        }
    }

    return allOk;
}

function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        printHelp();
        return;
    }

    const major = Number(process.versions.node.split(".")[0]);
    if (major < 20) {
        warn(`Node ${process.versions.node} detectado; el plugin requiere Node >= 20.`);
    }

    const configDir = process.env.OPENCODE_CONFIG_DIR || join(homedir(), ".config", "opencode");
    const vendorDir = opts.prefix ? resolve(opts.prefix) : join(configDir, "vendor", "antigravity");
    const moduleDir = join(vendorDir, "node_modules", "opencode-antigravity-auth");

    console.log("opencode-antigravity-auth-patched");
    console.log(`  config : ${configDir}`);
    console.log(`  vendor : ${vendorDir}`);
    console.log(`  versión: ${opts.version}`);

    if (opts.verifyOnly) {
        if (!existsSync(moduleDir)) {
            fail(`No hay copia local en ${moduleDir}`);
            process.exit(1);
        }
        if (!verifyPatches(moduleDir)) process.exit(1);
        ok("Verificación correcta.");
        return;
    }

    if (!npmAvailable()) {
        fail("npm no está disponible en PATH. Instala Node.js 20+ (incluye npm).");
        process.exit(1);
    }

    ensurePackage(vendorDir, moduleDir, opts.version, opts.force);

    step("Aplicando parches");
    const accountChanged = patchAccountList(moduleDir);
    const signatureChanged = writePromptSignature(moduleDir);
    const requestChanged = patchRequest(moduleDir);
    const selfRefChanged = patchSelfReference(moduleDir);

    if (accountChanged || signatureChanged || requestChanged || selfRefChanged) {
        ok("Parches aplicados.");
    } else {
        ok("Los parches ya estaban aplicados (sin cambios).");
    }

    step("Verificando parches");
    if (!verifyPatches(moduleDir)) {
        fail("La verificación falló. No se modificó la configuración.");
        process.exit(1);
    }

    if (opts.config) {
        step("Actualizando configuración de OpenCode");
        if (!updateConfig(configDir, moduleDir)) process.exit(1);
    } else {
        warn("Se omitió la configuración (--no-config).");
        console.log(`    Añade esta entrada a "plugins": ${JSON.stringify(moduleDir)}`);
    }

    console.log("");
    ok("Instalación completada.");
    console.log("");
    console.log("Siguientes pasos:");
    console.log("  1. opencode reload");
    console.log("  2. Abre OpenCode y usa /antigravity (o /auth) para conectar la cuenta.");
    console.log('  3. Prueba: opencode run --model=google/antigravity-gemini-3.8-flash-high "Reply exactly WORKING and nothing else."');
    console.log("");
    console.log("Para verificar más tarde: node scripts/install.mjs --verify-only");
}

try {
    main();
} catch (error) {
    fail(error.message);
    process.exit(1);
}
