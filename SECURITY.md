# Security policy

This package is experimental and has not received an independent security audit. Do not deploy it with spending keys on a public facilitator.

Please report vulnerabilities privately to the Zakura maintainers rather than opening a public issue. Include the affected version, impact, reproduction steps, and any suggested mitigation.

Production operators must use a durable shared `SettlementStore`, private authenticated RPC endpoints, HTTPS for x402 traffic, and a watch-only merchant observer for shielded payments.
