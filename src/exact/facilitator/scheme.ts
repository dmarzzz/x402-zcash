import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import {
  MAX_ZCASH_TRANSACTION_BYTES,
  type ZcashNetwork,
  X402_ZCASH_ASSET_TRANSFER_METHOD,
  X402_ZCASH_CAIP_FAMILY,
  X402_ZCASH_PAYMENT_FLOW,
  X402_ZCASH_SCHEME,
  ZEC_ASSET,
} from "../../constants.js";
import {
  InMemorySettlementStore,
  type SettlementStore,
} from "../../settlement-store.js";
import type { ZakuraClient } from "../../rpc/zakura.js";
import type {
  ZcashPaymentObservation,
  ZcashPaymentObserver,
} from "../../types.js";
import {
  assertPaymentId,
  assertZatoshiAmount,
  base64TransactionToHex,
  errorMessage,
  getZcashPayload,
  isTransparentZcashAddress,
  lowerCaseTransactionId,
  paymentFingerprint,
  wait,
} from "../../utils.js";

export interface ExactZcashFacilitatorOptions {
  network: ZcashNetwork;
  zakura: ZakuraClient;
  /** Required when accepting shielded or Unified Address recipients. */
  observer?: ZcashPaymentObserver;
  store?: SettlementStore;
  minConfirmations?: number;
  pollIntervalMs?: number;
  maxTransactionBytes?: number;
  /** Disabled by default to prevent a public transaction ID from being claimed by another client. */
  allowPreBroadcastTransactions?: boolean;
}

/** Facilitator that broadcasts payer-signed transactions through Zakura and verifies receipt. */
export class ExactZcashFacilitator implements SchemeNetworkFacilitator {
  readonly caipFamily = X402_ZCASH_CAIP_FAMILY;
  readonly scheme = X402_ZCASH_SCHEME;

  private readonly store: SettlementStore;
  private readonly inFlight = new Map<string, Promise<SettleResponse>>();
  private readonly minConfirmations: number;
  private readonly pollIntervalMs: number;
  private readonly maxTransactionBytes: number;

  constructor(private readonly options: ExactZcashFacilitatorOptions) {
    this.store = options.store ?? new InMemorySettlementStore();
    this.minConfirmations = options.minConfirmations ?? 0;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.maxTransactionBytes =
      options.maxTransactionBytes ?? MAX_ZCASH_TRANSACTION_BYTES;
    assertNonNegativeInteger(this.minConfirmations, "minConfirmations");
    if (!Number.isInteger(this.pollIntervalMs) || this.pollIntervalMs < 10) {
      throw new Error(
        "pollIntervalMs must be an integer of at least 10 milliseconds",
      );
    }
    if (
      !Number.isInteger(this.maxTransactionBytes) ||
      this.maxTransactionBytes <= 0
    ) {
      throw new Error("maxTransactionBytes must be a positive integer");
    }
  }

  getExtra(_network: Network): Record<string, unknown> {
    return { areFeesSponsored: false };
  }

  getSigners(_network: string): string[] {
    return [];
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    try {
      const payer = this.validateEnvelope(payload, requirements);
      getZcashPayload(payload.payload);
      return {
        isValid: false,
        invalidReason: "invalid_exact_zcash_upfront_requires_settle",
        invalidMessage:
          "Zcash PCZT payments use upfront settlement; call /settle instead of /verify",
        ...(payer === undefined ? {} : { payer }),
      };
    } catch (error) {
      return {
        isValid: false,
        invalidReason: "invalid_exact_zcash_payload",
        invalidMessage: errorMessage(error),
      };
    }
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    let transactionId = "";
    let payer: string | undefined;
    try {
      payer = this.validateEnvelope(payload, requirements);
      const exactPayload = getZcashPayload(payload.payload);
      const paymentId = payload.accepted.extra.paymentId;
      assertPaymentId(paymentId);
      const effectiveRequirements = withPaymentId(requirements, paymentId);
      transactionId = exactPayload.transactionId;
      payer = exactPayload.payer ?? payer;
      const transactionHex = base64TransactionToHex(
        exactPayload.transaction,
        this.maxTransactionBytes,
      );
      const fingerprint = paymentFingerprint(effectiveRequirements);
      const claim = await this.store.claim(transactionId, fingerprint);

      if (claim.status === "conflict") {
        return this.failure(
          effectiveRequirements,
          transactionId,
          payer,
          "duplicate_settlement",
          "The transaction ID was already claimed by different payment requirements",
        );
      }
      if (claim.status === "duplicate" && claim.record.state !== "pending") {
        return (
          claim.record.response ??
          this.failure(
            effectiveRequirements,
            transactionId,
            payer,
            "duplicate_settlement",
          )
        );
      }

      const existingFlight = this.inFlight.get(transactionId);
      if (existingFlight) {
        return existingFlight;
      }

      const settlement = this.executeSettlement({
        payload,
        requirements: effectiveRequirements,
        transactionHex,
        transactionId,
        payer,
        retry: claim.status === "duplicate",
      });
      this.inFlight.set(transactionId, settlement);
      try {
        return await settlement;
      } finally {
        this.inFlight.delete(transactionId);
      }
    } catch (error) {
      const response = this.failure(
        requirements,
        transactionId,
        payer,
        "invalid_exact_zcash_payload",
        errorMessage(error),
      );
      if (transactionId) {
        await this.store
          .save(transactionId, "failed", response)
          .catch(() => undefined);
      }
      return response;
    }
  }

  private async executeSettlement(input: {
    payload: PaymentPayload;
    requirements: PaymentRequirements;
    transactionHex: string;
    transactionId: string;
    payer: string | undefined;
    retry: boolean;
  }): Promise<SettleResponse> {
    const { requirements, transactionHex, transactionId, payer, retry } = input;
    try {
      const alreadyVisible =
        await this.options.zakura.getRawTransaction(transactionId);
      if (
        alreadyVisible &&
        !retry &&
        this.options.allowPreBroadcastTransactions !== true
      ) {
        const response = this.failure(
          requirements,
          transactionId,
          payer,
          "transaction_already_broadcast",
          "Pre-broadcast transactions are disabled because public transaction IDs can be front-run",
        );
        await this.store.save(transactionId, "failed", response);
        return response;
      }

      if (!alreadyVisible) {
        const broadcastId =
          await this.options.zakura.sendRawTransaction(transactionHex);
        if (broadcastId !== transactionId) {
          const response = this.failure(
            requirements,
            broadcastId,
            payer,
            "invalid_exact_zcash_transaction_id_mismatch",
          );
          await this.store.save(transactionId, "failed", response);
          return response;
        }
      }

      const observation = await this.waitForPayment(
        requirements,
        transactionId,
      );
      if (observation.status === "valid") {
        const response: SettleResponse = {
          success: true,
          transaction: transactionId,
          network: requirements.network,
          amount: requirements.amount,
          ...((payer ?? observation.payer)
            ? { payer: payer ?? observation.payer }
            : {}),
          extra: { confirmations: observation.confirmations },
        };
        await this.store.save(transactionId, "succeeded", response);
        return response;
      }
      if (observation.status === "invalid") {
        const response = this.failure(
          requirements,
          transactionId,
          payer,
          observation.reason,
        );
        await this.store.save(transactionId, "failed", response);
        return response;
      }

      const response = this.failure(
        requirements,
        transactionId,
        payer,
        "settlement_pending",
        "The transaction was broadcast but could not be confirmed before the payment timeout",
      );
      await this.store.save(transactionId, "pending", response);
      return response;
    } catch (error) {
      const visible = await this.options.zakura
        .getRawTransaction(transactionId)
        .catch(() => undefined);
      const reason = visible
        ? "settlement_pending"
        : "transaction_submission_failed";
      const response = this.failure(
        requirements,
        visible ? transactionId : "",
        payer,
        reason,
        errorMessage(error),
      );
      await this.store.save(
        transactionId,
        visible ? "pending" : "failed",
        response,
      );
      return response;
    }
  }

  private async waitForPayment(
    requirements: PaymentRequirements,
    transactionId: string,
  ): Promise<ZcashPaymentObservation> {
    const paymentId = requirements.extra.paymentId;
    assertPaymentId(paymentId);
    const minConfirmations = readMinConfirmations(
      requirements,
      this.minConfirmations,
    );
    const deadline = Date.now() + requirements.maxTimeoutSeconds * 1_000;

    while (true) {
      const observation = isTransparentZcashAddress(requirements.payTo)
        ? await this.observeTransparentPayment(
            requirements,
            transactionId,
            minConfirmations,
          )
        : await this.observeShieldedPayment(
            requirements,
            transactionId,
            paymentId,
            minConfirmations,
          );
      if (observation.status !== "pending") {
        return observation;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return { status: "pending" };
      }
      await wait(Math.min(this.pollIntervalMs, remaining));
    }
  }

  private async observeTransparentPayment(
    requirements: PaymentRequirements,
    transactionId: string,
    minConfirmations: number,
  ): Promise<ZcashPaymentObservation> {
    const transaction =
      await this.options.zakura.getRawTransaction(transactionId);
    if (!transaction) {
      return { status: "pending" };
    }
    if (lowerCaseTransactionId(transaction.txid) !== transactionId) {
      return {
        status: "invalid",
        reason: "invalid_exact_zcash_transaction_id_mismatch",
      };
    }

    let paid = 0n;
    for (const output of transaction.vout) {
      if (output.scriptPubKey.addresses?.includes(requirements.payTo)) {
        const atomic = output.valueZat ?? output.valueSat;
        if (
          !Number.isSafeInteger(atomic) ||
          atomic === undefined ||
          atomic < 0
        ) {
          return {
            status: "invalid",
            reason: "invalid_exact_zcash_output_amount",
          };
        }
        paid += BigInt(atomic);
      }
    }
    if (paid.toString() !== requirements.amount) {
      return {
        status: "invalid",
        reason: "invalid_exact_zcash_amount_mismatch",
      };
    }
    const confirmations = transaction.confirmations ?? 0;
    return confirmations < minConfirmations
      ? { status: "pending" }
      : { status: "valid", confirmations };
  }

  private async observeShieldedPayment(
    requirements: PaymentRequirements,
    transactionId: string,
    paymentId: string,
    minConfirmations: number,
  ): Promise<ZcashPaymentObservation> {
    if (!this.options.observer) {
      return {
        status: "invalid",
        reason: "shielded_payment_observer_not_configured",
      };
    }
    return this.options.observer.observe({
      transactionId,
      payTo: requirements.payTo,
      amount: requirements.amount,
      paymentId,
      minConfirmations,
    });
  }

  private validateEnvelope(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): string | undefined {
    if (payload.x402Version !== 2) {
      throw new Error("Unsupported x402 version");
    }
    if (
      payload.accepted.scheme !== this.scheme ||
      requirements.scheme !== this.scheme
    ) {
      throw new Error("Unsupported payment scheme");
    }
    if (
      requirements.network !== this.options.network ||
      payload.accepted.network !== requirements.network
    ) {
      throw new Error("Zcash network mismatch");
    }
    for (const field of [
      "asset",
      "amount",
      "payTo",
      "maxTimeoutSeconds",
    ] as const) {
      if (payload.accepted[field] !== requirements[field]) {
        throw new Error(`Zcash payment requirement mismatch: ${field}`);
      }
    }
    if (requirements.asset !== ZEC_ASSET) {
      throw new Error("Unsupported Zcash asset");
    }
    assertZatoshiAmount(requirements.amount);
    if (
      !Number.isInteger(requirements.maxTimeoutSeconds) ||
      requirements.maxTimeoutSeconds <= 0
    ) {
      throw new Error("maxTimeoutSeconds must be a positive integer");
    }
    const method = requirements.extra.assetTransferMethod;
    if (method !== undefined && method !== X402_ZCASH_ASSET_TRANSFER_METHOD) {
      throw new Error("Unsupported Zcash assetTransferMethod");
    }
    if (requirements.extra.paymentFlow !== X402_ZCASH_PAYMENT_FLOW) {
      throw new Error("Zcash PCZT requires upfront paymentFlow");
    }
    if (requirements.extra.areFeesSponsored !== false) {
      throw new Error("Zcash PCZT does not support sponsored fees");
    }
    if (
      payload.accepted.extra.areFeesSponsored !==
      requirements.extra.areFeesSponsored
    ) {
      throw new Error("Zcash fee-sponsorship metadata mismatch");
    }
    if (
      payload.accepted.extra.assetTransferMethod !==
      requirements.extra.assetTransferMethod
    ) {
      throw new Error("Zcash assetTransferMethod mismatch");
    }
    if (
      payload.accepted.extra.minConfirmations !==
      requirements.extra.minConfirmations
    ) {
      throw new Error("Zcash minConfirmations mismatch");
    }
    assertPaymentId(requirements.extra.paymentId);
    assertPaymentId(payload.accepted.extra.paymentId);
    if (payload.accepted.extra.paymentFlow !== requirements.extra.paymentFlow) {
      throw new Error("Zcash paymentFlow mismatch");
    }
    return typeof payload.payload.payer === "string"
      ? payload.payload.payer
      : undefined;
  }

  private failure(
    requirements: PaymentRequirements,
    transaction: string,
    payer: string | undefined,
    errorReason: string,
    errorMessageValue?: string,
  ): SettleResponse {
    return {
      success: false,
      transaction,
      network: requirements.network,
      errorReason,
      ...(errorMessageValue === undefined
        ? {}
        : { errorMessage: errorMessageValue }),
      ...(payer === undefined ? {} : { payer }),
    };
  }
}

function withPaymentId(
  requirements: PaymentRequirements,
  paymentId: string,
): PaymentRequirements {
  return {
    ...requirements,
    extra: { ...requirements.extra, paymentId },
  };
}

function readMinConfirmations(
  requirements: PaymentRequirements,
  fallback: number,
): number {
  const value = requirements.extra.minConfirmations ?? fallback;
  assertNonNegativeInteger(value, "extra.minConfirmations");
  return value;
}

function assertNonNegativeInteger(
  value: unknown,
  name: string,
): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
