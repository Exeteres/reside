import type { EncryptionRuntime } from "./subsystem"
import { create } from "@bufbuild/protobuf"
import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect"
import {
  type EncryptionServiceImplementation,
  TransferResponseSchema,
} from "@reside/api/common/encryption.v1"
import { WellKnownPermissions } from "@reside/registry"
import { authenticateReplica } from "../auth"
import { getReplicaName } from "../kubernetes"
import { logger } from "../logger"

export type EncryptionServiceOptions = {
  runtime: EncryptionRuntime
}

/**
 * Creates a generic encryption service implementation.
 *
 * @param options The options containing the encryption runtime.
 * @returns A generic encryption service implementation.
 */
export function createEncryptionService({
  runtime,
}: EncryptionServiceOptions): EncryptionServiceImplementation {
  return {
    async transfer(request, context: HandlerContext) {
      const requester = await authenticateReplica(context)
      const replicaName = getReplicaName()
      const permission = await runtime.authzService.checkPermission({
        permissionName: WellKnownPermissions.ENCRYPTION_TRANSFER,
        subjectId: requester.subjectId,
        scope: replicaName,
      })

      if (!permission.authorized) {
        throw new ConnectError(
          `Subject "${requester.subjectId}" is not allowed to transfer encrypted content from "${replicaName}"`,
          Code.PermissionDenied,
        )
      }

      let ciphertexts: string[]
      try {
        ciphertexts = await runtime.transferToReplica(request.ecids, requester.name)
      } catch (error) {
        const errorObject = error instanceof Error ? error : new Error(String(error))
        logger.error(
          { error: errorObject },
          'failed to transfer encrypted content requester="%s" source_replica="%s" ecid_count="%d"',
          requester.subjectId,
          replicaName,
          request.ecids.length,
        )

        throw error
      }

      return create(TransferResponseSchema, {
        ciphertexts,
      })
    },
  }
}
