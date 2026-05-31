import type { DefinitionServiceImplementation } from "@reside/api/access/definition.v1"
import type { PrismaClient } from "../../database"
import { create } from "@bufbuild/protobuf"
import {
  ApproverSchema,
  PermissionSchema,
  PutPermissionsResponseSchema,
  RealmSchema,
} from "@reside/api/access/definition.v1"
import { authenticateReplica } from "@reside/common"
import { putApprover, putPermissions, putRealm } from "../business/definition"

export function createDefinitionService({
  prisma,
}: {
  prisma: PrismaClient
}): DefinitionServiceImplementation {
  return {
    async putPermissions(request, context) {
      const identity = await authenticateReplica(context)
      const permissions = await putPermissions(
        prisma,
        `replica:${identity.name}`,
        request.permissions.map(permission => ({
          name: permission.name,
          title: permission.title,
          description: permission.description,
          scoped: permission.scoped,
        })),
      )

      return create(PutPermissionsResponseSchema, {
        permissions: permissions.map(permission =>
          create(PermissionSchema, {
            id: permission.id,
            name: permission.name,
            title: permission.title,
            description: permission.description ?? undefined,
            scoped: permission.scoped,
          }),
        ),
      })
    },

    async putRealm(request, context) {
      const identity = await authenticateReplica(context)
      const realm = await putRealm(prisma, `replica:${identity.name}`, {
        name: request.name,
        title: request.title,
        description: request.description,
        subjectServiceEndpoint: request.subjectServiceEndpoint,
      })

      return create(RealmSchema, {
        id: realm.id,
        name: realm.name,
        title: realm.title,
        description: realm.description ?? undefined,
        subjectServiceEndpoint: realm.subjectServiceEndpoint ?? undefined,
      })
    },

    async putApprover(request, context) {
      const identity = await authenticateReplica(context)
      const approver = await putApprover(prisma, identity.name, {
        name: request.name,
        priority: request.priority,
        realms: request.realms,
        title: request.title,
        description: request.description,
        callbackEndpoint: request.callbackEndpoint,
      })

      return create(ApproverSchema, {
        id: approver.id,
        name: approver.name,
        priority: approver.priority,
        realms: approver.realms.map(realm =>
          create(RealmSchema, {
            id: realm.id,
            name: realm.name,
            title: realm.title,
            description: realm.description ?? undefined,
            subjectServiceEndpoint: realm.subjectServiceEndpoint ?? undefined,
          }),
        ),
        title: approver.title,
        description: approver.description ?? undefined,
        callbackEndpoint: approver.callbackEndpoint,
      })
    },
  }
}
