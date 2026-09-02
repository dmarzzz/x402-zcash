import type { PaymentRequirements } from "@x402/core/types";
import type { ZcashNetwork } from "./constants.js";

export interface SignedZcashTransaction {
  /** Base64-encoded consensus transaction bytes. */
  transaction: string;
  /** Canonical display-order transaction ID. */
  transactionId: string;
  /** Optional public or wallet-local payer identifier for settlement receipts. */
  payer?: string;
}

export interface ZcashTransactionRequest {
  network: ZcashNetwork;
  payTo: string;
  amount: string;
  paymentId: string;
  memo?: string;
  requirements: PaymentRequirements;
}

/** Wallet boundary used by the x402 client scheme. Private keys never enter this package. */
export interface ZcashTransactionSigner {
  createTransaction(
    request: ZcashTransactionRequest,
  ): Promise<SignedZcashTransaction>;
}

export interface ZcashPaymentObservationRequest {
  transactionId: string;
  payTo: string;
  amount: string;
  paymentId: string;
  minConfirmations: number;
}

export type ZcashPaymentObservation =
  | { status: "pending" }
  | { status: "valid"; confirmations: number; payer?: string }
  | { status: "invalid"; reason: string };

/** Merchant-side shielded payment observer, normally backed by a watch-only Zallet. */
export interface ZcashPaymentObserver {
  observe(
    request: ZcashPaymentObservationRequest,
  ): Promise<ZcashPaymentObservation>;
}

export interface ZcashPaymentPayload {
  transaction: string;
  transactionId: string;
  payer?: string;
}

export interface ZakuraTransparentOutput {
  value: number;
  valueZat?: number;
  valueSat?: number;
  n: number;
  scriptPubKey: {
    addresses?: string[];
    [key: string]: unknown;
  };
}

export interface ZakuraRawTransaction {
  txid: string;
  hex: string;
  confirmations?: number;
  height?: number;
  vout: ZakuraTransparentOutput[];
  [key: string]: unknown;
}

export interface ZalletViewedOutput {
  pool: "transparent" | "sapling" | "orchard" | "ironwood" | string;
  account_uuid?: string;
  address?: string;
  outgoing?: boolean;
  walletInternal: boolean;
  valueZat: number;
  memo?: string;
  memoStr?: string;
  [key: string]: unknown;
}

export interface ZalletViewedTransaction {
  txid: string;
  status: "mined" | "waiting" | "expiringsoon" | "expired" | string;
  confirmations: number;
  outputs: ZalletViewedOutput[];
  [key: string]: unknown;
}
