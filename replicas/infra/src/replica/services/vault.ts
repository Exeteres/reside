import type { VaultServiceImplementation } from "@reside/api/infra/vault.v1"
import type { VaultConfig } from "../../shared"
import { create } from "@bufbuild/protobuf"
import { GetVaultCredentialsResponseSchema } from "@reside/api/infra/vault.v1_pb"
import { authenticateReplica } from "@reside/common"

export function createVaultService({
  vaultConfig,
}: {
  vaultConfig: VaultConfig
}): VaultServiceImplementation {
  return {
    async getVaultCredentials(_request, context) {
      await authenticateReplica(context)

      return create(GetVaultCredentialsResponseSchema, {
        result: {
          endpoint: vaultConfig.endpoint,
          audience: vaultConfig.audience,
        },
      })
    },
  }
}
