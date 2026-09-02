# x402-zcash

ZEC payments for [x402 v2](https://github.com/x402-foundation/x402), packaged as ordinary `@x402/core` client, resource-server, and facilitator mechanisms.

This is an independent community integration, not an official Zakura or Zcash package. The client asks [Zallet](https://github.com/zcash/zallet) to build a signed but unbroadcast transaction through its PCZT RPCs. The facilitator can broadcast it through a [Zakura](https://github.com/zakura-core/zakura) node, verify the exact recipient and amount, and only then let the protected handler run.

```text
x402 client                 x402 facilitator                 merchant
-----------                 ----------------                 --------
Zallet PCZT create/prove/
sign/extract (no broadcast)
        │ signed tx                 │
        └── PAYMENT-SIGNATURE ─────▶│
                                    ├── sendrawtransaction ──▶ Zakura
                                    ├── transparent vout     ◀ Zakura
                                    └── shielded note+memo   ◀ watch-only Zallet
                                                               │
        ◀──────── protected response after upfront settle ─────┘
```

## What ships

- `ExactZcashScheme` implementations for all three `@x402/core` roles.
- CAIP-2 identifiers for Zcash Mainnet, Testnet, and Regtest.
- A `ZalletPcztSigner` that never exports private keys and never broadcasts before the paid request.
- A `ZakuraRpcClient` for broadcast and transparent-output verification.
- A `ZalletPaymentObserver` for private Sapling, Orchard, and Ironwood receipt verification.
- Request-binding shielded memos and transaction-ID replay protection.
- A storage interface for durable, multi-replica settlement deduplication.
- No facilitator key or gas sponsorship: the payer signs and pays the ZIP 317 fee.

## Install

```bash
pnpm add x402-zcash @x402/core @x402/fetch
```

Until the package is published to npm, install the tagged GitHub release directly:

```bash
pnpm add github:dmarzzz/x402-zcash#v0.1.1 @x402/core @x402/fetch
```

Node.js 20 or newer is required. The first release targets x402 v2 and `@x402/core` 2.24 or newer.

## Client

Zallet must be synced, unlocked when necessary, and configured with `external.broadcast = false` for this use case. The PCZT methods themselves do not broadcast, but disabling wallet-wide external broadcast prevents an accidental fallback to a send RPC elsewhere in the application.

```ts
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { registerExactZcashScheme } from "x402-zcash/exact/client";
import { ZalletPcztSigner, ZalletRpcClient, ZCASH_NETWORKS } from "x402-zcash";

const wallet = new ZalletRpcClient({
  url: process.env.ZALLET_RPC_URL!,
  username: process.env.ZALLET_RPC_USER,
  password: process.env.ZALLET_RPC_PASSWORD,
});

const signer = new ZalletPcztSigner({
  rpc: wallet,
  from: process.env.ZALLET_ACCOUNT_UUID!,
  fundSource: "orchard",
  privacyPolicy: "FullPrivacy",
});

const client = new x402Client();
registerExactZcashScheme(client, {
  signer,
  networks: [ZCASH_NETWORKS.mainnet],
  spendControls: {
    maxAmountPerPayment: false,
    allowedAssets: [
      {
        network: ZCASH_NETWORKS.mainnet,
        asset: "ZEC",
        maxAmountPerPayment: "100000", // 0.001 ZEC
      },
    ],
  },
});

const payingFetch = wrapFetchWithPayment(fetch, client);
const response = await payingFetch("https://api.example.com/private-data");
console.log(await response.json());
```

`ZalletPcztSigner` converts the atomic x402 amount into an exact decimal string before calling `pczt_create`; it does not use JavaScript floating-point math.

ZEC is deliberately not marked as an x402 default asset because core's default-asset cap is denominated in USD and ZEC is volatile. Add an atomic `allowedAssets` cap as above, provide your own payment policy, or explicitly disable spend controls only in a controlled application.

## Resource server

Register the server mechanism with any x402 HTTP adapter. Prices expressed as an `AssetAmount` are already atomic zatoshis. A decimal string such as `"0.00001 ZEC"` is also accepted. Dollar prices require a custom money parser because this package deliberately does not ship a price oracle.

```ts
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { registerExactZcashScheme } from "x402-zcash/exact/server";
import { ZCASH_NETWORKS } from "x402-zcash";

const facilitator = new HTTPFacilitatorClient({
  url: "https://facilitator.example.com",
});

const resourceServer = new x402ResourceServer(facilitator);
registerExactZcashScheme(resourceServer, {
  networks: [ZCASH_NETWORKS.mainnet],
});

// Pass resourceServer to @x402/express, @x402/hono, @x402/fastify, etc.
// Route accepts entry:
const accepts = {
  scheme: "exact" as const,
  network: ZCASH_NETWORKS.mainnet,
  payTo: process.env.MERCHANT_UNIFIED_ADDRESS!,
  price: { amount: "1000", asset: "ZEC" },
  maxTimeoutSeconds: 120,
  extra: {
    paymentFlow: "upfront",
    minConfirmations: 0,
  },
};
```

The scheme adds a fresh `extra.paymentId` to each unpaid 402 response and marks it as a dynamic x402 field. During settlement, the ID in the client's accepted requirements is authoritative; this keeps retries stable even if the resource server rebuilds its requirements.

## Facilitator

```ts
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactZcashScheme } from "x402-zcash/exact/facilitator";
import {
  ZakuraRpcClient,
  ZalletPaymentObserver,
  ZalletRpcClient,
  ZCASH_NETWORKS,
} from "x402-zcash";

const zakura = new ZakuraRpcClient({
  url: process.env.ZAKURA_RPC_URL!,
  username: process.env.ZAKURA_RPC_USER,
  password: process.env.ZAKURA_RPC_PASSWORD,
});
await zakura.assertNetwork(ZCASH_NETWORKS.mainnet);

// This can be a watch-only Zallet containing only the merchant incoming viewing key.
const observer = new ZalletPaymentObserver({
  rpc: new ZalletRpcClient({
    url: process.env.MERCHANT_ZALLET_RPC_URL!,
    username: process.env.MERCHANT_ZALLET_RPC_USER,
    password: process.env.MERCHANT_ZALLET_RPC_PASSWORD,
  }),
  accountUuid: process.env.MERCHANT_ZALLET_ACCOUNT_UUID!,
  acceptedAddresses: [process.env.MERCHANT_UNIFIED_ADDRESS!],
});

const facilitator = new x402Facilitator();
registerExactZcashScheme(facilitator, {
  network: ZCASH_NETWORKS.mainnet,
  zakura,
  observer,
  minConfirmations: 0,
  // Use a durable SettlementStore implementation in production.
});

// Mount facilitator.verify(), facilitator.settle(), and facilitator.getSupported()
// with the standard x402 facilitator HTTP transport.
```

Call `registerExactZcashScheme` once per network, with a Zakura client connected to that network.

## Transparent and shielded verification

Transparent payments are checked directly from Zakura's verbose `getrawtransaction` response. The sum of every output to `payTo` must equal `amount` exactly.

Shielded payments require a merchant-side `ZcashPaymentObserver`. The included `ZalletPaymentObserver` requires all of the following on one received output:

- the configured merchant account owns the note;
- the value equals the required zatoshis;
- the memo equals `x402:<paymentId>`;
- the transaction has the configured number of confirmations.

The observer can use a watch-only Zallet. Do not put merchant spending keys on a public facilitator.

## Replay and failure semantics

The facilitator claims each transaction ID before broadcast. The same transaction may be retried for the same payment while settlement is pending, but it cannot satisfy different requirements.

`InMemorySettlementStore` is intentionally a development default. A production deployment must provide a durable, atomic `SettlementStore` shared across replicas and retain successful transaction IDs indefinitely.

Pre-broadcast transactions are rejected by default. This matters because a transaction ID visible in the public mempool could otherwise be copied into a competing paid request. The normal PCZT client path sends the complete unbroadcast transaction directly in the HTTPS payment header.

If Zakura accepted the transaction but confirmation cannot be observed before `maxTimeoutSeconds`, settlement returns the standard non-terminal `settlement_pending` result with the transaction ID. Identical retries reconcile against the chain instead of broadcasting again.

## Operational notes

- Shielded transactions can make the base64-encoded `PAYMENT-SIGNATURE` header larger than common reverse-proxy defaults. Budget at least 64 KiB for request headers and test the complete proxy/CDN path.
- `minConfirmations: 0` accepts a transaction once the configured observer can see it. A watch-only wallet may not expose a shielded receipt until it is mined; use a timeout that covers the expected block interval.
- Keep Zakura and Zallet RPC listeners private, authenticated, and TLS-protected across hosts.
- The facilitator does not sponsor fees and never signs a transaction.
- Zallet and this package are pre-1.0 surfaces. Pin versions and test Regtest before upgrading.

## Custom wallets and observers

Other wallets can integrate by implementing `ZcashTransactionSigner`:

```ts
import type { ZcashTransactionSigner } from "x402-zcash";

const signer: ZcashTransactionSigner = {
  async createTransaction(request) {
    return {
      transaction: "<base64 consensus transaction bytes>",
      transactionId: "<64 lowercase hex chars>",
    };
  },
};
```

Private receipt systems can implement `ZcashPaymentObserver`. This keeps the x402 mechanism independent of wallet database layout and lets operators use an HSM, a dedicated viewing service, or a future Zakura-compatible wallet.

## Protocol

See [specs/exact-zcash.md](specs/exact-zcash.md) for the wire format, settlement algorithm, error codes, and security requirements.

## Development

```bash
pnpm install
pnpm check
pnpm pack
```

The tests use mocked RPC boundaries and do not require funds. A real integration should run Zallet and Zakura on Regtest and exercise the same public interfaces.

## License

MIT.
