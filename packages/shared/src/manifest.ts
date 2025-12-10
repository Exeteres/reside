import { z } from "jazz-tools"
import { mapValues } from "remeda"
import { toJSONSchema } from "zod"
import { type Contract, DisplayInfo, SerializedContract } from "./contract"
import {
  type ReplicaDefinition,
  ReplicaInfo,
  SerializedImplementation,
  SerializedRequirement,
} from "./replica-definition"

export type ReplicaManifest = z.infer<typeof ReplicaManifest>
export type ContractManifest = z.infer<typeof ContractManifest>
export type ResideManifest = z.infer<typeof ResideManifest>

export const ReplicaManifest = z.object({
  type: z.literal("replica"),
  identity: z.string(),
  info: ReplicaInfo,
  displayInfo: z.z.record(z.string(), DisplayInfo),
  implementations: z.z.record(z.string(), SerializedImplementation),
  requirements: z.z.record(z.string(), SerializedRequirement),
  avatarPrompt: z.string().optional(),
})

export const ContractManifest = z.object({
  type: z.literal("contract"),
  ...SerializedContract.shape,
})

export const CommonResideManifest = z.object({
  /**
   * Extra alpine packages to be included in the image.
   */
  packages: z.array(z.string()).optional(),

  /**
   * Extra alpine packages to install from testing repository.
   */
  testingPackages: z.array(z.string()).optional(),
})

export const ResideManifest = z.z.intersection(
  z.union([ContractManifest, ReplicaManifest]),
  CommonResideManifest,
)

export type InputContractManifest = {
  type: "contract"
  contract: Contract
}

export type ReplicaInputContractRequirement<TContract extends Contract> = {
  contract: TContract

  permissions: {
    [K in keyof TContract["permissions"]]: z.infer<
      TContract["permissions"][K]["params"]
    > extends Record<string, never>
      ? { name: K }
      : {
          name: K
          params: z.infer<TContract["permissions"][K]["params"]>
        }
  }[keyof TContract["permissions"]][]
}

export type InputReplicaManifest = {
  type: "replica"
  // biome-ignore lint/suspicious/noExplicitAny: to simplify types
  replica: ReplicaDefinition<any, any, any>

  avatarPrompt: string
}

export type CommonResideManifest = z.infer<typeof CommonResideManifest>

export type InputResideManifest = (InputReplicaManifest | InputContractManifest) &
  CommonResideManifest

export function defineManifest(manifest: InputResideManifest): ResideManifest {
  if (manifest.type === "replica") {
    return {
      type: "replica",
      identity: manifest.replica.identity,
      info: manifest.replica.info,
      displayInfo: manifest.replica.displayInfo,

      implementations: mapValues(manifest.replica.implementations ?? {}, impl => ({
        identity: impl.identity,
      })),

      requirements: mapValues(manifest.replica.requirements ?? {}, req => ({
        identity: req.contract.identity,
        displayInfo: req.displayInfo,
        optional: req.optional,
        multiple: req.multiple,
        permissions: (req.permissions ?? []).map(permission => {
          const contractPermission = req.contract.permissions[permission.name]
          if (!contractPermission) {
            throw new Error(
              `Contract "${req.contract.identity}" does not define permission "${permission.name}" required by replica "${manifest.replica.identity}".`,
            )
          }

          const params = "params" in permission ? permission.params : {}

          return {
            name: permission.name,
            instanceId: contractPermission.getInstanceId
              ? contractPermission.getInstanceId(params)
              : undefined,
            params,
          }
        }),
      })),

      packages: manifest.packages,
      testingPackages: manifest.testingPackages,
      avatarPrompt: manifest.avatarPrompt,
    }
  }

  return {
    type: "contract",
    identity: manifest.contract.identity,
    displayInfo: manifest.contract.displayInfo,

    permissions: mapValues(manifest.contract.permissions, permission => ({
      displayInfo: permission.displayInfo,
      instanceKeys:
        permission.instanceKeys && permission.instanceKeys.length > 0
          ? [...permission.instanceKeys]
          : undefined,
      params:
        Object.keys(permission.params.shape).length > 0
          ? // biome-ignore lint/suspicious/noExplicitAny: to simplify types
            (toJSONSchema(permission.params) as any)
          : undefined,
    })),

    methods: mapValues(manifest.contract.methods, method => ({
      displayInfo: method.displayInfo,
    })),

    packages: manifest.packages,
    testingPackages: manifest.testingPackages,
  }
}
