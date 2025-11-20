import type { Logger } from "pino"
import {
  type AlphaData,
  type CreateLoadRequestInput,
  getReplicaById,
  getReplicaByName,
  getReplicasByIdentity,
  getReplicasImplementingContract,
  type Replica,
  ReplicaLoadApproveRequest,
  ReplicaLoadRequest,
  ReplicaPreResolvedRequirement,
} from "@contracts/alpha.v1"
import { box, createSubstitutor, errorToString } from "@reside/shared"
import { type Account, co, Group, JazzRequestError } from "jazz-tools"
import { refreshContractEntity } from "./contract-management"
import { fetchImageDigest, fetchResideManifest, formatImage, parseImage } from "./docker"

export async function createLoadRequest(
  alphaData: AlphaData,
  input: CreateLoadRequestInput,
  requestedAs: Account,
): Promise<ReplicaLoadRequest> {
  const loadedAlphaData = await alphaData.$jazz.ensureLoaded({
    resolve: { loadRequests: true },
  })

  // resolve owner account
  let owner = requestedAs
  if (input.ownerId) {
    const ownerAccount = await co
      .account()
      .load(input.ownerId, { loadAs: alphaData.$jazz.loadedAs })

    if (!ownerAccount.$isLoaded) {
      throw new JazzRequestError(`Failed to load owner account with ID "${input.ownerId}"`, 400)
    }

    owner = ownerAccount
  }

  const parsedImage = parseImage(input.image)

  // resolve existing replica
  let existingReplica: Replica | undefined

  const identityReplicas = await getReplicasByIdentity(alphaData, parsedImage.identity)

  if (identityReplicas[0]?.info.exclusive) {
    // if there is already an exclusive replica with the same identity, update that one ignoring what the user requested
    existingReplica = identityReplicas[0]
  } else if (input.replicaId) {
    // otherwise, if user requested specific replica ID, update that one

    const loadedReplica = await getReplicaById(alphaData, input.replicaId)
    if (!loadedReplica) {
      throw new JazzRequestError(`Failed to load replica with ID "${input.replicaId}"`, 400)
    }

    if (loadedReplica.identity !== parsedImage.identity) {
      throw new JazzRequestError(
        `Replica ID "${input.replicaId}" has identity "${loadedReplica.identity}" which does not match the requested image identity "${parsedImage.identity}"`,
        400,
      )
    }

    existingReplica = loadedReplica
  }

  // create new load request from inbox request
  const loadRequest = ReplicaLoadRequest.create(
    {
      id: loadedAlphaData.loadRequests.length + 1,
      status: "validating",

      image: input.image,
      owner,
      existingReplica,
      requestedName: input.name,
    },
    Group.create(alphaData.$jazz.loadedAs as Account),
  )

  // add to alpha's load requests
  loadedAlphaData.loadRequests.$jazz.push(loadRequest)

  // allow accounts with "load-request:read:all" permission to read the load request
  loadRequest.$jazz.owner.addMember(loadedAlphaData.loadRequests.$jazz.owner, "reader")

  // create index entry to look up all load request by ID
  box(ReplicaLoadRequest).create(
    { value: loadRequest },
    {
      unique: `load-request.by-id.${loadRequest.id}`,
      owner: alphaData.$jazz.owner,
    },
  )

  return loadRequest
}

export async function validateLoadRequest(
  alpha: AlphaData,
  loadRequest: ReplicaLoadRequest,
  logger: Logger,
  fetchResideManifestFn: typeof fetchResideManifest = fetchResideManifest,
  fetchImageDigestFn: typeof fetchImageDigest = fetchImageDigest,
): Promise<void> {
  try {
    const approveRequest = await createApproveRequest(
      alpha,
      loadRequest,
      logger,
      fetchResideManifestFn,
      fetchImageDigestFn,
    )

    loadRequest.$jazz.set("status", "requires-approval")
    loadRequest.$jazz.set("approveRequest", approveRequest)

    logger.info("load request #%d validated and requires approval", loadRequest.id)
  } catch (err) {
    logger.error({ err }, "failed to validate load request #%d", loadRequest.id)

    loadRequest.$jazz.set("status", "invalid")
    loadRequest.$jazz.set("errorMessage", errorToString(err))
  }
}

async function createApproveRequest(
  alpha: AlphaData,
  loadRequest: ReplicaLoadRequest,
  logger: Logger,
  fetchResideManifestFn: typeof fetchResideManifest,
  fetchImageDigestFn: typeof fetchImageDigest,
): Promise<ReplicaLoadApproveRequest> {
  const parsedImage = parseImage(loadRequest.image)
  parsedImage.tag = undefined // not important

  // fetch digest if not provided
  parsedImage.digest ??= await fetchImageDigestFn(loadRequest.image)

  // fetch and validate the image manifest
  const manifest = await fetchResideManifestFn(formatImage(parsedImage))

  if (manifest.type !== "replica") {
    throw new Error(
      `Invalid replica image: manifest type is "${manifest.type}", expected "replica".`,
    )
  }

  if (manifest.identity !== parsedImage.identity) {
    throw new Error(
      `Invalid replica image: manifest identity "${manifest.identity}" does not match actual image identity "${parsedImage.identity}".`,
    )
  }

  const loadedLoadRequest = await loadRequest.$jazz.ensureLoaded({
    resolve: { existingReplica: true },
  })

  const suggestedName =
    loadedLoadRequest.existingReplica?.name ??
    (await getAvailableName(alpha, loadRequest.requestedName ?? manifest.info.name))

  // create approve request
  const approveRequest = ReplicaLoadApproveRequest.create(
    {
      identity: manifest.identity,
      digest: parsedImage.digest,
      name: suggestedName,
      info: manifest.info,
      displayInfo: manifest.displayInfo,
      implementations: {},
      requirements: {},
    },
    loadRequest.$jazz.owner,
  )

  // resolve placeholders in requirements
  const substitutor = createSubstitutor({
    "replica.name": approveRequest.name,
  })

  // fetch and validate contracts to satisfy requirements
  for (const [reqKey, req] of Object.entries(manifest.requirements)) {
    const contractEntity = await refreshContractEntity(
      alpha,
      req.identity,
      logger,
      fetchResideManifestFn,
    )
    const replicas = await getReplicasImplementingContract(alpha, contractEntity.id)

    if (replicas.length === 0 && !req.optional) {
      throw new Error(
        `No replicas found implementing required contract "${req.identity}" for requirement "${reqKey}". Load required replicas first.`,
      )
    }

    const loadedContract = await contractEntity.$jazz.ensureLoaded({
      resolve: {
        permissions: { $each: true },
      },
    })

    const requirement = ReplicaPreResolvedRequirement.create(
      {
        contract: contractEntity,

        replicas: req.multiple ? replicas : replicas.slice(0, 1),
        alternatives: replicas,

        multiple: req.multiple ?? false,
        optional: req.optional ?? false,

        permissions: req.permissions.map(permission => {
          const contractPermission = loadedContract.permissions[permission.name]
          if (!contractPermission) {
            throw new Error(
              `Contract "${loadedContract.identity}" does not define permission "${permission.name}" required by replica "${manifest.identity}".`,
            )
          }

          return {
            status: "pending",
            requestType: "static",
            permission: contractPermission,
            instanceId: substitutor(permission.instanceId),
            // biome-ignore lint/suspicious/noExplicitAny: too complex types
            params: substitutor(permission.params) as any,
          }
        }),
      },
      approveRequest.$jazz.owner,
    )

    approveRequest.requirements.$jazz.set(reqKey, requirement)
  }

  // fetch contracts for implementations
  const implementedIdentities = new Set<string>()

  for (const [implKey, impl] of Object.entries(manifest.implementations)) {
    if (implementedIdentities.has(impl.identity)) {
      throw new Error(
        `Duplicate implementation identity "${impl.identity}" found in replica manifest for implementation "${implKey}". Replica cannot implement the same contract multiple times.`,
      )
    }

    implementedIdentities.add(impl.identity)

    const contractEntity = await refreshContractEntity(
      alpha,
      impl.identity,
      logger,
      fetchResideManifestFn,
    )

    const loadedContract = await contractEntity.$jazz.ensureLoaded({
      resolve: {
        permissions: { $each: true },
        methods: { $each: true },
      },
    })

    approveRequest.implementations.$jazz.set(implKey, loadedContract)
  }

  // allow all accounts with read access to load requests to also read approve request
  approveRequest.$jazz.owner.addMember(loadRequest.$jazz.owner, "reader")

  return approveRequest
}

async function hasConflictingReplica(alpha: AlphaData, name: string): Promise<boolean> {
  const existingReplica = await getReplicaByName(alpha, name)
  if (existingReplica) {
    return true
  }

  const loadedAlpha = await alpha.$jazz.ensureLoaded({
    resolve: {
      loadRequests: { $each: { approveRequest: true } },
    },
  })

  const existingLoadRequest = Object.values(loadedAlpha.loadRequests).find(
    request =>
      request?.approveRequest?.name === name &&
      request.status !== "rejected" &&
      request.status !== "invalid",
  )

  return !!existingLoadRequest
}

async function getAvailableName(alpha: AlphaData, name: string): Promise<string> {
  const hasConflict = await hasConflictingReplica(alpha, name)
  if (!hasConflict) {
    return name
  }

  let nextCounter = 1
  let baseName = name

  const parts = name.match(/^(.*?)-(\d+)$/)
  if (parts) {
    baseName = parts[1]!
    nextCounter = parseInt(parts[2]!, 10) + 1
  }

  while (nextCounter < 1000) {
    const candidateName = `${baseName}-${nextCounter}`
    const hasConflict = await hasConflictingReplica(alpha, candidateName)

    if (!hasConflict) {
      return candidateName
    }

    nextCounter += 1
  }

  throw new Error(
    `Unable to find available replica name after 1000 attempts: base name "${baseName}"`,
  )
}
