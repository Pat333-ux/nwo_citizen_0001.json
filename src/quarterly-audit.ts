import { chmod, mkdir, open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ImmutableFileLedger,
  type RoutingEnvelope
} from "./wellbeing-pipeline.ts";

export interface QuarterlyAuditReport {
  period: string;
  generated_at: string;
  reviewed_envelopes: number;
  counts_by_signal_type: Record<string, number>;
  severity_distribution: Record<string, number>;
  lucr_stability_impacts: Record<string, number>;
  routing_paths: Record<string, number>;
  escalations: Record<string, number>;
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function quarterStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1));
}

function formatQuarter(date: Date): string {
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

export async function collectQuarterlyAudit(
  ledgerDirectory: string,
  period: string,
  generatedAt = new Date()
): Promise<QuarterlyAuditReport> {
  if (!/^\d{4}-Q[1-4]$/.test(period)) throw new TypeError("Audit period must use YYYY-QN format");
  const ledger = new ImmutableFileLedger(ledgerDirectory);
  const report: QuarterlyAuditReport = {
    period,
    generated_at: generatedAt.toISOString(),
    reviewed_envelopes: 0,
    counts_by_signal_type: {},
    severity_distribution: {},
    lucr_stability_impacts: {},
    routing_paths: {},
    escalations: {}
  };
  let names: string[];
  try {
    names = await readdir(ledgerDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return report;
    throw error;
  }
  for (const name of names.filter((entry) => /^[a-f0-9]{64}\.json$/.test(entry)).sort()) {
    const hash = name.slice(0, -5);
    const envelope = await ledger.read(hash) as RoutingEnvelope | null;
    if (!envelope || !envelope.audit.dao_review_required || !envelope.timestamp.startsWith(period.slice(0, 4))) {
      continue;
    }
    const month = Number(envelope.timestamp.slice(5, 7));
    if (!Number.isInteger(month) || `Q${Math.floor((month - 1) / 3) + 1}` !== period.slice(-2)) continue;
    report.reviewed_envelopes += 1;
    increment(report.counts_by_signal_type, envelope.input_signal.signal_type);
    increment(report.severity_distribution, envelope.system_opinion.severity);
    increment(report.lucr_stability_impacts, envelope.system_opinion.dao_alignment.lucr_stability_impact);
    for (const path of envelope.routing_decision.layer_propagation) increment(report.routing_paths, path);
    increment(report.escalations, envelope.routing_decision.escalation_level);
  }
  return report;
}

function toMarkdown(report: QuarterlyAuditReport): string {
  const section = (title: string, values: Record<string, number>) => [
    `## ${title}`,
    "",
    "| Category | Count |",
    "| --- | ---: |",
    ...Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `| ${key} | ${value} |`),
    ""
  ].join("\n");
  return [
    `# Quarterly DAO audit — ${report.period}`,
    "",
    `Generated: ${report.generated_at}`,
    `Envelopes requiring review: ${report.reviewed_envelopes}`,
    "",
    section("Signal types", report.counts_by_signal_type),
    section("Opinion severity", report.severity_distribution),
    section("LUCR stability impact", report.lucr_stability_impacts),
    section("Routing layers", report.routing_paths),
    section("Escalations", report.escalations)
  ].join("\n");
}

async function writeReadOnly(filename: string, contents: string): Promise<void> {
  const file = await open(filename, "wx", 0o600);
  try {
    await file.writeFile(contents, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await chmod(filename, 0o444);
}

export async function generateQuarterlyAuditReport(
  ledgerDirectory: string,
  reportDirectory: string,
  period: string,
  generatedAt = new Date()
): Promise<QuarterlyAuditReport> {
  const report = await collectQuarterlyAudit(ledgerDirectory, period, generatedAt);
  await mkdir(reportDirectory, { recursive: true, mode: 0o700 });
  await chmod(reportDirectory, 0o700);
  const stem = `dao-audit-${period}`;
  const jsonFilename = join(reportDirectory, `${stem}.json`);
  try {
    const existing = JSON.parse(await readFile(jsonFilename, "utf8")) as QuarterlyAuditReport;
    const { generated_at: _existingTime, ...existingData } = existing;
    const { generated_at: _newTime, ...newData } = report;
    if (JSON.stringify(existingData) !== JSON.stringify(newData)) {
      throw new Error("Audit report already exists with different contents");
    }
    const markdownFilename = join(reportDirectory, `${stem}.md`);
    try {
      const existingMarkdown = await readFile(markdownFilename, "utf8");
      if (existingMarkdown !== toMarkdown(existing)) {
        throw new Error("Markdown audit report integrity verification failed");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeReadOnly(markdownFilename, toMarkdown(existing));
    }
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const [extension, contents] of [
    ["json", `${JSON.stringify(report, null, 2)}\n`],
    ["md", toMarkdown(report)]
  ]) {
    const filename = join(reportDirectory, `${stem}.${extension}`);
    try {
      await writeReadOnly(filename, contents);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFile(filename, "utf8");
      if (existing !== contents) throw new Error("Audit report already exists with different contents");
    }
  }
  return report;
}

export function startQuarterlyAuditScheduler(
  ledgerDirectory: string,
  reportDirectory: string,
  now: () => Date = () => new Date()
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const previousPeriod = (date: Date) =>
    formatQuarter(new Date(Date.UTC(date.getUTCFullYear(), quarterStart(date).getUTCMonth() - 1, 1)));
  const logFailure = () => process.stderr.write("Quarterly DAO audit report generation failed\n");
  const schedule = () => {
    if (stopped) return;
    const current = now();
    const next = quarterStart(new Date(Date.UTC(current.getUTCFullYear(), quarterStart(current).getUTCMonth() + 3, 1)));
    const delay = Math.min(
      2_147_000_000,
      Math.max(1, next.getTime() - current.getTime())
    );
    timer = setTimeout(async () => {
      if (now().getTime() < next.getTime()) {
        schedule();
        return;
      }
      try {
        await generateQuarterlyAuditReport(
          ledgerDirectory,
          reportDirectory,
          previousPeriod(next),
          now()
        );
      } catch {
        logFailure();
      } finally {
        schedule();
      }
    }, delay);
    timer.unref();
  };
  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
