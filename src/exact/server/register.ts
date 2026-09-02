import type { x402ResourceServer } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ZCASH_NETWORKS } from "../../constants.js";
import { ExactZcashScheme } from "./scheme.js";

export interface ZcashResourceServerConfig {
  networks?: Network[];
  configure?: (scheme: ExactZcashScheme) => void;
}

export function registerExactZcashScheme(
  server: x402ResourceServer,
  config: ZcashResourceServerConfig = {},
): x402ResourceServer {
  const networks = config.networks ?? Object.values(ZCASH_NETWORKS);
  for (const network of networks) {
    const scheme = new ExactZcashScheme();
    config.configure?.(scheme);
    server.register(network, scheme);
  }
  return server;
}
