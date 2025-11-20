import { ApiException } from "@kubernetes/client-node"
import { WasmCrypto } from "cojson/crypto/WasmCrypto"
import { createWebSocketPeer } from "cojson-transport-ws"
import { Account, isControlledAccount, type Peer } from "jazz-tools"

export function isAlreadyExists(err: unknown): boolean {
  return err instanceof ApiException && err.code === 409
}

export function extractIpv4Address(address: string): string | undefined {
  const ipv4Regex =
    /^(?:http:\/\/|https:\/\/)?((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))(?::\d+)?$/
  const match = address.match(ipv4Regex)

  return match?.[1]
}

export async function createWorkerAccount(name: string, peerAddr: string) {
  const crypto = await WasmCrypto.create()

  const peer = createWebSocketPeer({
    id: "upstream",
    websocket: new WebSocket(peerAddr),
    role: "server",
  })

  const account = await Account.create({
    creationProps: { name },
    peers: [peer as Peer],
    crypto,
  })

  if (!isControlledAccount(account)) {
    throw new Error("Account is not a controlled account")
  }

  await account.$jazz.waitForAllCoValuesSync({ timeout: 4000 })

  return {
    account,
    credentials: {
      accountId: account.$jazz.id,
      agentSecret: account.$jazz.localNode.getCurrentAgent().agentSecret,
    },
  }
}
