// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// PostToolUse (Write|Edit): format the touched file in place.
// Config: format (command line; file path appended as the last arg), formatExtensions ([".ts", …]).
// Formatting runs after the edit; a failure reports feedback without undoing it.
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { readHookInput, loadConfig, runConfigured, targetFile } from "./_lib.mjs";

const input = await readHookInput();
const file = targetFile(input);
const cfg = loadConfig();

const rawExtensions = cfg.formatExtensions;
const extensions = (Array.isArray(rawExtensions) ? rawExtensions : []).map((ext) => String(ext).toLowerCase());
if (file && cfg.format && existsSync(file) && extensions.includes(extname(file).toLowerCase())) {
  const result = runConfigured(cfg.format, ["--", file], { timeout: 30_000 });
  if (result.error || result.signal || result.status !== 0) {
    process.stderr.write(`格式化未完成：${file}\n${result.stderr || result.error?.message || result.signal || result.status}\n`);
    process.exit(2);
  }
}

process.exit(0);
