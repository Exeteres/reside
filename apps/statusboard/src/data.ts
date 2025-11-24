import { AlphaContract } from "@contracts/alpha.v1"
import { createRequirement } from "@reside/shared"
import { createWebSocketPeer } from "cojson-transport-ws"
import { WasmCrypto } from "cojson/crypto/WasmCrypto"
import type { AgentSecret } from "cojson/src/index.js"
import {
  type co,
  createJazzContextFromExistingCredentials,
  randomSessionProvider,
} from "jazz-tools"

await createJazzContextFromExistingCredentials({
  asActiveAccount: true,
  credentials: {
    accountID: import.meta.env.VITE_ACCOUNT_ID,
    secret: import.meta.env.VITE_AGENT_SECRET as AgentSecret,
  },
  crypto: await WasmCrypto.create(),
  sessionProvider: randomSessionProvider,
  peers: [
    createWebSocketPeer({
      id: "upstream",
      role: "server",
      websocket: new WebSocket(import.meta.env.VITE_JAZZ_SYNC_SERVER_URL),
    }),
  ],
})

const alpha = await createRequirement(AlphaContract, import.meta.env.VITE_ALPHA_REPLICA_ID)

export type LoadedAlphaData = co.loaded<
  AlphaContract["data"],
  {
    replicas: {
      $each: { currentVersion: { requirements: { $each: { replicas: { $each: true } } } } }
    }
  }
>

export const loadedAlphaData = await alpha.data.$jazz.ensureLoaded({
  resolve: {
    replicas: {
      $each: {
        currentVersion: {
          requirements: {
            $each: {
              replicas: {
                $each: true,
              },
            },
          },
        },
      },
    },
  },
})
