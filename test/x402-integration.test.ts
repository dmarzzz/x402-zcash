import { x402Client, x402HTTPClient } from "@x402/core/client";
import { x402Facilitator } from "@x402/core/facilitator";
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import {
  type FacilitatorClient,
  type HTTPAdapter,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@x402/core/server";
import { describe, expect, it, vi } from "vitest";
import { ZCASH_NETWORKS } from "../src/constants.js";
import { ExactZcashScheme as ExactZcashClientScheme } from "../src/exact/client/scheme.js";
import { ExactZcashFacilitator } from "../src/exact/facilitator/scheme.js";
import { ExactZcashScheme as ExactZcashServerScheme } from "../src/exact/server/scheme.js";
import type { ZakuraClient } from "../src/rpc/zakura.js";
import { PAY_TO, TRANSACTION_ID } from "./helpers.js";

class LocalFacilitatorClient implements FacilitatorClient {
  verifyCalls = 0;
  settleCalls = 0;

  constructor(private readonly facilitator: x402Facilitator) {}

  getSupported(): Promise<SupportedResponse> {
    return Promise.resolve(
      this.facilitator.getSupported() as SupportedResponse,
    );
  }

  verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    this.verifyCalls += 1;
    return this.facilitator.verify(payload, requirements);
  }

  settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    this.settleCalls += 1;
    return this.facilitator.settle(payload, requirements);
  }
}

function adapter(paymentSignature?: string): HTTPAdapter {
  return {
    getHeader: (name) =>
      name.toUpperCase() === "PAYMENT-SIGNATURE" ? paymentSignature : undefined,
    getMethod: () => "GET",
    getPath: () => "/private",
    getUrl: () => "https://example.test/private",
    getAcceptHeader: () => "application/json",
    getUserAgent: () => "x402-zcash-test",
  };
}

describe("@x402/core integration", () => {
  it("settles before the resource handler and does not call verify", async () => {
    let visible = false;
    const zakura: ZakuraClient = {
      sendRawTransaction: vi.fn(async () => {
        visible = true;
        return TRANSACTION_ID;
      }),
      getRawTransaction: vi.fn(async () =>
        visible
          ? {
              txid: TRANSACTION_ID,
              hex: "deadbeef",
              vout: [
                {
                  value: 0.00001,
                  valueZat: 1000,
                  n: 0,
                  scriptPubKey: { addresses: [PAY_TO] },
                },
              ],
            }
          : undefined,
      ),
      getBlockHash: vi.fn(),
    };

    const facilitator = new x402Facilitator().register(
      ZCASH_NETWORKS.regtest,
      new ExactZcashFacilitator({
        network: ZCASH_NETWORKS.regtest,
        zakura,
        pollIntervalMs: 10,
      }),
    );
    const facilitatorClient = new LocalFacilitatorClient(facilitator);
    const resourceServer = new x402ResourceServer(facilitatorClient).register(
      ZCASH_NETWORKS.regtest,
      new ExactZcashServerScheme(),
    );
    await resourceServer.initialize();

    const httpServer = new x402HTTPResourceServer(resourceServer, {
      "/private": {
        accepts: {
          scheme: "exact",
          network: ZCASH_NETWORKS.regtest as Network,
          payTo: PAY_TO,
          price: { amount: "1000", asset: "ZEC" },
          maxTimeoutSeconds: 1,
          extra: { minConfirmations: 0 },
        },
        description: "Private test data",
      },
    });

    const unpaid = await httpServer.processHTTPRequest({
      adapter: adapter(),
      path: "/private",
      method: "GET",
    });
    expect(unpaid.type).toBe("payment-error");
    if (unpaid.type !== "payment-error") return;

    const paymentClient = new x402Client().register(
      ZCASH_NETWORKS.regtest,
      new ExactZcashClientScheme({
        createTransaction: vi.fn(async (request) => {
          expect(request.paymentId).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
          return {
            transaction: Buffer.from("deadbeef", "hex").toString("base64"),
            transactionId: TRANSACTION_ID,
          };
        }),
      }),
    );
    paymentClient.setSpendControls({
      maxAmountPerPayment: false,
      allowedAssets: [
        {
          network: ZCASH_NETWORKS.regtest,
          asset: "ZEC",
          maxAmountPerPayment: "100000",
        },
      ],
    });
    const httpClient = new x402HTTPClient(paymentClient);
    const paymentRequired = httpClient.getPaymentRequiredResponse(
      (name) => unpaid.response.headers[name],
      unpaid.response.body,
    );
    expect(paymentRequired.accepts[0]?.extra.paymentFlow).toBe("upfront");
    expect(paymentRequired.accepts[0]?.extra.paymentId).toMatch(
      /^[A-Za-z0-9_-]{16,128}$/,
    );

    const paymentPayload =
      await httpClient.createPaymentPayload(paymentRequired);
    const headers =
      await httpClient.encodePaymentSignatureHeader(paymentPayload);
    const paid = await httpServer.processHTTPRequest({
      adapter: adapter(headers["PAYMENT-SIGNATURE"]),
      path: "/private",
      method: "GET",
    });

    expect(paid.type, JSON.stringify(paid, null, 2)).toBe("payment-verified");
    if (paid.type !== "payment-verified") return;
    expect(paid.beforeHandlerSettlement?.flow).toBe("upfront");
    expect(paid.beforeHandlerSettlement?.result.success).toBe(true);
    expect(facilitatorClient.verifyCalls).toBe(0);
    expect(facilitatorClient.settleCalls).toBe(1);

    const completed = await httpServer.processSettlement(
      paid.paymentPayload,
      paid.paymentRequirements,
      paid.declaredExtensions,
      undefined,
      undefined,
      paid.beforeHandlerSettlement,
    );
    expect(completed.success).toBe(true);
    expect(facilitatorClient.settleCalls).toBe(1);
  });
});
