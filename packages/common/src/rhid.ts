import { createHash } from "node:crypto"
import { Buffer } from "node:buffer"
import { encode } from "cbor2"
import { getReplicaName } from "./kubernetes"

const RESIDE_UUID = "73125ded-94c9-4876-94db-fb5ce285fcfa"
const RHID_PREFIX = "hash"
const CUIDV2D_DEFAULT_LENGTH = 24

/**
 * Generates a replica hashed ID for the given data.
 *
 * @param data The personal information value used as the one-way identity input.
 * @returns The RHID string in `hash:{replicaName}:{cuidv2d}` format.
 */
export function rhid(data: unknown): string {
  const replicaName = getReplicaName()
  const namespace = `${RESIDE_UUID}:${replicaName}`
  const identity = encode(data)
  const cuid = createCuidv2d(namespace, identity)

  return `${RHID_PREFIX}:${replicaName}:${cuid}`
}

function createCuidv2d(namespace: string, identity: Uint8Array): string {
  const digest = createHash("sha256")
    .update(namespace)
    .update(":")
    .update(Buffer.from(identity))
    .digest()
  const hashed = bufToBigInt(digest).toString(36).slice(1)
  const raw = hashed.slice(0, CUIDV2D_DEFAULT_LENGTH)
  const prefix = normalizeCuid2Prefix(raw[0]!)

  return `${prefix}${raw.slice(1)}`
}

function bufToBigInt(buf: Uint8Array): bigint {
  const bits = 8n

  let value = 0n
  for (const byte of buf.values()) {
    value = (value << bits) + BigInt(byte)
  }

  return value
}

function normalizeCuid2Prefix(prefix: string): string {
  if (prefix >= "a" && prefix <= "z") {
    return prefix
  }

  if (prefix >= "0" && prefix <= "9") {
    const digit = prefix.charCodeAt(0) - "0".charCodeAt(0)
    return String.fromCharCode("a".charCodeAt(0) + digit)
  }

  throw new Error(`Invalid CUID prefix character: ${prefix}`)
}
