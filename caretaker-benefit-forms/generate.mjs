import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const load = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function render(text, payload) {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => {
    const v = get(payload, p);
    return v == null ? "" : String(v);
  });
}

export function validate(payload, schema = load("schemas/member_onboarding_schema.json"), path = "") {
  const errs = [];
  const t = schema.type;
  if (t === "object") {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return [`${path || "payload"}: expected object`];
    for (const k of schema.required ?? []) if (payload[k] == null) errs.push(`${path}${k}: required`);
    for (const [k, s] of Object.entries(schema.properties ?? {})) if (payload[k] != null) errs.push(...validate(payload[k], s, `${path}${k}.`));
  } else if (t === "array") {
    if (!Array.isArray(payload)) return [`${path}: expected array`];
    payload.forEach((x, i) => errs.push(...validate(x, schema.items, `${path}[${i}].`)));
  } else if (t === "string") {
    if (typeof payload !== "string") return [`${path}: expected string`];
    if (schema.pattern && !new RegExp(schema.pattern).test(payload)) errs.push(`${path}: bad format`);
    if (schema.enum && !schema.enum.includes(payload)) errs.push(`${path}: not an allowed value`);
    if (schema.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(payload)) errs.push(`${path}: expected YYYY-MM-DD`);
    if (schema.format === "email" && !/^[^@\s]+@[^@\s]+$/.test(payload)) errs.push(`${path}: bad email`);
  } else if (t === "integer") {
    if (!Number.isInteger(payload)) errs.push(`${path}: expected integer`);
  }
  return errs.map((e) => e.replace(/\.:/, ":"));
}

export function plan(payload, rules = load("generation_rules.json")) {
  const wanted = rules.rules.filter((r) => payload.authorized_scopes.includes(r.scope));
  return [...wanted, ...(rules.always ?? [])].map((r) => ({
    template: r.template_path,
    output: render(r.output_filename, payload).replace(/\.pdf$/, ".md"),
  }));
}

export function generate(payload, outDir) {
  const errs = validate(payload);
  if (errs.length) throw new Error("Invalid payload:\n" + errs.join("\n"));
  mkdirSync(outDir, { recursive: true });
  return plan(payload).map(({ template, output }) => {
    const file = join(outDir, output);
    writeFileSync(file, render(readFileSync(join(root, template), "utf8"), payload));
    return file;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, out = "out"] = process.argv.slice(2);
  if (!input) { console.error("usage: node generate.mjs payload.json [outDir]"); process.exit(2); }
  try { generate(JSON.parse(readFileSync(input, "utf8")), out).forEach((f) => console.log(f)); }
  catch (e) { console.error(e.message); process.exit(1); }
}
