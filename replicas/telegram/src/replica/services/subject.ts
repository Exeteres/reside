import type { SubjectServiceImplementation } from "@reside/api/common/subject.v1"
import type { ResideCrypto } from "@reside/common/encryption"
import type { PrismaClient } from "../../database"
import { create } from "@bufbuild/protobuf"
import { Code, ConnectError } from "@connectrpc/connect"
import { SubjectDisplayInfoSchema } from "@reside/api/common/subject.v1"
import { authenticateReplica, logger } from "@reside/common"
import { resolveTelegramSubjectDisplayInfo } from "../business/subject"

export function createSubjectService({
  crypto,
  prisma,
}: {
  crypto: ResideCrypto
  prisma: PrismaClient
}): SubjectServiceImplementation {
  return {
    async getSubjectDisplayInfo(request, context) {
      const identity = await authenticateReplica(context)
      if (identity.name !== "access" && identity.name !== "telegram") {
        throw new ConnectError(
          `Replica "${identity.name}" is not allowed to query telegram subject display info`,
          Code.PermissionDenied,
        )
      }

      logger.debug("getSubjectDisplayInfo requested for subjectId %s", request.subjectId)

      try {
        const payload = await resolveTelegramSubjectDisplayInfo(crypto, prisma, request.subjectId)

        logger.debug("resolved subject display info for subjectId %s", request.subjectId)

        return create(SubjectDisplayInfoSchema, {
          title: payload.title,
          avatarUrl: undefined,
        })
      } catch (error) {
        if (error instanceof Error && error.message.includes("format")) {
          throw new ConnectError(error.message, Code.InvalidArgument)
        }

        if (error instanceof Error && error.message.includes("was not found")) {
          throw new ConnectError(error.message, Code.NotFound)
        }

        throw error
      }
    },
  }
}
