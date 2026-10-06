import type { Program } from "../types.ts";

export interface AgencyChannel { agencyId: string; name: string; hosts: string[] }

export const AGENCIES: AgencyChannel[] = [
  { agencyId: "ed", name: "U.S. Department of Education (StudentAid.gov)", hosts: ["studentaid.gov"] },
  { agencyId: "irs", name: "Internal Revenue Service", hosts: ["irs.gov"] },
  { agencyId: "sba", name: "U.S. Small Business Administration", hosts: ["sba.gov"] },
  { agencyId: "hud", name: "U.S. Department of Housing and Urban Development", hosts: ["hud.gov"] },
  { agencyId: "va", name: "U.S. Department of Veterans Affairs", hosts: ["va.gov"] },
  { agencyId: "usda", name: "U.S. Department of Agriculture", hosts: ["usda.gov"] },
  { agencyId: "hhs", name: "U.S. Department of Health and Human Services", hosts: ["acf.gov", "medicaid.gov", "healthcare.gov", "benefits.gov"] },
  { agencyId: "fema", name: "Federal Emergency Management Agency", hosts: ["disasterassistance.gov", "fema.gov"] }
];

export function agencyForProgram(program: Program): AgencyChannel {
  for (const url of program.source_urls) {
    const host = new URL(url).hostname;
    const match = AGENCIES.find(a => a.hosts.some(h => host === h || host.endsWith(`.${h}`)));
    if (match) return match;
  }
  throw new Error(`No agency channel for program ${program.id}`);
}
