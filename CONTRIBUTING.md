# Contributing

Keep changes scoped to the Zcash x402 binding and preserve the trust boundaries documented in `specs/exact-zcash.md`.

```bash
pnpm install
pnpm check
```

Protocol changes require corresponding specification and test updates. Security-sensitive changes must exercise replay behavior, exact atomic amounts, mismatched recipients, and failure-before-resource semantics.

Never add a facilitator spending key, seed phrase, or fee-sponsorship path. Integration-test credentials belong in untracked environment files.
