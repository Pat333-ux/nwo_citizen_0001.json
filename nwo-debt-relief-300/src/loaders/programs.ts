import { readFileSync } from "node:fs";
import type { Program } from "../types.ts";

const path = new URL("../../data/programs.json", import.meta.url);

export function loadPrograms(): Program[] {
  const programs = JSON.parse(readFileSync(path, "utf8")) as Program[];
  for (const p of programs) {
    if (!p.source_urls?.length || !p.last_verified) {
      throw new Error(`Program ${p.id} missing source_urls or last_verified`);
    }
  }
  return programs;
}
