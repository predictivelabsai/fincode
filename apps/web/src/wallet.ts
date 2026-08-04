import type { TypedData as PolyTradeTypedData } from "@polytrade/contracts";
import {
  createWalletClient,
  custom,
  getAddress,
  type Address,
  type Hex,
  type TypedData,
  type TypedDataDomain,
  type WalletClient,
} from "viem";
import { polygon } from "viem/chains";

export interface ConnectedWallet {
  address: Address;
  client: WalletClient;
}

export async function connectWallet(): Promise<ConnectedWallet> {
  if (!window.ethereum) {
    throw new Error("No browser wallet was found. Install a Polygon-compatible wallet first.");
  }
  const client = createWalletClient({ chain: polygon, transport: custom(window.ethereum) });
  const [address] = await client.requestAddresses();
  if (!address) throw new Error("The wallet did not return an account");
  return { address: getAddress(address), client };
}

export async function signTypedPayload(
  wallet: ConnectedWallet,
  typedData: PolyTradeTypedData,
): Promise<Hex> {
  const params = {
    account: wallet.address,
    domain: typedData.domain as TypedDataDomain,
    types: typedData.types as unknown as TypedData,
    primaryType: typedData.primaryType,
    message: typedData.message,
  } as Parameters<WalletClient["signTypedData"]>[0];
  return wallet.client.signTypedData(params);
}
