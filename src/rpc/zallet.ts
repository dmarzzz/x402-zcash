import type {
  ZcashTransactionSigner,
  ZcashTransactionRequest,
  ZalletViewedTransaction,
} from "../types.js";
import {
  assertZatoshiAmount,
  hexToBase64,
  isTransparentZcashAddress,
  lowerCaseTransactionId,
  paymentMemoHex,
  zatoshisToDecimalZec,
} from "../utils.js";
import type {
  ZcashPaymentObservation,
  ZcashPaymentObservationRequest,
  ZcashPaymentObserver,
} from "../types.js";
import { paymentMemo } from "../utils.js";
import {
  isTransactionNotFound,
  JsonRpcClient,
  type JsonRpcTransportOptions,
} from "./json-rpc.js";

export type ZalletPrivacyPolicy =
  | "FullPrivacy"
  | "AllowRevealedAmounts"
  | "AllowRevealedRecipients"
  | "AllowRevealedSenders"
  | "AllowFullyTransparent"
  | "AllowLinkingAccountAddresses"
  | "NoPrivacy";

export type ZalletFundSource =
  "orchard" | "sapling" | "any_transparent" | string[];

interface PcztCreateResult {
  pczt: string;
  privacy_policy: ZalletPrivacyPolicy;
}

interface PcztResult {
  pczt: string;
  [key: string]: unknown;
}

interface PcztExtractResult {
  hex: string;
  txid: string;
  stored: boolean;
}

export class ZalletRpcClient {
  readonly rpc: JsonRpcClient;

  constructor(options: JsonRpcTransportOptions | JsonRpcClient) {
    this.rpc =
      options instanceof JsonRpcClient ? options : new JsonRpcClient(options);
  }

  pcztCreate(
    from: string,
    amounts: Array<{ address: string; amount: string; memo?: string }>,
    minConfirmations?: number,
    privacyPolicy?: ZalletPrivacyPolicy,
    fundSource?: ZalletFundSource,
  ): Promise<PcztCreateResult> {
    return this.rpc.call("pczt_create", [
      from,
      amounts,
      minConfirmations,
      privacyPolicy,
      fundSource,
    ]);
  }

  pcztProve(pczt: string): Promise<PcztResult> {
    return this.rpc.call("pczt_prove", [pczt]);
  }

  pcztSign(
    pczt: string,
    privacyPolicy: ZalletPrivacyPolicy,
    strict = true,
  ): Promise<PcztResult> {
    return this.rpc.call("pczt_sign", [pczt, privacyPolicy, strict]);
  }

  pcztExtract(pczt: string): Promise<PcztExtractResult> {
    return this.rpc.call("pczt_extract", [pczt]);
  }

  async viewTransaction(
    transactionId: string,
  ): Promise<ZalletViewedTransaction | undefined> {
    try {
      return await this.rpc.call<ZalletViewedTransaction>("z_viewtransaction", [
        transactionId,
      ]);
    } catch (error) {
      if (isTransactionNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }
}

export interface ZalletPcztSignerOptions {
  rpc: ZalletRpcClient;
  /** Zallet account UUID or source address. */
  from: string;
  payerId?: string;
  minConfirmations?: number;
  privacyPolicy?: ZalletPrivacyPolicy;
  fundSource?: ZalletFundSource;
}

/** Creates, proves, signs, and extracts an unbroadcast transaction through Zallet. */
export class ZalletPcztSigner implements ZcashTransactionSigner {
  constructor(private readonly options: ZalletPcztSignerOptions) {}

  async createTransaction(request: ZcashTransactionRequest) {
    assertZatoshiAmount(request.amount);
    const transparent = isTransparentZcashAddress(request.payTo);
    const memo = transparent ? undefined : paymentMemoHex(request.paymentId);
    const recipient = {
      address: request.payTo,
      amount: zatoshisToDecimalZec(request.amount),
      ...(memo === undefined ? {} : { memo }),
    };

    const created = await this.options.rpc.pcztCreate(
      this.options.from,
      [recipient],
      this.options.minConfirmations,
      this.options.privacyPolicy,
      this.options.fundSource,
    );
    const proved = await this.options.rpc.pcztProve(created.pczt);
    const signed = await this.options.rpc.pcztSign(
      proved.pczt,
      created.privacy_policy,
      true,
    );
    const extracted = await this.options.rpc.pcztExtract(signed.pczt);

    return {
      transaction: hexToBase64(extracted.hex),
      transactionId: lowerCaseTransactionId(extracted.txid),
      ...(this.options.payerId === undefined
        ? {}
        : { payer: this.options.payerId }),
    };
  }
}

export interface ZalletPaymentObserverOptions {
  rpc: ZalletRpcClient;
  /** Merchant account that must own the received shielded note. */
  accountUuid: string;
  /** Optional allowlist that catches a resource configured with the wrong payTo address. */
  acceptedAddresses?: string[];
}

/** Verifies shielded recipient, amount, and request-binding memo in a watch-only Zallet. */
export class ZalletPaymentObserver implements ZcashPaymentObserver {
  private readonly acceptedAddresses: Set<string> | undefined;

  constructor(private readonly options: ZalletPaymentObserverOptions) {
    this.acceptedAddresses = options.acceptedAddresses
      ? new Set(options.acceptedAddresses)
      : undefined;
  }

  async observe(
    request: ZcashPaymentObservationRequest,
  ): Promise<ZcashPaymentObservation> {
    if (this.acceptedAddresses && !this.acceptedAddresses.has(request.payTo)) {
      return { status: "invalid", reason: "pay_to_not_watched" };
    }

    const viewed = await this.options.rpc.viewTransaction(
      request.transactionId,
    );
    if (!viewed) {
      return { status: "pending" };
    }
    if (viewed.status === "expired" || viewed.confirmations < 0) {
      return { status: "invalid", reason: "transaction_expired" };
    }

    const expectedMemo = paymentMemo(request.paymentId);
    const matchingOutputs = viewed.outputs.filter(
      (output) =>
        output.pool !== "transparent" &&
        output.account_uuid === this.options.accountUuid &&
        output.outgoing === false &&
        output.valueZat.toString() === request.amount &&
        output.memoStr === expectedMemo,
    );
    if (matchingOutputs.length !== 1) {
      return { status: "invalid", reason: "shielded_payment_output_mismatch" };
    }
    if (viewed.confirmations < request.minConfirmations) {
      return { status: "pending" };
    }
    return { status: "valid", confirmations: viewed.confirmations };
  }
}
