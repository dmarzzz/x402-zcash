import type { Network } from "@x402/core/types";

export const ZEC_ASSET = "ZEC";
export const ZEC_DECIMALS = 8;
export const ZATOSHIS_PER_ZEC = 100_000_000n;
export const MAX_ZEC_ZATOSHIS = 2_100_000_000_000_000n;
export const X402_ZCASH_SCHEME = "exact";
export const X402_ZCASH_ASSET_TRANSFER_METHOD = "zcash-pczt";
export const X402_ZCASH_PAYMENT_FLOW = "upfront";
export const X402_ZCASH_CAIP_FAMILY = "bip122:*";
export const X402_ZCASH_MEMO_PREFIX = "x402:";
export const MAX_ZCASH_TRANSACTION_BYTES = 2_000_000;

/** CAIP-2 identifiers: the first 16 bytes of each Zcash genesis block hash. */
export const ZCASH_NETWORKS = {
  mainnet: "bip122:00040fe8ec8471911baa1db1266ea15d",
  testnet: "bip122:05a60a92d99d85997cce3b87616c089f",
  regtest: "bip122:029f11d80ef9765602235e1bc9727e3e",
} as const satisfies Record<string, Network>;

export type ZcashNetworkName = keyof typeof ZCASH_NETWORKS;
export type ZcashNetwork = (typeof ZCASH_NETWORKS)[ZcashNetworkName];

export const ZCASH_GENESIS_HASHES: Record<ZcashNetwork, string> = {
  [ZCASH_NETWORKS.mainnet]:
    "00040fe8ec8471911baa1db1266ea15dd06b4a8a5c453883c000b031973dce08",
  [ZCASH_NETWORKS.testnet]:
    "05a60a92d99d85997cce3b87616c089f6124d7342af37106edc76126334a2c38",
  [ZCASH_NETWORKS.regtest]:
    "029f11d80ef9765602235e1bc9727e3eb6ba20839319f761fee920d63401e327",
};

export function isZcashNetwork(network: string): network is ZcashNetwork {
  return Object.values(ZCASH_NETWORKS).includes(network as ZcashNetwork);
}

export function getZcashNetworkName(network: ZcashNetwork): ZcashNetworkName {
  const entry = Object.entries(ZCASH_NETWORKS).find(
    ([, value]) => value === network,
  );
  if (!entry) {
    throw new Error(`Unsupported Zcash network: ${network}`);
  }
  return entry[0] as ZcashNetworkName;
}
