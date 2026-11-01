// Builds the sandboxed catalog-manager plugin and makes sure the site can find it.
// Runs automatically before `astro build` (see package.json "build").
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = resolve(root, "catalog-manager");
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: "inherit", shell: true });

if (process.env.EMDASH_CATALOG_PLUGIN !== "1") {
	console.log("Catalog plugin is off (Workers free plan) - skipping its build.");
	process.exit(0);
}

console.log("Building catalog-manager plugin…");
if (!existsSync(resolve(pluginDir, "node_modules"))) run("npm ci --no-audit --no-fund", pluginDir);
run("npm run build", pluginDir);

if (!existsSync(resolve(pluginDir, "dist", "plugin.mjs"))) {
	console.error("catalog-manager build did not produce dist/plugin.mjs");
	process.exit(1);
}

// pnpm may install the plugin as a copy instead of a link; refresh that copy's dist folder.
// Copies file by file, skips files that are already identical, and retries when Windows
// (antivirus, Explorer, a leftover process) briefly locks a file.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const same = (a, b) => existsSync(b) && readFileSync(a).equals(readFileSync(b));

function syncDir(src, dest) {
	mkdirSync(dest, { recursive: true });
	for (const entry of readdirSync(src, { withFileTypes: true })) {
		const from = resolve(src, entry.name);
		const to = resolve(dest, entry.name);
		if (entry.isDirectory()) { syncDir(from, to); continue; }
		if (same(from, to)) continue;
		for (let attempt = 1; ; attempt++) {
			try { copyFileSync(from, to); break; }
			catch (err) {
				if (attempt >= 8) throw new Error(`Could not update ${to} (${err.code}). Close other terminals/editors using this folder and try again.`);
				sleep(500 * attempt);
			}
		}
	}
}

const installed = resolve(root, "node_modules", "catalog-manager");
if (existsSync(installed) && realpathSync(installed) !== realpathSync(pluginDir)) {
	syncDir(resolve(pluginDir, "dist"), resolve(realpathSync(installed), "dist"));
	console.log("Plugin build is in place in node_modules/catalog-manager");
}
