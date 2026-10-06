export interface LogEvent { event: string; [key: string]: unknown }

const entries: LogEvent[] = [];

export function log(event: string, details: Record<string, unknown> = {}): LogEvent {
  const entry = { event, ...details };
  entries.push(entry);
  return entry;
}

export function getLog(): readonly LogEvent[] { return entries; }
export function clearLog(): void { entries.length = 0; }
