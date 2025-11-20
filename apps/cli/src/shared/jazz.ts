import { armor, Decrypter } from "age-encryption"
import { resolveCurrentContextConfig } from "./config"
import { getOrCreateAgeIdentity } from "./identity"
import { createJazzContextForNewAccount } from "jazz-tools"
import type { AgentSecret } from "cojson"
import { WasmCrypto } from "cojson/crypto/WasmCrypto"
import { createWebSocketPeer } from "cojson-transport-ws"
import { createRequirement } from "@reside/shared"
import { AlphaContract } from "@contracts/alpha.v1"

export function getJazzEndpoint(clusterEndpoint: string): string {
  return clusterEndpoint.startsWith("https://")
    ? clusterEndpoint.replace("https://", "ws://")
    : clusterEndpoint.startsWith("http://")
      ? clusterEndpoint.replace("http://", "ws://")
      : `ws://${clusterEndpoint}`
}

export async function createJazzContextForCurrentContext(context?: string) {
  const { cluster, account } = await resolveCurrentContextConfig(context)

  const identity = await getOrCreateAgeIdentity()
  const decrypter = new Decrypter()
  decrypter.addIdentity(identity)

  const encrypted = armor.decode(account.encryptedAgentSecret)
  const decrypted = await decrypter.decrypt(encrypted, "text")

  const jazzEndpoint = getJazzEndpoint(cluster.endpoint)

  const jazzContext = await createJazzContextForNewAccount({
    initialAgentSecret: decrypted as AgentSecret,
    crypto: await WasmCrypto.create(),
    creationProps: { name: account.name },
    peers: [
      createWebSocketPeer({
        id: "upstream",
        role: "server",
        websocket: new WebSocket(jazzEndpoint),
      }),
    ],
  })

  const alpha = await createRequirement(AlphaContract, cluster.alphaReplicaId, cluster.endpoint)

  return {
    ...jazzContext,
    cluster,
    configAccount: account,
    alpha,
    logOut: async () => {
      await jazzContext.account.$jazz.waitForAllCoValuesSync()
      await jazzContext.logOut()
    },
  }
}
