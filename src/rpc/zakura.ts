import type { ZcashNetwork } from "../constants.js";
import { ZCASH_GENESIS_HASHES } from "../constants.js";
import type { ZakuraRawTransaction } from "../types.js";
import { lowerCaseTransactionId } from "../utils.js";
import {
  isTransactionNotFound,
  JsonRpcClient,
  type JsonRpcTransportOptions,
} from "./json-rpc.js";

export interface ZakuraClient {
  sendRawTransaction(transactionHex: string): Promise<string>;
  getRawTransaction(
    transactionId: string,
  ): Promise<ZakuraRawTransaction | undefined>;
  getBlockHash(height: number): Promise<string>;
}

export class ZakuraRpcClient implements ZakuraClient {
  readonly rpc: JsonRpcClient;

  constructor(options: JsonRpcTransportOptions | JsonRpcClient) {
    this.rpc =
      options instanceof JsonRpcClient ? options : new JsonRpcClient(options);
  }

  async sendRawTransaction(transactionHex: string): Promise<string> {
    const transactionId = await this.rpc.call<string>("sendrawtransaction", [
      transactionHex,
    ]);
    return lowerCaseTransactionId(transactionId);
  }

  async getRawTransaction(
    transactionId: string,
  ): Promise<ZakuraRawTransaction | undefined> {
    try {
      return await this.rpc.call<ZakuraRawTransaction>("getrawtransaction", [
        transactionId,
        1,
      ]);
    } catch (error) {
      if (isTransactionNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  getBlockHash(height: number): Promise<string> {
    return this.rpc.call<string>("getblockhash", [height]);
  }

  async assertNetwork(network: ZcashNetwork): Promise<void> {
    const actual = (await this.getBlockHash(0)).toLowerCase();
    const expected = ZCASH_GENESIS_HASHES[network];
    if (actual !== expected) {
      throw new Error(
        `Zakura genesis hash ${actual} does not match ${network}`,
      );
    }
  }
}
