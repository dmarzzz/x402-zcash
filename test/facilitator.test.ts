import { describe, expect, it, vi } from "vitest";
import { ExactZcashFacilitator } from "../src/exact/facilitator/scheme.js";
import type { ZakuraClient } from "../src/rpc/zakura.js";
import type {
  ZakuraRawTransaction,
  ZcashPaymentObserver,
} from "../src/types.js";
import { ZCASH_NETWORKS } from "../src/constants.js";
import { PAY_TO, payload, requirements, TRANSACTION_ID } from "./helpers.js";

function visibleTransaction(confirmations = 0): ZakuraRawTransaction {
  return {
    txid: TRANSACTION_ID,
    hex: "deadbeef",
    confirmations,
    vout: [
      {
        value: 0.00001,
        valueZat: 1000,
        n: 0,
        scriptPubKey: { addresses: [PAY_TO] },
      },
    ],
  };
}

function broadcastingNode(): ZakuraClient & {
  sendRawTransaction: ReturnType<typeof vi.fn>;
} {
  let visible = false;
  return {
    sendRawTransaction: vi.fn(async () => {
      visible = true;
      return TRANSACTION_ID;
    }),
    getRawTransaction: vi.fn(async () =>
      visible ? visibleTransaction() : undefined,
    ),
    getBlockHash: vi.fn(async () => "00".repeat(32)),
  };
}

describe("ExactZcashFacilitator transparent settlement", () => {
  it("broadcasts once and verifies an exact transparent output", async () => {
    const zakura = broadcastingNode();
    const facilitator = new ExactZcashFacilitator({
      network: ZCASH_NETWORKS.regtest,
      zakura,
      pollIntervalMs: 10,
    });

    const result = await facilitator.settle(payload(), requirements());
    expect(result).toMatchObject({
      success: true,
      transaction: TRANSACTION_ID,
      network: ZCASH_NETWORKS.regtest,
      amount: "1000",
      extra: { confirmations: 0 },
    });
    expect(zakura.sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("coalesces concurrent settlement retries", async () => {
    let visible = false;
    const zakura: ZakuraClient = {
      sendRawTransaction: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        visible = true;
        return TRANSACTION_ID;
      }),
      getRawTransaction: vi.fn(async () =>
        visible ? visibleTransaction() : undefined,
      ),
      getBlockHash: vi.fn(),
    };
    const facilitator = new ExactZcashFacilitator({
      network: ZCASH_NETWORKS.regtest,
      zakura,
      pollIntervalMs: 10,
    });

    const [first, second] = await Promise.all([
      facilitator.settle(payload(), requirements()),
      facilitator.settle(payload(), requirements()),
    ]);
    expect(first.success).toBe(true);
    expect(second).toEqual(first);
    expect(zakura.sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("rejects a transaction that was public before this payment was claimed", async () => {
    const zakura: ZakuraClient = {
      sendRawTransaction: vi.fn(),
      getRawTransaction: vi.fn(async () => visibleTransaction()),
      getBlockHash: vi.fn(),
    };
    const facilitator = new ExactZcashFacilitator({
      network: ZCASH_NETWORKS.regtest,
      zakura,
      pollIntervalMs: 10,
    });
    const result = await facilitator.settle(payload(), requirements());
    expect(result).toMatchObject({
      success: false,
      errorReason: "transaction_already_broadcast",
    });
    expect(zakura.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("prevents one transaction from satisfying different payment requirements", async () => {
    const zakura = broadcastingNode();
    const facilitator = new ExactZcashFacilitator({
      network: ZCASH_NETWORKS.regtest,
      zakura,
      pollIntervalMs: 10,
    });
    await facilitator.settle(payload(), requirements());

    const changed = requirements({
      extra: { ...requirements().extra, paymentId: "payment_abcdefghij" },
    });
    const result = await facilitator.settle(payload(changed), changed);
    expect(result).toMatchObject({
      success: false,
      errorReason: "duplicate_settlement",
    });
  });
});

describe("ExactZcashFacilitator shielded settlement", () => {
  it("delegates private receipt verification to the merchant observer", async () => {
    const zakura = broadcastingNode();
    const observer: ZcashPaymentObserver = {
      observe: vi.fn(async (request) => {
        expect(request).toMatchObject({
          transactionId: TRANSACTION_ID,
          amount: "1000",
          paymentId: "payment_1234567890",
        });
        return { status: "valid" as const, confirmations: 1 };
      }),
    };
    const facilitator = new ExactZcashFacilitator({
      network: ZCASH_NETWORKS.regtest,
      zakura,
      observer,
      pollIntervalMs: 10,
    });
    const shielded = requirements({ payTo: "uregtest1merchantshielded" });
    const result = await facilitator.settle(payload(shielded), shielded);
    expect(result).toMatchObject({
      success: true,
      extra: { confirmations: 1 },
    });
    expect(observer.observe).toHaveBeenCalledOnce();
  });

  it("fails closed when no shielded observer is configured", async () => {
    const facilitator = new ExactZcashFacilitator({
      network: ZCASH_NETWORKS.regtest,
      zakura: broadcastingNode(),
      pollIntervalMs: 10,
    });
    const shielded = requirements({ payTo: "uregtest1merchantshielded" });
    const result = await facilitator.settle(payload(shielded), shielded);
    expect(result).toMatchObject({
      success: false,
      errorReason: "shielded_payment_observer_not_configured",
    });
  });
});
