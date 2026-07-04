---
name: reside-encryption
description: Use when code stores, processes, exposes, logs, routes, encrypts, hashes, decrypts, or sends personal information, ECIDs, RHIDs, Telegram/user/message identifiers, NLS memory, or LLM-facing data.
---

# ReSide Encryption and Personal Information Rules

## Core Requirements

- Every personal information value stored in a database must be encrypted or hashed.
- Use RHIDs when a replica needs to hash personal information.
- Use encryption when personal information must be recoverable.
- Personal information must never be stored as plaintext in Prisma models, JSON columns, logs, traces, NLS memory, workflow state, or external integration payloads unless the destination is explicitly designed and approved to receive plaintext.
- Non-encrypted and non-hashed personal information must never be logged.
- NLS and other LLM agent integrations must never be able to access personal information as plaintext.
- Code changes that add new fields, persistence paths, logs, NLS tools, agent tools, prompts, memories, or external integrations must check whether personal information can flow through them.

## Personal Information Definition

Personal information includes at least:

- All user-related identifiers from external systems, including Telegram user IDs, chat IDs, and message IDs.
- Obvious user personal information, including usernames and display names.
- User message content.

Replica-sent message content is not personal information when all personal information in that content is replaced with ECIDs.
For example, a notification template or workflow command text that contains `enc:<replica>:<id>` instead of a username or user-provided text may be stored as non-plaintext data.

The following values are not personal information by themselves:

- Identifiers and usernames of replica-managed bots, because these bots represent replicas and not users.
- Replica subject identifiers, including notification `callingSubjectId` and `sendAsSubjectId` values that can only refer to replicas.
- Canonical Telegram subject identifiers in the format `telegram:{id}`, where `{id}` is the Telegram replica database `User.id` and not a Telegram platform user ID.
- Approval request titles, approval request content, and approval resolution text.
- Operation titles, descriptions, failure messages, and custom data.
- Notification content and action rows when they are replica-sent message content with personal information replaced by ECIDs.

Do not duplicate recoverable encrypted storage for an external identifier when another encrypted payload already contains that identifier and a RHID is available for lookup.
For example, a Telegram chat record should use `telegramRhid` for one-way lookup and encrypted chat `dataEcid` for recoverable raw data; it does not need a separate `telegramIdEcid`.

## Prisma Modeling

- Use the `EncryptedContent` model for encrypted database storage.
- Replica Prisma schemas that store encrypted data must include an `EncryptedContent` model compatible with `packages/common/prisma/encryption.prisma`.
- Domain models must reference encrypted values by ECID fields and relations to `EncryptedContent`.
- Do not add plaintext personal information fields to domain models.
- Name ECID fields after the protected value, for example `dataEcid` or `messageTextEcid`.
- Add a relation field that makes the protected value explicit, for example `data EncryptedContent`.
- Add uniqueness to ECID fields when one encrypted value belongs to one domain record.

Example:

```prisma
model User {
  id Int @id @default(autoincrement())

  /// The ECID of the raw user payload.
  dataEcid String @unique()

  /// The encrypted raw user payload.
  data EncryptedContent @relation(name: "UserData", fields: [dataEcid], references: [ecid])
}
```

## RHID Modeling

RHID means replica hashed ID.
Use RHIDs when code needs to build a stable one-way identifier from personal information, for example to find a user by an external system identifier without storing that identifier as plaintext.

- RHID strings use the format `hash:{replicaName}:{cuidv2d}`.
- Use the `rhid(data)` function exported from `@reside/common`.
- The `rhid` function accepts `data: unknown`, serializes it with CBOR, and returns the RHID for the current replica.
- Do not implement replica-local hashing helpers for personal information identifiers.
- Store RHIDs in fields named after the protected value, for example `telegramRhid`.

Example:

```prisma
model User {
  id Int @id @default(autoincrement())

  /// The RHID of the Telegram user id.
  telegramRhid String @unique()
}
```

## Runtime Usage

- Use `ResideCrypto` from `@reside/common/encryption` to encrypt and decrypt values.
- Use `crypto.encrypt(value)` before storing personal information.
- Use `crypto.decrypt(schema, ecid)` only at the narrowest boundary that truly needs plaintext.
- Use the optional `crypto.decrypt(schema, ecid, reason)` parameter when decrypting a foreign-replica ECID and the transfer reason needs to be explicit.
- Validate decrypted values with a Zod schema passed to `decrypt`.
- Keep plaintext values in local scope only for the minimum work required.
- Do not pass decrypted values into NLS tools, LLM prompts, LLM memory, logs, traces, analytics, workflow search attributes, or broad context objects.

## ECID Transfer

Replicas expose `EncryptionService.Transfer` through `setupEncryption({ services, server })`.
This API accepts only ECIDs that belong to the serving replica and returns Vault ciphertexts re-encrypted for the authenticated caller replica, preserving input order.

- Foreign-replica ECIDs must be decrypted through `ResideCrypto.decrypt`, which requests `encryption:transfer` permission scoped to the source replica before calling `Transfer`.
- Transfer handlers must authenticate the caller replica and verify `encryption:transfer` access for the caller subject.
- Do not call `EncryptionService.Transfer` directly from business code unless implementing encryption infrastructure.
- Do not store transferred ciphertexts in domain models; store ECIDs instead.

## ECID Substitution

Messages sent through `sendNotification` automatically replace every ECID found in the message context with the decrypted content for the final external notification.

Because substitution happens at the final notification boundary, NLS agents and other commands may generate notification content that contains ECIDs instead of plaintext personal information.
Message content with ECIDs is safe to store in Temporal workflows or the database when every personal information value has been replaced by an ECID before storage.

- Do not decrypt ECIDs before passing notification content through NLS agents, commands, workflow state, or database persistence.
- Do not store the final substituted notification text after ECIDs have been replaced with plaintext.
- Treat ECID-bearing content as the safe internal representation and substituted plaintext as external-delivery-only data.
- Do not use RHIDs in outgoing message content when the recipient needs to see the original value.
- RHIDs are one-way hashes and cannot be substituted with plaintext.

## Business Logic

- Business functions that need encryption must accept `ResideCrypto` as an explicit dependency.
- Pass `ResideCrypto` as a dedicated positional argument.
- Do not import and use the process-wide `crypto` helper directly inside business methods.
- Unit tests must pass a mocked `ResideCrypto` so encryption and decryption behavior is easy to assert without Vault.

Example:

```typescript
import type { ResideCrypto } from "@reside/common/encryption";

export async function createUser(
  crypto: ResideCrypto,
  prisma: UserPrisma,
  userData: UserData,
): Promise<User> {
  const dataEcid = await crypto.encrypt(userData);

  return await prisma.user.create({
    data: {
      dataEcid,
    },
  });
}
```

## NLS and LLM Integrations

- NLS tools and other LLM agent integrations must operate on opaque IDs, ECIDs, counts, statuses, or already-redacted summaries.
- Do not expose decrypted personal information in tool results, prompt inputs, memory records, tool metadata, or diagnostic messages.
- If an LLM-facing workflow appears to require plaintext personal information, stop and redesign the workflow so the sensitive operation happens outside the LLM boundary.

## Logging

- Follow `reside-typescript` logging rules and additionally treat plaintext personal information as forbidden log data.
- Do not log decrypted values.
- Do not log request payloads, database records, DTOs, or context objects that may contain plaintext personal information.
- Prefer logging stable opaque identifiers such as internal IDs or ECIDs when diagnostics need correlation.
