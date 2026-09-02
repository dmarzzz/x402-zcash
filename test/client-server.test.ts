import { describe, expect, it, vi } from "vitest";
import { ExactZcashScheme as ExactZcashClientScheme } from "../src/exact/client/scheme.js";
import { ExactZcashScheme as ExactZcashServerScheme } from "../src/exact/server/scheme.js";
import { ZCASH_NETWORKS } from "../src/constants.js";
import type { ZcashTransactionSigner } from "../src/types.js";
import { payload, requirements, TRANSACTION_ID } from "./helpers.js";

describe("ExactZcashClientScheme", () => {
  it("creates an x402 payload through the wallet boundary", async () => {
    const createTransaction = vi.fn<
      ZcashTransactionSigner["createTransaction"]
    >(async (request) => {
      expect(request.network).toBe(ZCASH_NETWORKS.regtest);
      expect(request.amount).toBe("1000");
      expect(request.memo).toBe("x402:payment_1234567890");
      return {
        transaction: Buffer.from("deadbeef", "hex").toString("base64"),
        transactionId: TRANSACTION_ID,
        payer: "payer-handle",
      };
    });
    const scheme = new ExactZcashClientScheme({ createTransaction });
    const result = await scheme.createPaymentPayload(2, requirements());

    expect(createTransaction).toHaveBeenCalledOnce();
    expect(result.payload).toMatchObject({
      transactionId: TRANSACTION_ID,
      payer: "payer-handle",
    });
  });

  it("rejects authorization flow because Zcash settlement is upfront", async () => {
    const scheme = new ExactZcashClientScheme({
      createTransaction: vi.fn(),
    });
    const invalid = requirements({
      extra: { ...requirements().extra, paymentFlow: "authorization" },
    });
    await expect(scheme.createPaymentPayload(2, invalid)).rejects.toThrow(
      "upfront",
    );
  });
});

describe("ExactZcashServerScheme", () => {
  it("converts decimal ZEC prices to atomic units", async () => {
    const scheme = new ExactZcashServerScheme();
    await expect(
      scheme.parsePrice("0.00001000 ZEC", ZCASH_NETWORKS.regtest),
    ).resolves.toEqual({
      amount: "1000",
      asset: "ZEC",
      extra: {},
    });
    await expect(
      scheme.parsePrice("$1.00", ZCASH_NETWORKS.regtest),
    ).rejects.toThrow("USD prices");
  });

  it("creates a payment ID and echoes it on paid retries", async () => {
    const scheme = new ExactZcashServerScheme();
    const base = requirements({
      extra: { paymentFlow: "upfront", areFeesSponsored: false },
    });
    const first = await scheme.enrichPaymentRequiredResponse?.({
      requirements: [base],
      resourceInfo: { url: "https://example.test" },
      paymentRequiredResponse: {
        x402Version: 2,
        resource: { url: "https://example.test" },
        accepts: [base],
      },
    });
    const generated = first?.[0]?.extra.paymentId;
    expect(generated).toMatch(/^[A-Za-z0-9_-]{16,128}$/);

    const accepted = {
      ...base,
      extra: { ...base.extra, paymentId: generated },
    };
    const retried = await scheme.enrichPaymentRequiredResponse?.({
      requirements: [base],
      paymentPayload: payload(accepted),
      resourceInfo: { url: "https://example.test" },
      paymentRequiredResponse: {
        x402Version: 2,
        resource: { url: "https://example.test" },
        accepts: [base],
      },
    });
    expect(retried?.[0]?.extra.paymentId).toBe(generated);
  });
});
