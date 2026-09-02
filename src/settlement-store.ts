import type { SettleResponse } from "@x402/core/types";

export type SettlementState = "pending" | "succeeded" | "failed";

export interface SettlementRecord {
  transactionId: string;
  fingerprint: string;
  state: SettlementState;
  response?: SettleResponse;
  createdAt: number;
  updatedAt: number;
}

export type SettlementClaim =
  | { status: "claimed"; record: SettlementRecord }
  | { status: "duplicate"; record: SettlementRecord }
  | { status: "conflict"; record: SettlementRecord };

/**
 * Atomic replay-protection boundary. Production facilitators should implement
 * this interface with durable storage shared by every facilitator replica.
 */
export interface SettlementStore {
  claim(transactionId: string, fingerprint: string): Promise<SettlementClaim>;
  save(
    transactionId: string,
    state: SettlementState,
    response: SettleResponse,
  ): Promise<void>;
  get(transactionId: string): Promise<SettlementRecord | undefined>;
}

/** Process-local store for tests and single-process development. */
export class InMemorySettlementStore implements SettlementStore {
  private readonly records = new Map<string, SettlementRecord>();

  claim(transactionId: string, fingerprint: string): Promise<SettlementClaim> {
    const existing = this.records.get(transactionId);
    if (existing) {
      return Promise.resolve({
        status: existing.fingerprint === fingerprint ? "duplicate" : "conflict",
        record: { ...existing },
      });
    }

    const now = Date.now();
    const record: SettlementRecord = {
      transactionId,
      fingerprint,
      state: "pending",
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(transactionId, record);
    return Promise.resolve({ status: "claimed", record: { ...record } });
  }

  save(
    transactionId: string,
    state: SettlementState,
    response: SettleResponse,
  ): Promise<void> {
    const existing = this.records.get(transactionId);
    if (!existing) {
      throw new Error(`Cannot save an unclaimed settlement: ${transactionId}`);
    }
    this.records.set(transactionId, {
      ...existing,
      state,
      response: { ...response },
      updatedAt: Date.now(),
    });
    return Promise.resolve();
  }

  get(transactionId: string): Promise<SettlementRecord | undefined> {
    const record = this.records.get(transactionId);
    return Promise.resolve(record ? { ...record } : undefined);
  }
}
