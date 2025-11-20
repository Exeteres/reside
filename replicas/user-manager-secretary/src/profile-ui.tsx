import type { TelegramUser } from "@contracts/telegram-handler.v1"
import type { User } from "@contracts/user-manager.v1"
import type { MessageElement } from "@reside/telegram"

export function UserProfile({
  telegramUser,
  user,
  permissions,
}: {
  telegramUser: TelegramUser
  user: User
  permissions: string[]
}): MessageElement {
  return (
    <div>
      <div>
        <b>=== Telegram ===</b>
      </div>
      <div>
        <b>User ID: </b> <code>{telegramUser.info.id}</code>
      </div>

      {telegramUser.info.username && (
        <div>
          <b>Username: </b> <code>@{telegramUser.info.username}</code>
        </div>
      )}

      <br />
      <div>
        <b>=== User Manager ===</b>
      </div>
      <div>
        <b>ID: </b> <code>{user.id}</code>
      </div>
      <div>
        <b>Account ID: </b> <code>{user.account.$jazz.id}</code>
      </div>

      {permissions.length > 0 && (
        <div>
          <div>
            <b>Permissions:</b>
          </div>

          {permissions.map((permission, index) => (
            <div>
              {index + 1}. {permission}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
