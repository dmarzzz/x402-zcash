import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import {
  X402_ZCASH_ASSET_TRANSFER_METHOD,
  X402_ZCASH_PAYMENT_FLOW,
  ZCASH_NETWORKS,
  ZEC_ASSET,
} from "../src/constants.js";

export const TRANSACTION_ID = "ab".repeat(32);
export const PAY_TO = "tmYXBYJj1K7vhejSec5osXK2QsGa5MTisUQ";

export function requirements(
  overrides: Partial<PaymentRequirements> = {},
): PaymentRequirements {
  return {
    scheme: "exact",
    network: ZCASH_NETWORKS.regtest,
    asset: ZEC_ASSET,
    amount: "1000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 1,
    extra: {
      assetTransferMethod: X402_ZCASH_ASSET_TRANSFER_METHOD,
      paymentFlow: X402_ZCASH_PAYMENT_FLOW,
      areFeesSponsored: false,
      paymentId: "payment_1234567890",
      minConfirmations: 0,
    },
    ...overrides,
  };
}

export function payload(
  accepted: PaymentRequirements = requirements(),
  payloadOverrides: Record<string, unknown> = {},
): PaymentPayload {
  return {
    x402Version: 2,
    accepted,
    payload: {
      transaction: Buffer.from("deadbeef", "hex").toString("base64"),
      transactionId: TRANSACTION_ID,
      ...payloadOverrides,
    },
  };
}
