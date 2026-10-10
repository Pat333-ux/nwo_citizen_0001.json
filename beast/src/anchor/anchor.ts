import { randomUUID } from "node:crypto";
import pg from "pg";
import { merkleRoot } from "../crypto/merkle.ts";
import type { LedgerService } from "../ledger/store.ts";

export interface Anchor {
  id: string;
  root: string;
  records: number;
  network: string;
  txRef: string;
  anchoredAt: Date;
}

export interface AnchorStore {
  insert(a: Anchor): Promise<void>;
  list(): Promise<Anchor[]>; // oldest first
}

export class MemoryAnchorStore implements AnchorStore {
  #a: Anchor[] = [];
  async insert(a: Anchor) {
    this.#a.push({ ...a });
  }
  async list() {
    return this.#a.map((a) => ({ ...a }));
  }
}

export class PostgresAnchorStore implements AnchorStore {
  #pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }
  async insert(a: Anchor) {
    await this.#pool.query(
      "INSERT INTO ledger_anchors (id, root, records, network, tx_ref, anchored_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [a.id, a.root, a.records, a.network, a.txRef, a.anchoredAt],
    );
  }
  async list() {
    const r = await this.#pool.query("SELECT * FROM ledger_anchors ORDER BY anchored_at ASC, id ASC");
    return r.rows.map((w): Anchor => ({ id: w.id, root: w.root, records: w.records, network: w.network, txRef: w.tx_ref, anchoredAt: w.anchored_at }));
  }
}

/** Publishes a 32-byte hex root somewhere durable and returns a reference (e.g. a transaction hash). */
export interface Anchorer {
  readonly network: string;
  publish(root: string): Promise<string>;
}

/** Default. Publishes nothing externally, so it gives NO public proof; it only exercises the pipeline. */
export class LocalAnchorer implements Anchorer {
  readonly network = "local-only";
  async publish(root: string) {
    return `local:${root}`;
  }
}

/**
 * Anchors by sending a zero-value self-transaction whose data is the root, via a JSON-RPC
 * endpoint that holds the key (own node, Clef, or a managed signer). This service never
 * sees a private key.
 */
export class EthereumRpcAnchorer implements Anchorer {
  readonly network: string;
  #url: string;
  #from: string;
  constructor(opts: { rpcUrl: string; from: string; network: string }) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(opts.from)) throw new Error("ETH_ANCHOR_FROM must be a 0x address");
    this.#url = opts.rpcUrl;
    this.#from = opts.from;
    this.network = opts.network;
  }
  async publish(root: string) {
    const res = await fetch(this.#url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "eth_sendTransaction",
        params: [{ from: this.#from, to: this.#from, value: "0x0", data: `0x${root}` }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json()) as { result?: string; error?: { message?: string } };
    if (!res.ok || body.error || !body.result || !/^0x[0-9a-fA-F]{64}$/.test(body.result)) {
      throw new Error(`anchor transaction failed: ${body.error?.message ?? res.status}`);
    }
    return body.result;
  }
}

export class AnchorService {
  #ledger: LedgerService;
  #store: AnchorStore;
  #anchorer: Anchorer;
  #busy = false;

  constructor(ledger: LedgerService, store: AnchorStore, anchorer: Anchorer) {
    this.#ledger = ledger;
    this.#store = store;
    this.#anchorer = anchorer;
  }

  get network(): string {
    return this.#anchorer.network;
  }

  list(): Promise<Anchor[]> {
    return this.#store.list();
  }

  async latest(): Promise<Anchor | undefined> {
    return (await this.#store.list()).at(-1);
  }

  /** Verifies the chain, then anchors the current root unless it equals the last anchored root. */
  async anchorNow(actor: string): Promise<{ anchored: boolean; anchor?: Anchor; reason?: string }> {
    if (this.#busy) return { anchored: false, reason: "anchoring already in progress" };
    this.#busy = true;
    try {
      const v = await this.#ledger.verify();
      if (!v.valid) throw new Error("ledger verification failed; refusing to anchor");
      const recs = await this.#ledger.list();
      if (recs.length === 0) return { anchored: false, reason: "ledger is empty" };
      const last = await this.latest();
      const root = merkleRoot(recs.map((r) => r.currentHash));
      // Our own trailing anchor record must not trigger another anchor: compare the root without it.
      const base = recs.at(-1)?.action === "ledger.anchored" ? recs.slice(0, -1) : recs;
      if (last && merkleRoot(base.map((r) => r.currentHash)) === last.root) {
        return { anchored: false, reason: "no new records since last anchor" };
      }
      const txRef = await this.#anchorer.publish(root);
      const anchor: Anchor = { id: randomUUID(), root, records: recs.length, network: this.#anchorer.network, txRef, anchoredAt: new Date() };
      await this.#store.insert(anchor);
      await this.#ledger.append(actor, "ledger.anchored", { root, records: anchor.records, network: anchor.network, txRef });
      return { anchored: true, anchor };
    } finally {
      this.#busy = false;
    }
  }
}

export function startAnchorSchedule(svc: AnchorService, intervalMs: number, log: (l: string) => void, onFailure: () => void = () => {}): () => void {
  const t = setInterval(() => {
    svc.anchorNow("system").then(
      (r) => log(`anchor ${r.anchored ? "published " + r.anchor!.txRef : "skipped: " + r.reason}`),
      (e: Error) => {
        log(`anchor FAILED: ${e.message}`);
        onFailure();
      },
    );
  }, intervalMs);
  t.unref();
  return () => clearInterval(t);
}
