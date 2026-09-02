import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ZCASH_NETWORKS } from "../src/constants.js";
import { registerExactZcashScheme } from "../src/exact/server/register.js";

const facilitator = new HTTPFacilitatorClient({
  url: process.env.FACILITATOR_URL ?? "http://127.0.0.1:4022",
});

const resourceServer = new x402ResourceServer(facilitator);
registerExactZcashScheme(resourceServer, {
  networks: [ZCASH_NETWORKS.regtest],
});

export const paidRoute = {
  accepts: {
    scheme: "exact" as const,
    network: ZCASH_NETWORKS.regtest,
    payTo: process.env.MERCHANT_ZCASH_ADDRESS ?? "replace-with-regtest-address",
    price: { amount: "1000", asset: "ZEC" },
    maxTimeoutSeconds: 120,
    extra: { paymentFlow: "upfront", minConfirmations: 0 },
  },
  description: "One protected response paid in ZEC",
};

export { resourceServer };
