/** biome-ignore-all lint/suspicious/noExplicitAny: for complex types */

import type { Account, BaseAccountShape } from "jazz-tools"
import type { Logger } from "pino"
import type { Contract, Implementation, Requirement } from "./contract"
import type { ReplicaDefinition } from "./replica-definition"
import { ok } from "node:assert"
import { Etcd3 } from "etcd3"
import { startWorker } from "jazz-tools/worker"
import { pino } from "pino"
import { capitalize, mapKeys, mapValues } from "remeda"
import { loadConfig } from "./config"
import { loadControlBlock, type ReplicaControlBlock } from "./control-block"
import { EtcdLockService, type LockService } from "./lock"
import { reconcileControlBlockPermissions } from "./permissions"
import singleConcurrencyFireAndForget from "./queue-handler"
import { CommonReplicaConfig, populateReplicaAccount, ReplicaAccount } from "./replica"
import { type MethodHandler, type RpcMethod, rpcHandlers, startRpcServer } from "./rpc"

export type ReplicaContext<
  TPrivateData extends BaseAccountShape["root"],
  TImplementations extends Record<string, Contract>,
  TRequirements extends Record<string, Contract>,
> = {
  /**
   * The ID of the current replica.
   */
  replicaId: number

  /**
   * The name of the current replica.
   */
  replicaName: string

  /**
   * The account used by the replica to interact with the system.
   */
  account: ReplicaAccount<TPrivateData, TImplementations>

  /**
   * The implementations of the contracts by the replica.
   */
  implementations: {
    [K in keyof TImplementations]: Implementation<TImplementations[K]>
  }

  /**
   * The requirements of the contracts by the replica.
   */
  requirements: {
    [K in keyof TRequirements]: Requirement<TRequirements[K]>
  }

  /**
   * The logger instance used by the replica.
   */
  logger: Logger

  /**
   * The service to lock resources and make transactions.
   */
  lockService: LockService

  /**
   * Shuts down the replica worker.
   */
  shutdownWorker: () => Promise<void>
}

export function createImplementations<TImplementations extends Record<string, Contract>>(
  replica: ReplicaDefinition<any, TImplementations, any>,
  account: ReplicaAccount<any, TImplementations>,
  rcb: ReplicaControlBlock,
  logger: Logger,
): {
  [K in keyof TImplementations]: Implementation<TImplementations[K]>
} {
  const implementations: Record<string, any> = {}

  ok(account.profile.$isLoaded)
  const replicaName = account.profile.name

  // fill local implementations from account profile
  for (const [key, contract] of Object.entries(replica.implementations ?? {})) {
    const methods = mapKeys(
      mapValues(contract.methods, (method, methodName) => {
        let handler: MethodHandler<RpcMethod>

        const handleFn = method.definition("", account.$jazz.id).handle

        rpcHandlers[`/replicas/${replicaName}/rpc/${contract.identity}/${methodName}`] =
          async request => {
            if (!handler) {
              throw new Error(
                `No handler registered for method "${methodName}" of contract "${contract.identity}"`,
              )
            }

            try {
              return await handleFn(request, account, handler)
            } catch (err) {
              logger.error(
                { err },
                `Error handling RPC method "${methodName}" of contract "${contract.identity}"`,
              )
              throw err
            }
          }

        return (_handler: MethodHandler<RpcMethod>): void => {
          handler = _handler

          logger.info(
            `registered handler for method "%s" of contract "%s"`,
            methodName,
            contract.identity,
          )
        }
      }),
      methodName => `handle${capitalize(methodName)}`,
    )

    const checkPermission = (
      account: Account,
      permissionKey: string,
      instanceId?: string,
    ): boolean => {
      const fullKey = instanceId
        ? `${account.$jazz.id}:${permissionKey}:${instanceId}`
        : `${account.$jazz.id}:${permissionKey}`

      console.log("permission check:", fullKey, Object.keys(rcb.permissions))

      return rcb.permissions.$jazz.has(fullKey)
    }

    implementations[key] = {
      data: (account.profile.contracts as any)[contract.identity],
      checkPermission,
      ...methods,
    }
  }

  return implementations as {
    [K in keyof TImplementations]: Implementation<TImplementations[K]>
  }
}

/**
 * Creates a requirement object for the given contract and account ID.
 * This object can be used to interact with the requirement's methods and data.
 *
 * @param contract The contract definition.
 * @param accountId The account ID of the requirement.
 * @param baseUrl The base URL to use for making public method calls. If not specified, only internal calls will be made within the cluster.
 */
export async function createRequirement<TContract extends Contract>(
  contract: TContract,
  accountId: string,
  loadAs?: Account,
): Promise<Requirement<TContract>> {
  // lookup contract data from account
  const account = await ReplicaAccount(undefined, { [contract.identity]: contract }).load(
    accountId,
    {
      loadAs,
      resolve: {
        profile: {
          contracts: {
            [contract.identity]: {
              $onError: "catch",
            },
            $onError: "catch",
          },
          $onError: "catch",
        },
      } as any,
    },
  )

  if (!account.$isLoaded) {
    throw new Error(
      `Account with ID "${accountId}" could not be loaded: ${account.$jazz.loadingState}`,
    )
  }

  if (!account.profile.$isLoaded) {
    throw new Error(`Account profile for account ID "${accountId}" is not loaded`)
  }

  // allow data to be undefined for seed replica to bootstrap correctly
  // TODO: handle this case better
  const data = (account.profile.contracts as any)?.[contract.identity]

  // the endpoint may change over time, all replicas should be ready to handle that
  let endpoint: string | undefined = account.profile.endpoint
  account.profile.$jazz.subscribe(profile => {
    endpoint = profile.endpoint
  })

  const replicaName = account.profile.name

  const methods = mapValues(contract.methods, (method, methodName) => {
    const send: ReturnType<typeof method.definition>["send"] = async (requestData, options) => {
      if (!endpoint) {
        throw new Error(
          `No endpoint defined for replica "${replicaName}" (account ID: ${accountId})`,
        )
      }

      // create "send" method on each request to always use the latest endpoint
      const fullUrl = `${endpoint}/replicas/${replicaName}/rpc/${contract.identity}/${methodName}`
      const definition = method.definition(fullUrl, accountId)

      return await definition.send(requestData, options)
    }

    return send
  })

  return {
    data,
    replicaId: account.profile.replicaId,
    accountId: account.$jazz.id,
    ...methods,
  } as Requirement<TContract>
}

/**
 * Starts a replica with the given definition and sets up whole lifecycle management.
 *
 * @param replica The replica definition to start.
 * @returns The replica context.
 */
export async function startReplica<
  TPrivateData extends BaseAccountShape["root"],
  TImplementations extends Record<string, Contract>,
  TRequirements extends Record<string, Contract>,
>(
  replica: ReplicaDefinition<TPrivateData, TImplementations, TRequirements>,
): Promise<ReplicaContext<TPrivateData, TImplementations, TRequirements>> {
  const config = loadConfig(CommonReplicaConfig)

  const { worker, shutdownWorker } = await startWorker({
    AccountSchema: ReplicaAccount(replica.privateData, replica.implementations),
    accountID: config.RESIDE_ACCOUNT_ID,
    accountSecret: config.RESIDE_AGENT_SECRET,
    syncServer: config.RESIDE_SYNC_SERVER_URL,
    skipInboxLoad: true,
  })

  const controlBlock = await loadControlBlock(config.RESIDE_CONTROL_BLOCK_ID)

  // populate replica account if needed and resolve all contracts
  const loadedWorker = await populateReplicaAccount(
    worker,
    replica,
    controlBlock.id,
    controlBlock.name,
  )

  const logger = pino({
    name: controlBlock.name,
    level: "debug",
  })

  type Context = ReplicaContext<TPrivateData, TImplementations, TRequirements>

  const contractMap = new Map<string, Contract>()
  const requirements: Record<string, any> = {}

  for (const contract of Object.values(replica.implementations ?? {})) {
    contractMap.set(contract.identity, contract)
  }

  const implementations = createImplementations(replica, loadedWorker, controlBlock, logger)

  // fill local requirements from control block
  for (const [key, requirement] of Object.entries(replica.requirements ?? {})) {
    requirements[key] = requirement.multiple
      ? await Promise.all(
          controlBlock.requirements[key]!.map(accountId =>
            createRequirement(requirement.contract, accountId),
          ),
        )
      : await createRequirement(requirement.contract, controlBlock.requirements[key]![0]!)
  }

  const reconcileControlBlockPermissionsHandler = singleConcurrencyFireAndForget(
    reconcileControlBlockPermissions,
  )

  await worker.$jazz.waitForAllCoValuesSync()

  // sync permissions on startup + set up listeners for future changes
  controlBlock.permissions.$jazz.subscribe(permissions => {
    reconcileControlBlockPermissionsHandler(worker, permissions, contractMap, logger)
  })

  process.on("SIGINT", async () => {
    logger.info("shutting down replica worker...")
    await worker.$jazz.waitForAllCoValuesSync()
    await shutdownWorker()
    process.exit(0)
  })

  const etcd = config.RESIDE_ETCD_HOSTS ? new Etcd3({ hosts: config.RESIDE_ETCD_HOSTS }) : undefined

  if (etcd) {
    try {
      // just to verify connection
      await etcd.getRoles()
      logger.debug("etcd ok")
    } catch (err) {
      throw new Error(`Failed to connect to etcd hosts: ${config.RESIDE_ETCD_HOSTS}`, {
        cause: err,
      })
    }
  } else {
    logger.debug("etcd not configured")
  }

  logger.info("replica worker started successfully")

  let hasMethods = false
  for (const contract of Object.values(replica.implementations ?? {})) {
    if (Object.keys(contract.methods).length > 0) {
      hasMethods = true
      break
    }
  }

  if (hasMethods) {
    const port = config.RESIDE_LISTEN_PORT ? parseInt(config.RESIDE_LISTEN_PORT, 10) : 8080

    startRpcServer(port, logger)
  }

  return {
    replicaId: controlBlock.id,
    replicaName: controlBlock.name,
    account: worker,
    implementations: implementations as Context["implementations"],
    requirements: requirements as Context["requirements"],
    logger,
    lockService: new EtcdLockService(etcd, logger) as LockService,
    shutdownWorker,
  }
}
