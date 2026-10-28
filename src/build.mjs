// Monta o index.html embutindo as fotos de exemplo (src/costas.jpg e src/frente.jpg).
// Uso: node src/build.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = dirname(fileURLToPath(import.meta.url));
const dataUrl = f => "data:image/jpeg;base64," + readFileSync(join(src, f)).toString("base64");

const html = readFileSync(join(src, "fichas.template.html"), "utf8")
  .replace("__COSTAS__", dataUrl("costas.jpg"))
  .replace("__FRENTE__", dataUrl("frente.jpg"));

const out = join(src, "..", "index.html");
writeFileSync(out, html);
console.log(`ok ${html.length} bytes -> index.html`);
