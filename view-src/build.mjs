// Bundles main.js (vis-timeline standalone + our renderer) into a single,
// fully offline HTML file at ../src/timeline_creator/view/index.html.
// Run via `npm run build`.
import esbuild from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outHtml = resolve(here, "../src/timeline_creator/view/index.html");

const result = await esbuild.build({
  entryPoints: [resolve(here, "main.js")],
  bundle: true,
  format: "iife",
  minify: true,
  platform: "browser",
  target: ["es2019"],
  legalComments: "none",
  loader: { ".css": "text" },
  write: false,
});

// Escape sequences that would terminate our inline <script> early or match the
// host's "inject before the first </body>" splice (same trick as chart-creator).
function escapeForInlineScript(code) {
  return code
    .replace(/<\/(script|style|body|head|html|title|iframe|textarea)/gi, "<\\/$1")
    .replace(/<!--/g, "<\\!--")
    .replace(/<!doctype/gi, "<\\!doctype");
}

const js = escapeForInlineScript(result.outputFiles[0].text);
const shell = readFileSync(resolve(here, "index.html"), "utf8");
const html = shell.replace("/*__BUNDLE__*/", () => js);

if (html.includes("/*__BUNDLE__*/")) {
  throw new Error("Bundle placeholder not found in index.html shell");
}
if (/src\s*=\s*["']https?:/i.test(html)) {
  throw new Error("Output is not offline: found a remote src= reference");
}
for (const tag of ["</script>", "</body>", "</html>"]) {
  const n = html.split(tag).length - 1;
  if (n !== 1) throw new Error(`Expected exactly one "${tag}" in output, found ${n} (unescaped bundle content?)`);
}

writeFileSync(outHtml, html);
console.log(`Wrote ${outHtml} (${(html.length / 1024).toFixed(0)} KB)`);
