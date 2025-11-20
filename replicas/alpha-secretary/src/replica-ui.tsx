import type { AlphaData, Replica } from "@contracts/alpha.v1"
import { createSubstitutor, resolveDisplayInfo } from "@reside/shared"
import type { MessageElement } from "@reside/telegram"
import { InlineKeyboard } from "grammy"
import type { co } from "jazz-tools"

const replicaResolve = {
  currentVersion: {
    requirements: {
      $each: {
        permissions: { $each: { permission: true } },
      },
    },
  },
  versions: { $each: true },
} as const

export async function renderReplica(replica: Replica, locale?: string): Promise<MessageElement> {
  const loadedReplica = await replica.$jazz.ensureLoaded({ resolve: replicaResolve })

  return ReplicaUI({ replica: loadedReplica, locale })
}

function ReplicaUI({
  replica,
  locale,
}: {
  replica: co.loaded<typeof Replica, typeof replicaResolve>
  locale?: string
}): MessageElement {
  const version = replica.currentVersion!
  const displayInfo = resolveDisplayInfo(version.displayInfo, locale)

  const allPermissions = Object.values(version.requirements).flatMap(ps =>
    ps.permissions.map(p => p),
  )

  const permissionTitles = allPermissions.map(p => {
    const substitutor = createSubstitutor(p.params as Record<string, string>)

    return substitutor(
      resolveDisplayInfo(p.permission.displayInfo, locale)?.title ?? p.permission.name,
    )
  })

  return (
    <div>
      <div>
        <b>{displayInfo?.title ?? replica.name}</b>
      </div>
      <div>{displayInfo?.description}</div>
      <br />
      <div>
        <b>ID:</b> <code>{replica.id}</code>
      </div>
      <div>
        <b>Техническое имя:</b> <code>{replica.name}</code>
      </div>
      <div>
        <b>Статус:</b> <code>{version.status}</code>
      </div>
      <div>
        <b>Текущая версия:</b> <code>{version.id}</code>
      </div>
      <div>
        <b>Класс:</b> <code>{replica.info.class}</code>
      </div>
      <div>
        <b>Эксклюзивная:</b> <code>{replica.info.exclusive.toString()}</code>
      </div>
      <div>
        <b>Масштабируемая:</b> <code>{replica.info.scalable.toString()}</code>
      </div>

      {permissionTitles.length > 0 && (
        <>
          <br />
          <ReplicaPermissions permissions={permissionTitles} locale={locale} />
        </>
      )}
    </div>
  )
}

export async function renderReplicaListKeyboard(alpha: AlphaData, locale?: string) {
  const loadedAlpha = await alpha.$jazz.ensureLoaded({
    resolve: {
      replicas: { $each: { currentVersion: true } },
    },
  })

  const keyboard = new InlineKeyboard()
  for (const replica of loadedAlpha.replicas.values()) {
    const displayInfo = resolveDisplayInfo(replica.currentVersion!.displayInfo, locale)

    keyboard.text(displayInfo?.title ?? replica.name, `alpha:replica:${replica.id}`).row()
  }

  return keyboard
}

function ReplicaPermissions({
  permissions,
  locale,
}: {
  permissions: string[]
  locale?: string
}): MessageElement {
  return (
    <div>
      <div>
        <b>Разрешения:</b>
      </div>
      {permissions.map((permission, index) => (
        <div>
          {index + 1}. {permission}
        </div>
      ))}
    </div>
  )
}
