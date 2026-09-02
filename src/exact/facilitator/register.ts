import type { x402Facilitator } from "@x402/core/facilitator";
import {
  ExactZcashFacilitator,
  type ExactZcashFacilitatorOptions,
} from "./scheme.js";

export type ZcashFacilitatorConfig = ExactZcashFacilitatorOptions;

export function registerExactZcashScheme(
  facilitator: x402Facilitator,
  config: ZcashFacilitatorConfig,
): x402Facilitator {
  facilitator.register(config.network, new ExactZcashFacilitator(config));
  return facilitator;
}
