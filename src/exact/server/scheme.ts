import type {
  AssetAmount,
  MoneyParser,
  Network,
  PaymentFlowConfig,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
  SupportedKind,
} from "@x402/core/types";
import { numberToDecimalString, parseMoney } from "@x402/core/utils";
import {
  isZcashNetwork,
  X402_ZCASH_ASSET_TRANSFER_METHOD,
  X402_ZCASH_PAYMENT_FLOW,
  X402_ZCASH_SCHEME,
  ZEC_ASSET,
  ZEC_DECIMALS,
} from "../../constants.js";
import {
  assertPaymentId,
  assertZatoshiAmount,
  createPaymentId,
  decimalZecToZatoshis,
} from "../../utils.js";

export class ExactZcashScheme implements SchemeNetworkServer {
  readonly scheme = X402_ZCASH_SCHEME;
  readonly defaultAssetTransferMethod = X402_ZCASH_ASSET_TRANSFER_METHOD;
  readonly paymentFlows = {
    [X402_ZCASH_ASSET_TRANSFER_METHOD]: {
      supported: [X402_ZCASH_PAYMENT_FLOW],
      default: X402_ZCASH_PAYMENT_FLOW,
    },
  } as const satisfies Record<string, PaymentFlowConfig>;
  readonly dynamicExtraFields = ["paymentId"];
  private readonly moneyParsers: MoneyParser[] = [];

  registerMoneyParser(parser: MoneyParser): ExactZcashScheme {
    this.moneyParsers.push(parser);
    return this;
  }

  getAssetDecimals(asset: string, _network: Network): number | undefined {
    return asset === ZEC_ASSET ? ZEC_DECIMALS : undefined;
  }

  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    if (!isZcashNetwork(network)) {
      throw new Error(`Unsupported Zcash network: ${network}`);
    }
    if (typeof price === "object" && price !== null) {
      if (price.asset !== ZEC_ASSET) {
        throw new Error(`Zcash exact payments require asset ${ZEC_ASSET}`);
      }
      assertZatoshiAmount(price.amount);
      return {
        amount: price.amount,
        asset: price.asset,
        extra: price.extra ?? {},
      };
    }

    if (typeof price === "string" && price.trim().startsWith("$")) {
      throw new Error(
        "USD prices need an explicit ZEC money parser or an atomic AssetAmount",
      );
    }
    const parsed = await this.parseWithCustomMoneyParsers(price, network);
    if (parsed) {
      return parsed;
    }

    const { amount, symbol } = parseMoney(price);
    if (symbol !== undefined && symbol !== ZEC_ASSET) {
      throw new Error(`Unsupported price symbol: ${symbol}`);
    }
    return {
      amount: decimalZecToZatoshis(amount),
      asset: ZEC_ASSET,
      extra: {},
    };
  }

  enhancePaymentRequirements(
    requirements: PaymentRequirements,
    supportedKind: SupportedKind,
    _facilitatorExtensions: string[],
  ): Promise<PaymentRequirements> {
    if (!isZcashNetwork(requirements.network)) {
      throw new Error(`Unsupported Zcash network: ${requirements.network}`);
    }
    if (requirements.asset !== ZEC_ASSET) {
      throw new Error(`Unsupported Zcash asset: ${requirements.asset}`);
    }
    assertZatoshiAmount(requirements.amount);
    if (supportedKind.extra?.areFeesSponsored !== false) {
      throw new Error(
        "Zcash facilitator must advertise areFeesSponsored=false",
      );
    }
    return Promise.resolve({
      ...requirements,
      extra: {
        ...requirements.extra,
        areFeesSponsored: false,
      },
    });
  }

  validateFacilitatorSupport(
    _network: Network,
    supportedKind: SupportedKind,
    _facilitatorExtensions: string[],
  ): string | undefined {
    return supportedKind.extra?.areFeesSponsored === false
      ? undefined
      : "Zcash facilitator did not advertise areFeesSponsored=false";
  }

  enrichPaymentRequiredResponse = async ({
    requirements,
    paymentPayload,
  }: Parameters<
    NonNullable<SchemeNetworkServer["enrichPaymentRequiredResponse"]>
  >[0]) => {
    const echoedPaymentId = paymentPayload?.accepted.extra.paymentId;
    if (echoedPaymentId !== undefined) {
      assertPaymentId(echoedPaymentId);
    }
    const paymentId = echoedPaymentId ?? createPaymentId();
    return requirements.map((requirement) =>
      requirement.scheme === this.scheme && isZcashNetwork(requirement.network)
        ? { ...requirement, extra: { ...requirement.extra, paymentId } }
        : requirement,
    );
  };

  private async parseWithCustomMoneyParsers(
    price: string | number,
    network: Network,
  ): Promise<AssetAmount | undefined> {
    const decimal =
      typeof price === "number"
        ? numberToDecimalString(price)
        : parseMoney(price).amount;
    for (const parser of this.moneyParsers) {
      const result = await parser(decimal, network);
      if (result) {
        if (result.asset !== ZEC_ASSET) {
          throw new Error(
            `Zcash money parser returned unsupported asset: ${result.asset}`,
          );
        }
        assertZatoshiAmount(result.amount);
        return result;
      }
    }
    return undefined;
  }
}
