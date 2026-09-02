import type {
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/core/types";
import {
  isZcashNetwork,
  type ZcashNetwork,
  X402_ZCASH_ASSET_TRANSFER_METHOD,
  X402_ZCASH_PAYMENT_FLOW,
  X402_ZCASH_SCHEME,
  ZEC_ASSET,
} from "../../constants.js";
import type { ZcashTransactionSigner } from "../../types.js";
import {
  assertPaymentId,
  assertZatoshiAmount,
  base64TransactionToHex,
  lowerCaseTransactionId,
  paymentMemo,
} from "../../utils.js";

/** x402 client mechanism that asks a wallet adapter for an unbroadcast Zcash transaction. */
export class ExactZcashScheme implements SchemeNetworkClient {
  readonly scheme = X402_ZCASH_SCHEME;

  constructor(private readonly signer: ZcashTransactionSigner) {}

  async createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements,
  ): Promise<PaymentPayloadResult> {
    this.validateRequirements(x402Version, requirements);
    const paymentId = requirements.extra.paymentId;
    assertPaymentId(paymentId);

    const signed = await this.signer.createTransaction({
      network: requirements.network as ZcashNetwork,
      payTo: requirements.payTo,
      amount: requirements.amount,
      paymentId,
      memo: paymentMemo(paymentId),
      requirements,
    });
    base64TransactionToHex(signed.transaction);
    const transactionId = lowerCaseTransactionId(signed.transactionId);

    return {
      x402Version,
      payload: {
        transaction: signed.transaction,
        transactionId,
        ...(signed.payer === undefined ? {} : { payer: signed.payer }),
      },
    };
  }

  private validateRequirements(
    x402Version: number,
    requirements: PaymentRequirements,
  ): void {
    if (x402Version !== 2) {
      throw new Error(`Unsupported x402 version: ${x402Version}`);
    }
    if (requirements.scheme !== this.scheme) {
      throw new Error(`Unsupported scheme: ${requirements.scheme}`);
    }
    if (!isZcashNetwork(requirements.network)) {
      throw new Error(`Unsupported Zcash network: ${requirements.network}`);
    }
    if (requirements.asset !== ZEC_ASSET) {
      throw new Error(`Unsupported Zcash asset: ${requirements.asset}`);
    }
    assertZatoshiAmount(requirements.amount);
    if (requirements.payTo.trim().length === 0) {
      throw new Error("Zcash exact payments require a payTo address");
    }
    if (
      !Number.isInteger(requirements.maxTimeoutSeconds) ||
      requirements.maxTimeoutSeconds <= 0
    ) {
      throw new Error(
        "Zcash exact payments require a positive integer maxTimeoutSeconds",
      );
    }
    const method = requirements.extra.assetTransferMethod;
    if (method !== undefined && method !== X402_ZCASH_ASSET_TRANSFER_METHOD) {
      throw new Error(
        `Unsupported Zcash assetTransferMethod: ${String(method)}`,
      );
    }
    if (requirements.extra.paymentFlow !== X402_ZCASH_PAYMENT_FLOW) {
      throw new Error(
        'Zcash exact payments require extra.paymentFlow="upfront"',
      );
    }
    if (requirements.extra.areFeesSponsored !== false) {
      throw new Error("Zcash exact payments require areFeesSponsored=false");
    }
    assertPaymentId(requirements.extra.paymentId);
  }
}
