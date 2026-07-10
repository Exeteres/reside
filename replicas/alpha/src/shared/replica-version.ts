type ReplicaVersion = {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

const REPLICA_VERSION_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function shouldUpdateReplicaImage(args: {
  requestedImage: string
  clusterImage: string | null
}): boolean {
  if (args.clusterImage === null) {
    return true
  }

  const requestedVersion = parseReplicaVersion(extractContainerImageTag(args.requestedImage))
  if (requestedVersion === null) {
    return false
  }

  const clusterVersion = parseReplicaVersion(extractContainerImageTag(args.clusterImage))
  if (clusterVersion === null) {
    return true
  }

  return compareReplicaVersions(requestedVersion, clusterVersion) > 0
}

export function extractContainerImageTag(image: string): string | null {
  const digestStartIndex = image.indexOf("@")
  const imageWithoutDigest = digestStartIndex === -1 ? image : image.slice(0, digestStartIndex)

  const lastSlashIndex = imageWithoutDigest.lastIndexOf("/")
  const lastColonIndex = imageWithoutDigest.lastIndexOf(":")
  if (lastColonIndex === -1 || lastColonIndex < lastSlashIndex) {
    return null
  }

  const tag = imageWithoutDigest.slice(lastColonIndex + 1).trim()
  return tag.length > 0 ? tag : null
}

function parseReplicaVersion(version: string | null): ReplicaVersion | null {
  if (version === null) {
    return null
  }

  const match = REPLICA_VERSION_PATTERN.exec(version)
  if (match === null) {
    return null
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? [],
  }
}

function compareReplicaVersions(left: ReplicaVersion, right: ReplicaVersion): number {
  const majorDifference = left.major - right.major
  if (majorDifference !== 0) {
    return majorDifference
  }

  const minorDifference = left.minor - right.minor
  if (minorDifference !== 0) {
    return minorDifference
  }

  const patchDifference = left.patch - right.patch
  if (patchDifference !== 0) {
    return patchDifference
  }

  return comparePrereleaseVersions(left.prerelease, right.prerelease)
}

function comparePrereleaseVersions(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0
  }

  if (left.length === 0) {
    return 1
  }

  if (right.length === 0) {
    return -1
  }

  const maxLength = Math.max(left.length, right.length)
  for (let index = 0; index < maxLength; index += 1) {
    const leftIdentifier = left[index]
    const rightIdentifier = right[index]

    if (leftIdentifier === undefined) {
      return -1
    }

    if (rightIdentifier === undefined) {
      return 1
    }

    const identifierComparison = comparePrereleaseIdentifiers(leftIdentifier, rightIdentifier)
    if (identifierComparison !== 0) {
      return identifierComparison
    }
  }

  return 0
}

function comparePrereleaseIdentifiers(left: string, right: string): number {
  const leftNumber = parsePrereleaseNumber(left)
  const rightNumber = parsePrereleaseNumber(right)

  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber - rightNumber
  }

  if (leftNumber !== null) {
    return -1
  }

  if (rightNumber !== null) {
    return 1
  }

  return left.localeCompare(right)
}

function parsePrereleaseNumber(identifier: string): number | null {
  if (!/^(?:0|[1-9]\d*)$/.test(identifier)) {
    return null
  }

  return Number(identifier)
}
