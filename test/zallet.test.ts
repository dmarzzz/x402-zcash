import { describe, expect, it, vi } from "vitest";
import {
  ZalletPaymentObserver,
  ZalletPcztSigner,
  type ZalletRpcClient,
} from "../src/rpc/zallet.js";
import { ZCASH_NETWORKS } from "../src/constants.js";
import { paymentMemo } from "../src/utils.js";
import { requirements, TRANSACTION_ID } from "./helpers.js";

describe("ZalletPcztSigner", () => {
  it("drives the create/prove/sign/extract RPC pipeline without broadcasting", async () => {
    const rpc = {
      pcztCreate: vi
        .fn()
        .mockResolvedValue({ pczt: "created", privacy_policy: "FullPrivacy" }),
      pcztProve: vi.fn().mockResolvedValue({ pczt: "proved" }),
      pcztSign: vi.fn().mockResolvedValue({ pczt: "signed" }),
      pcztExtract: vi.fn().mockResolvedValue({
        hex: "deadbeef",
        txid: TRANSACTION_ID,
        stored: true,
      }),
    } as unknown as ZalletRpcClient;
    const signer = new ZalletPcztSigner({ rpc, from: "account-uuid" });
    const result = await signer.createTransaction({
      network: ZCASH_NETWORKS.regtest,
      payTo: "uregtest1shieldedrecipient",
      amount: "1000",
      paymentId: "payment_1234567890",
      memo: "x402:payment_1234567890",
      requirements: requirements(),
    });

    expect(rpc.pcztCreate).toHaveBeenCalledWith(
      "account-uuid",
      [
        {
          address: "uregtest1shieldedrecipient",
          amount: "0.00001",
          memo: Buffer.from("x402:payment_1234567890").toString("hex"),
        },
      ],
      undefined,
      undefined,
      undefined,
    );
    expect(rpc.pcztProve).toHaveBeenCalledWith("created");
    expect(rpc.pcztSign).toHaveBeenCalledWith("proved", "FullPrivacy", true);
    expect(rpc.pcztExtract).toHaveBeenCalledWith("signed");
    expect(result).toEqual({
      transaction: Buffer.from("deadbeef", "hex").toString("base64"),
      transactionId: TRANSACTION_ID,
    });
  });
});

describe("ZalletPaymentObserver", () => {
  it("verifies shielded account ownership, amount, memo, and confirmations", async () => {
    const rpc = {
      viewTransaction: vi.fn().mockResolvedValue({
        txid: TRANSACTION_ID,
        status: "mined",
        confirmations: 2,
        outputs: [
          {
            pool: "orchard",
            account_uuid: "merchant-account",
            outgoing: false,
            walletInternal: false,
            valueZat: 1000,
            memoStr: paymentMemo("payment_1234567890"),
          },
        ],
      }),
    } as unknown as ZalletRpcClient;
    const observer = new ZalletPaymentObserver({
      rpc,
      accountUuid: "merchant-account",
    });

    await expect(
      observer.observe({
        transactionId: TRANSACTION_ID,
        payTo: "uregtest1merchant",
        amount: "1000",
        paymentId: "payment_1234567890",
        minConfirmations: 1,
      }),
    ).resolves.toEqual({ status: "valid", confirmations: 2 });
  });

  it("rejects a payment with the wrong request-binding memo", async () => {
    const rpc = {
      viewTransaction: vi.fn().mockResolvedValue({
        txid: TRANSACTION_ID,
        status: "mined",
        confirmations: 1,
        outputs: [
          {
            pool: "sapling",
            account_uuid: "merchant-account",
            outgoing: false,
            walletInternal: false,
            valueZat: 1000,
            memoStr: "x402:another_payment_id",
          },
        ],
      }),
    } as unknown as ZalletRpcClient;
    const observer = new ZalletPaymentObserver({
      rpc,
      accountUuid: "merchant-account",
    });
    const observation = await observer.observe({
      transactionId: TRANSACTION_ID,
      payTo: "uregtest1merchant",
      amount: "1000",
      paymentId: "payment_1234567890",
      minConfirmations: 0,
    });
    expect(observation).toEqual({
      status: "invalid",
      reason: "shielded_payment_output_mismatch",
    });
  });
});
