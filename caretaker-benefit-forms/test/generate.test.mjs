import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render, validate, plan, generate } from "../generate.mjs";

const payload = JSON.parse(readFileSync(new URL("../example_payload.json", import.meta.url), "utf8"));
const rules = JSON.parse(readFileSync(new URL("../generation_rules.json", import.meta.url), "utf8"));
const root = new URL("../", import.meta.url).pathname;

test("every rule template exists", () => {
  for (const r of [...rules.rules, ...rules.always]) assert.ok(existsSync(join(root, r.template_path)), r.template_path);
});
test("example payload is valid; bad ssn rejected", () => {
  assert.deepEqual(validate(payload), []);
  assert.ok(validate({ ...payload, member: { ...payload.member, ssn_last_four: "12" } }).length > 0);
  assert.ok(validate({ ...payload, authorized_scopes: ["NOPE"] }).length > 0);
});
test("render substitutes values", () => {
  assert.equal(render("{{member.full_name}}-{{x.y}}", payload), "Jane Doe-");
});
test("plan follows scopes", () => {
  const p = plan(payload);
  assert.equal(p.length, 6);
});
test("generate writes files with no unresolved placeholders", () => {
  const out = mkdtempSync(join(tmpdir(), "forms-"));
  generate(payload, out);
  assert.ok(readdirSync(out).length > 0);
  for (const f of readdirSync(out)) assert.doesNotMatch(readFileSync(join(out, f), "utf8"), /\{\{/);
});
