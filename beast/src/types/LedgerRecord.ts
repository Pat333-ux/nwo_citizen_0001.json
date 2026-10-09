export interface LedgerRecord {
  id: string;
  sequence: number;
  previousHash: string;
  payloadHash: string;
  currentHash: string;
  actor: string;
  action: string;
  timestamp: number;
}
