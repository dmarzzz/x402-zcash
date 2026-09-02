import { describe, expect, it } from "vitest";
import {
  assertZatoshiAmount,
  base64TransactionToHex,
  decimalZecToZatoshis,
  hexToBase64,
  paymentMemo,
  paymentMemoHex,
  zatoshisToDecimalZec,
} from "../src/utils.js";

describe("ZEC amount conversion", () => {
  it("converts without floating-point rounding", () => {
    expect(decimalZecToZatoshis("0.00000001")).toBe("1");
    expect(decimalZecToZatoshis("1.23456789")).toBe("123456789");
    expect(zatoshisToDecimalZec("123456789")).toBe("1.23456789");
    expect(zatoshisToDecimalZec("100000000")).toBe("1");
  });

  it("rejects fractional zatoshis and invalid atomic values", () => {
    expect(() => decimalZecToZatoshis("0.000000001")).toThrow("at most 8");
    expect(() => assertZatoshiAmount("0")).toThrow("positive integer");
    expect(() => assertZatoshiAmount("1.5")).toThrow("positive integer");
  });
});

describe("transaction and memo encoding", () => {
  it("round-trips canonical transaction bytes", () => {
    const encoded = hexToBase64("00deadbeef");
    expect(base64TransactionToHex(encoded)).toBe("00deadbeef");
  });

  it("rejects non-canonical base64", () => {
    expect(() => base64TransactionToHex("Zg")).toThrow("canonical base64");
  });

  it("builds a request-binding Zcash memo", () => {
    const id = "payment_1234567890";
    expect(paymentMemo(id)).toBe(`x402:${id}`);
    expect(Buffer.from(paymentMemoHex(id), "hex").toString("utf8")).toBe(
      `x402:${id}`,
    );
  });
});
