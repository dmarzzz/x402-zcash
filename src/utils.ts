import { createHash, randomBytes } from "node:crypto";
import type { PaymentRequirements } from "@x402/core/types";
import {
  MAX_ZCASH_TRANSACTION_BYTES,
  MAX_ZEC_ZATOSHIS,
  X402_ZCASH_MEMO_PREFIX,
  ZATOSHIS_PER_ZEC,
} from "./constants.js";
import type { ZcashPaymentPayload } from "./types.js";

const TRANSACTION_ID_PATTERN = /^[0-9a-f]{64}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const PAYMENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function assertZatoshiAmount(amount: string): bigint {
  if (!POSITIVE_INTEGER_PATTERN.test(amount)) {
    throw new Error("ZEC amount must be a positive integer string in zatoshis");
  }
  const parsed = BigInt(amount);
  if (parsed > MAX_ZEC_ZATOSHIS) {
    throw new Error("ZEC amount exceeds the maximum monetary supply");
  }
  return parsed;
}

export function decimalZecToZatoshis(amount: string): string {
  const match = amount.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid ZEC amount: ${amount}`);
  }
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > 8) {
    throw new Error("ZEC amounts support at most 8 decimal places");
  }
  const zatoshis =
    BigInt(whole) * ZATOSHIS_PER_ZEC + BigInt(fraction.padEnd(8, "0") || "0");
  assertZatoshiAmount(zatoshis.toString());
  return zatoshis.toString();
}

export function zatoshisToDecimalZec(amount: string): string {
  const value = assertZatoshiAmount(amount);
  const whole = value / ZATOSHIS_PER_ZEC;
  const fraction = (value % ZATOSHIS_PER_ZEC)
    .toString()
    .padStart(8, "0")
    .replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

export function isTransparentZcashAddress(address: string): boolean {
  return /^(?:t1|t3|tm|t2)[1-9A-HJ-NP-Za-km-z]{20,}$/.test(address);
}

export function createPaymentId(): string {
  return randomBytes(24).toString("base64url");
}

export function assertPaymentId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !PAYMENT_ID_PATTERN.test(value)) {
    throw new Error("Zcash exact payments require a valid extra.paymentId");
  }
}

export function paymentMemo(paymentId: string): string {
  assertPaymentId(paymentId);
  return `${X402_ZCASH_MEMO_PREFIX}${paymentId}`;
}

export function paymentMemoHex(paymentId: string): string {
  return Buffer.from(paymentMemo(paymentId), "utf8").toString("hex");
}

export function hexToBase64(hex: string): string {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("Transaction must be a non-empty, even-length hex string");
  }
  return Buffer.from(hex, "hex").toString("base64");
}

export function base64TransactionToHex(
  transaction: string,
  maxBytes = MAX_ZCASH_TRANSACTION_BYTES,
): string {
  if (typeof transaction !== "string" || transaction.length === 0) {
    throw new Error("Payment payload is missing the base64 transaction");
  }
  const bytes = Buffer.from(transaction, "base64");
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw new Error(`Transaction must contain between 1 and ${maxBytes} bytes`);
  }
  if (bytes.toString("base64") !== transaction) {
    throw new Error("Payment transaction is not canonical base64");
  }
  return bytes.toString("hex");
}

export function getZcashPayload(
  payload: Record<string, unknown>,
): ZcashPaymentPayload {
  const transaction = payload.transaction;
  const transactionId = payload.transactionId;
  const payer = payload.payer;
  if (typeof transaction !== "string") {
    throw new Error("Payment payload is missing transaction");
  }
  if (
    typeof transactionId !== "string" ||
    !TRANSACTION_ID_PATTERN.test(transactionId)
  ) {
    throw new Error("Payment payload has an invalid transactionId");
  }
  if (
    payer !== undefined &&
    (typeof payer !== "string" || payer.length > 256)
  ) {
    throw new Error("Payment payload has an invalid payer identifier");
  }
  return payer === undefined
    ? { transaction, transactionId }
    : { transaction, transactionId, payer };
}

export function paymentFingerprint(requirements: PaymentRequirements): string {
  const value = JSON.stringify({
    scheme: requirements.scheme,
    network: requirements.network,
    asset: requirements.asset,
    amount: requirements.amount,
    payTo: requirements.payTo,
    paymentId: requirements.extra.paymentId,
  });
  return createHash("sha256").update(value).digest("hex");
}

export function lowerCaseTransactionId(value: string): string {
  const normalized = value.toLowerCase();
  if (!TRANSACTION_ID_PATTERN.test(normalized)) {
    throw new Error("Invalid Zcash transaction ID");
  }
  return normalized;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
