import type {
  PaymentPolicy,
  SpendControls,
  x402Client,
} from "@x402/core/client";
import type { Network } from "@x402/core/types";
import { ZCASH_NETWORKS } from "../../constants.js";
import type { ZcashTransactionSigner } from "../../types.js";
import { ExactZcashScheme } from "./scheme.js";

export interface ZcashClientConfig {
  signer: ZcashTransactionSigner;
  networks?: Network[];
  policies?: PaymentPolicy[];
  /** Explicit ZEC spend controls. Core does not treat volatile ZEC as a default USD asset. */
  spendControls?: SpendControls | false;
}

export function registerExactZcashScheme(
  client: x402Client,
  config: ZcashClientConfig,
): x402Client {
  const networks = config.networks ?? Object.values(ZCASH_NETWORKS);
  for (const network of networks) {
    client.register(network, new ExactZcashScheme(config.signer));
  }
  for (const policy of config.policies ?? []) {
    client.registerPolicy(policy);
  }
  if (config.spendControls !== undefined) {
    client.setSpendControls(config.spendControls);
  }
  return client;
}
