// Generates [data-theme="…"] CSS blocks from public/themes.json.
//   node scripts/gen-theme-css.mjs   → prints CSS to stdout
import { readFileSync } from "node:fs";

const { themes } = JSON.parse(readFileSync("public/themes.json", "utf8"));

let out = "/* ── Generated color themes (scripts/gen-theme-css.mjs — do not hand-edit) ── */\n";
for (const t of themes) {
  const [surface, sunken, overlay, ink, muted, border, brand, brand600, grad, success, danger] = t.tokens;
  out += `[data-theme="${t.id}"] {\n`;
  out += `  --bg-surface: ${surface};\n`;
  out += `  --bg-sunken: ${sunken};\n`;
  out += `  --bg-overlay: ${overlay};\n`;
  out += `  --text-primary: ${ink};\n`;
  out += `  --text-secondary: ${muted};\n`;
  out += `  --text-tertiary: ${muted};\n`;
  out += `  --border-default: ${border};\n`;
  out += `  --border-subtle: ${sunken};\n`;
  out += `  --border-strong: ${border};\n`;
  out += `  --brand-500: ${brand};\n`;
  out += `  --brand-600: ${brand600};\n`;
  out += `  --gradient-brand: linear-gradient(135deg, ${brand}, ${grad});\n`;
  out += `  --semantic-success: ${success};\n`;
  out += `  --semantic-danger: ${danger};\n`;
  out += `}\n`;
}
process.stdout.write(out);
