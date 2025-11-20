import { co, z } from "jazz-tools"
import { PermissionEntity } from "./contract-entity"

export type GrantedPermission = co.loaded<typeof GrantedPermission>
export type GrantedPermissionRequestType = z.infer<typeof GrantedPermissionRequestType>
export type GrantedPermissionStatus = z.infer<typeof GrantedPermissionStatus>

export const GrantedPermissionRequestType = z.enum([
  /**
   * The permission was statically requested in replica manifest and approved when the replica was created.
   */
  "static",

  /**
   * The permission was dynamically requested at runtime by the replica.
   */
  "dynamic",

  /**
   * The permission was manually granted by an administrator.
   */
  "manual",
])

export const GrantedPermissionStatus = z.enum([
  /**
   * The permission request is pending approval.
   */
  "pending",

  /**
   * The permission was approved.
   */
  "approved",

  /**
   * The permission was rejected.
   */
  "rejected",
])

/**
 * The instance of permission requested by replica and granted by the Alpha.
 */
export const GrantedPermission = co.map({
  /**
   * The type of the permission request.
   */
  requestType: GrantedPermissionRequestType,

  /**
   * The status of the permission.
   */
  status: GrantedPermissionStatus,

  /**
   * The permission entity.
   */
  permission: PermissionEntity,

  /**
   * The ID of the permission instance if applicable.
   */
  instanceId: z.string().optional(),

  /**
   * The parameters of the permission instance.
   */
  params: z.record(z.string(), z.json()),
})
