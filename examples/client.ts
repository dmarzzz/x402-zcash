import { x402Client } from "@x402/core/client";
import { registerExactZcashScheme } from "../src/exact/client/register.js";
import { ZCASH_NETWORKS } from "../src/constants.js";
import { ZalletPcztSigner, ZalletRpcClient } from "../src/rpc/zallet.js";

const wallet = new ZalletRpcClient({
  url: process.env.ZALLET_RPC_URL ?? "http://127.0.0.1:28232",
  username: process.env.ZALLET_RPC_USER,
  password: process.env.ZALLET_RPC_PASSWORD,
});

const client = new x402Client();
registerExactZcashScheme(client, {
  signer: new ZalletPcztSigner({
    rpc: wallet,
    from: process.env.ZALLET_ACCOUNT_UUID ?? "replace-with-account-uuid",
    fundSource: "orchard",
    privacyPolicy: "FullPrivacy",
  }),
  networks: [ZCASH_NETWORKS.regtest],
  spendControls: {
    maxAmountPerPayment: false,
    allowedAssets: [
      {
        network: ZCASH_NETWORKS.regtest,
        asset: "ZEC",
        maxAmountPerPayment: "100000",
      },
    ],
  },
});

export { client };
