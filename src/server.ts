import { startWellbeingHttpService } from "./http-service.ts";

const port = Number(process.env.PORT ?? "3000");
const host = process.env.HOST ?? "127.0.0.1";
const configDir = process.env.BEAST3_CONFIG_DIR ?? process.cwd();
const ledgerDir = process.env.BEAST3_LEDGER_DIR;

try {
  const server = await startWellbeingHttpService({ host, port, configDir, ledgerDir });
  console.log(`Beast 3.0 wellbeing service listening on ${host}:${port}`);
  process.on("SIGINT", () => server.close());
  process.on("SIGTERM", () => server.close());
} catch {
  console.error("Beast 3.0 wellbeing service failed to start");
  process.exitCode = 1;
}
