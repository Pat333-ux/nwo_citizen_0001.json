# nwo-debt-relief-300

Federal debt-relief routing engine: catalogs programs, evaluates member eligibility, generates application packets, and hands them to Beast System 3.0.

## Purpose
Normalize U.S. federal debt-relief programs (student loans, tax, SBA, mortgage, utility, medical, emergency) into one schema (`config/schema.json`) and produce apply-ready packets.

## How the engine works
`src/engine.ts` loads `data/programs.json`, evaluates each program's declarative `requirements` (field/op/value against the member profile), builds packets (forms, instructions, `autoFill` mapped from member profile paths), and `src/pipeline/index.ts#processMember` returns all packets. The pipeline is deterministic: same profile, same output. Rules are data (not functions) so the catalog stays valid JSON.

Type-check: `npm run type-check`. Run tests: `npm test` (Node 22.18+ / 24, runs TypeScript natively).

## Adding a program
Append an object to `data/programs.json` following `config/schema.json`. `eligibility.requirements` is human-readable; add machine-evaluable `eligibility.rules` (and optional `application.autoFill`) for the engine to auto-match — programs without rules are never auto-matched. Include `source_urls` (official agency pages, see `docs/federal-sources.md`) and `last_verified`.

## Beast System consumption
`processMember` signs each packet (SHA-256 over programId, memberId, autoFill, timestamp); `src/pipeline/beast-hook.ts#beastIntegration(packet)` returns a routing envelope `{envelopeId, signature, route, payload, status: "ready-for-routing"}`; `src/pipeline/log.ts` records events for Beast System to route, log, and trigger municipal workflows.

## Compliance and Verification

This repository provides structured information and automation logic for U.S. government debt-relief programs. It is not legal, financial, or tax advice. Program rules, eligibility criteria, and application procedures can change at any time. All program entries must include official source URLs and a `last_verified` date. Users and downstream systems must always verify program details directly with the relevant federal agency before acting on any generated application packet.

Handle PII (SSNs etc.) per applicable law and store only the minimum (e.g. last 4 digits). Packets are prepared for member review; this system does not submit applications.

Re-verify each program at least every 6 months and whenever an agency announces changes. Unverified programs must not be added.
