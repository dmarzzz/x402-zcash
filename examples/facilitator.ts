import { x402Facilitator } from "@x402/core/facilitator";
import { ZCASH_NETWORKS } from "../src/constants.js";
import { registerExactZcashScheme } from "../src/exact/facilitator/register.js";
import { ZakuraRpcClient } from "../src/rpc/zakura.js";
import { ZalletPaymentObserver, ZalletRpcClient } from "../src/rpc/zallet.js";

const zakura = new ZakuraRpcClient({
  url: process.env.ZAKURA_RPC_URL ?? "http://127.0.0.1:18232",
  username: process.env.ZAKURA_RPC_USER,
  password: process.env.ZAKURA_RPC_PASSWORD,
});

const observer = new ZalletPaymentObserver({
  rpc: new ZalletRpcClient({
    url: process.env.MERCHANT_ZALLET_RPC_URL ?? "http://127.0.0.1:28232",
    username: process.env.MERCHANT_ZALLET_RPC_USER,
    password: process.env.MERCHANT_ZALLET_RPC_PASSWORD,
  }),
  accountUuid:
    process.env.MERCHANT_ZALLET_ACCOUNT_UUID ?? "replace-with-account-uuid",
});

const facilitator = new x402Facilitator();
registerExactZcashScheme(facilitator, {
  network: ZCASH_NETWORKS.regtest,
  zakura,
  observer,
  minConfirmations: 0,
});

export { facilitator };
