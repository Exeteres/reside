import type { ResideCrypto } from "@reside/common"
import type { PrismaClient } from "../../database"
import { ReaperActionHint } from "@reside/api/reaper/handler.v1"
import { completeReaperAction, createReaperHandler } from "@reside/common"
import { z } from "zod"
import { strings } from "../../locale"

const deleteBindingsPayloadSchema = z.object({
  replicaName: z.string(),
  bindingIds: z.array(z.string().regex(/^\d+$/)).min(1),
})

const deleteRestrictionsPayloadSchema = z.object({
  replicaName: z.string(),
  restrictionIds: z.array(z.string().regex(/^\d+$/)).min(1),
})

const deleteApproverPayloadSchema = z.object({
  approverId: z.number().int().positive(),
  name: z.string(),
})

export function createReaperService({
  prisma,
  crypto,
}: {
  prisma: PrismaClient
  crypto: ResideCrypto
}) {
  return createReaperHandler({
    crypto,
    actions: {
      deleteBindings: {
        schema: deleteBindingsPayloadSchema,
        async execute(_id, payload) {
          await prisma.permissionBinding.deleteMany({
            where: {
              id: {
                in: payload.bindingIds.map(bindingId => BigInt(bindingId)),
              },
            },
          })
          return completeReaperAction()
        },
      },
      deleteRestrictions: {
        schema: deleteRestrictionsPayloadSchema,
        async execute(_id, payload) {
          await prisma.permissionRestriction.deleteMany({
            where: {
              id: {
                in: payload.restrictionIds.map(restrictionId => BigInt(restrictionId)),
              },
            },
          })
          return completeReaperAction()
        },
      },
      deleteApprover: {
        schema: deleteApproverPayloadSchema,
        async execute(_id, payload) {
          await prisma.approver.deleteMany({
            where: {
              id: payload.approverId,
            },
          })
          return completeReaperAction()
        },
      },
    },
    async preview(replicaName) {
      const subjectId = `replica:${replicaName}`
      const [bindings, restrictions, approvers] = await Promise.all([
        prisma.permissionBinding.findMany({
          where: {
            OR: [{ subjectId }, { scope: subjectId }, { scope: replicaName }],
          },
          select: {
            id: true,
          },
          orderBy: [{ id: "asc" }],
        }),
        prisma.permissionRestriction.findMany({
          where: {
            OR: [{ subjectId }, { scope: subjectId }, { scope: replicaName }],
          },
          select: {
            id: true,
          },
          orderBy: [{ id: "asc" }],
        }),
        prisma.approver.findMany({
          where: {
            ownerReplicaName: replicaName,
          },
          orderBy: [{ name: "asc" }],
        }),
      ])

      return [
        ...(bindings.length > 0
          ? [
              {
                name: "deleteBindings" as const,
                title: strings.reaper.actions.deleteBindings(bindings.length),
                hints: [ReaperActionHint.CRITICAL],
                payload: {
                  replicaName,
                  bindingIds: bindings.map(binding => binding.id.toString()),
                },
              },
            ]
          : []),
        ...(restrictions.length > 0
          ? [
              {
                name: "deleteRestrictions" as const,
                title: strings.reaper.actions.deleteRestrictions(restrictions.length),
                hints: [ReaperActionHint.CRITICAL],
                payload: {
                  replicaName,
                  restrictionIds: restrictions.map(restriction => restriction.id.toString()),
                },
              },
            ]
          : []),
        ...approvers.map(approver => ({
          name: "deleteApprover" as const,
          title: strings.reaper.actions.deleteApprover(approver.name),
          hints: [ReaperActionHint.CRITICAL],
          payload: {
            approverId: approver.id,
            name: approver.name,
          },
        })),
      ]
    },
  })
}
