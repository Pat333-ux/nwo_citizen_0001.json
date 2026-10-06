# nwo-debt-relief-300

Federal debt-relief routing engine: catalogs programs, evaluates member eligibility, generates application packets, and hands them to Beast System 3.0.

## Purpose
Normalize U.S. federal debt-relief programs (student loans, tax, SBA, mortgage, utility, medical, emergency) into one schema (`config/schema.json`) and produce apply-ready packets.

## How the engine works
`src/engine.ts` loads `data/programs.json`, evaluates each program's declarative `requirements` (field/op/value against the member profile), builds packets (forms, instructions, `autoFill` mapped from member profile paths), and `src/pipeline/index.ts#processMember` returns all packets. The pipeline is deterministic: same profile, same output. Requirements are data (not functions) so the catalog stays valid JSON.

Run tests: `npm test` (Node 22.18+ / 24, runs TypeScript natively).

## Adding a program
Append an object to `data/programs.json` following `config/schema.json`. Include `source_urls` (official agency pages, see `docs/federal-sources.md`) and `last_verified`.

## Beast System consumption
`src/pipeline/beast-hook.ts#beastIntegration(packet)` returns `{anchorId, citizenId, payload, status: "ready-for-routing"}` for Beast System to route, log, and trigger municipal workflows.

## Compliance notes
Packets are prepared for the member's review; this system does not submit applications or make eligibility determinations on behalf of an agency. Handle PII (SSNs etc.) per applicable law; store only the minimum (e.g. last 4 digits). Program rules here are simplified screening criteria, not legal advice.

## Verification policy
Every program must cite official `.gov` sources and a `last_verified` date; re-verify at least every 6 months and whenever an agency announces changes. Unverified programs must not be added.
