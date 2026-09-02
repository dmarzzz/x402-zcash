# x402 v2 `exact` on Zcash

Status: experimental binding, version 0.1

## 1. Summary

This binding transfers an exact amount of native ZEC for an x402 resource. The payer creates and signs a complete Zcash transaction without broadcasting it. The x402 facilitator broadcasts the transaction to a Zakura node and establishes merchant receipt before the resource handler executes.

The binding uses x402's `upfront` payment flow because a Zcash transaction is an irrevocable, payer-signed transfer rather than a delegatable authorization.

## 2. Networks and asset

Network identifiers use the CAIP-2 `bip122` namespace and the first 16 bytes of the displayed genesis block hash.

| Network | CAIP-2 identifier                         |
| ------- | ----------------------------------------- |
| Mainnet | `bip122:00040fe8ec8471911baa1db1266ea15d` |
| Testnet | `bip122:05a60a92d99d85997cce3b87616c089f` |
| Regtest | `bip122:029f11d80ef9765602235e1bc9727e3e` |

`asset` MUST be `ZEC`. `amount` is a positive base-10 integer string in zatoshis. One ZEC is 100,000,000 zatoshis.

## 3. Payment requirements

```json
{
  "scheme": "exact",
  "network": "bip122:00040fe8ec8471911baa1db1266ea15d",
  "asset": "ZEC",
  "amount": "1000",
  "payTo": "u1...",
  "maxTimeoutSeconds": 120,
  "extra": {
    "assetTransferMethod": "zcash-pczt",
    "paymentFlow": "upfront",
    "areFeesSponsored": false,
    "paymentId": "URL-safe random identifier",
    "minConfirmations": 0
  }
}
```

### Required `extra` fields

- `paymentFlow` MUST be `upfront`.
- `areFeesSponsored` MUST be `false`.
- `paymentId` MUST contain 16 to 128 URL-safe alphanumeric, `_`, or `-` characters and MUST be unpredictable for an unpaid request.

### Optional `extra` fields

- `assetTransferMethod`, when present, MUST be `zcash-pczt`. Omission resolves to that default.
- `minConfirmations`, when present, MUST be a non-negative integer. Omission uses facilitator policy.

The server scheme MUST declare `paymentId` as a dynamic requirement field. A facilitator MUST validate both IDs syntactically, then use `paymentPayload.accepted.extra.paymentId` as the authoritative ID for memo verification and the payment fingerprint. This is necessary because an x402 resource server may rebuild dynamic requirements while processing the paid request. When the core provides a paid payload to response enrichment, the resource server MUST echo its accepted ID.

## 4. Payment payload

```json
{
  "x402Version": 2,
  "accepted": { "...": "the selected requirements" },
  "payload": {
    "transaction": "base64-encoded consensus transaction bytes",
    "transactionId": "64 lowercase display-order hex characters",
    "payer": "optional non-authoritative receipt identifier"
  }
}
```

`transaction` MUST be canonical base64. The decoded bytes MUST contain one complete, signed Zcash transaction and MUST fit the active network's transaction size limits.

`transactionId` is a claim by the client until Zakura accepts the transaction. Settlement MUST compare it with the transaction ID returned by `sendrawtransaction`.

`payer` is optional. A facilitator MUST NOT treat it as cryptographic attribution: shielded transactions intentionally do not expose a payer address.

## 5. Client construction

A conforming client MUST:

1. validate the x402 version, network, ZEC amount, payment flow, and payment ID;
2. create exactly one merchant payment for the required amount;
3. pay the Zcash transaction fee itself;
4. for a shielded recipient, set the output memo text to `x402:<paymentId>`;
5. prove and sign the transaction;
6. keep the transaction unbroadcast until it is sent in the x402 payment payload.

The reference adapter performs these steps with Zallet's `pczt_create`, `pczt_prove`, `pczt_sign`, and `pczt_extract` methods.

## 6. Payment flow

The resolved flow is `upfront`:

- `/verify` is omitted;
- `/settle` runs before the protected resource handler;
- no second settlement runs after the handler.

Calling `/verify` directly MUST NOT broadcast the transaction. A facilitator MAY reject the call with `invalid_exact_zcash_upfront_requires_settle`.

## 7. Settlement algorithm

A facilitator MUST perform the following operations in order:

1. Validate the x402 envelope and require `paymentPayload.accepted` to match the server requirements, excluding the declared dynamic `paymentId` value.
2. Decode and size-bound the transaction.
3. Atomically claim `(transactionId, payment fingerprint)` in a durable replay store.
4. Reject a transaction ID already claimed by different requirements.
5. Unless reconciling its own earlier pending attempt, reject a transaction already visible to the network by default.
6. Submit the transaction through Zakura `sendrawtransaction`.
7. Require the returned transaction ID to equal `payload.transactionId`.
8. Establish exact merchant receipt using section 8.
9. Wait for `minConfirmations` without exceeding `maxTimeoutSeconds`.
10. Persist the final result before returning it.

The payment fingerprint MUST cover at least scheme, network, asset, amount, `payTo`, and `paymentId`.

## 8. Receipt verification

### 8.1 Transparent recipient

The facilitator MUST read the transaction through Zakura and sum all transparent outputs whose decoded address equals `payTo`. The sum MUST equal `amount` exactly. Values MUST be read from the atomic `valueZat` or compatible `valueSat` field, never from a floating-point ZEC field.

### 8.2 Shielded or Unified Address recipient

An incoming-viewing-key-capable merchant observer MUST establish that exactly one received shielded output:

- belongs to the configured merchant account;
- has value equal to `amount`;
- has memo text equal to `x402:<paymentId>`;
- belongs to the submitted transaction.

The observer MAY be a watch-only Zallet. A facilitator without a merchant observer MUST fail closed for shielded recipients.

PCZT creator metadata alone is not sufficient evidence of shielded receipt because optional recipient metadata is not itself the on-chain viewing-key proof.

## 9. Replay and idempotency

The transaction ID MUST be claimed before broadcast. Atomicity must extend across every facilitator replica.

- The same transaction and fingerprint MAY reconcile an earlier pending attempt.
- A successful record MUST be retained indefinitely.
- The same transaction with a different fingerprint MUST fail with `duplicate_settlement`.
- A transaction publicly visible before its first claim SHOULD fail with `transaction_already_broadcast`.

Allowing pre-broadcast transactions weakens request ownership: another party can copy a public transaction ID and race the payer's HTTP request.

## 10. Responses

A successful response follows x402 v2:

```json
{
  "success": true,
  "transaction": "txid",
  "network": "bip122:...",
  "amount": "1000",
  "extra": { "confirmations": 1 }
}
```

When the transaction was submitted but final receipt cannot be observed before the deadline, return:

```json
{
  "success": false,
  "errorReason": "settlement_pending",
  "transaction": "txid",
  "network": "bip122:..."
}
```

`settlement_pending` is non-terminal. It MUST carry a non-empty transaction ID.

## 11. Binding-specific errors

- `invalid_exact_zcash_upfront_requires_settle`
- `invalid_exact_zcash_payload`
- `invalid_exact_zcash_transaction_id_mismatch`
- `invalid_exact_zcash_amount_mismatch`
- `invalid_exact_zcash_output_amount`
- `shielded_payment_output_mismatch`
- `shielded_payment_observer_not_configured`
- `transaction_already_broadcast`
- `transaction_submission_failed`
- `duplicate_settlement`
- `settlement_pending`

## 12. Security considerations

- RPC endpoints must not be exposed publicly. Use loopback or a private network, authentication, and TLS across hosts.
- A watch-only facilitator should hold incoming viewing authority, not spending authority.
- The facilitator must not sponsor fees or add signatures in this binding.
- Raw signed transactions are bearer data until broadcast. HTTPS is mandatory.
- HTTP infrastructure must allow the encoded payment-header size of a shielded transaction.
- Resource execution happens only after settlement because Zcash does not provide a reversible authorization primitive.
- Regtest integration tests are required before deploying a new Zallet, Zakura, or x402 core version.

## 13. References

- [x402 v2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)
- [x402 exact scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact.md)
- [CAIP-2 BIP122 namespace](https://github.com/ChainAgnostic/namespaces/blob/main/bip122/caip2.md)
- [Zallet PCZT RPC documentation](https://github.com/zcash/zallet/blob/main/book/src/rpc/methods.md)
- [Zakura RPC implementation](https://github.com/zakura-core/zakura/tree/main/crates/zakura-rpc)
