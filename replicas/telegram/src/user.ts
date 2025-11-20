import type { User } from "grammy/types"
import { getTelegramUserById, type TelegramData, TelegramRealm } from "@contracts/telegram.v1"
import { TelegramUser } from "@contracts/telegram-handler.v1"
import { box } from "@reside/shared"

export async function getOrCreateTelegramUser(
  telegramData: TelegramData,
  userInfo: User,
): Promise<TelegramUser> {
  // TODO: lock here?

  const user = await getTelegramUserById(telegramData, userInfo.id)
  if (user) {
    // ensure username mapping is up to date
    if (user.info.username !== userInfo.username) {
      // add correct username mapping
      box(TelegramUser).create(
        { value: user },
        {
          owner: telegramData.$jazz.owner,
          unique: `user.by-username.${userInfo.username}`,
        },
      )

      // TODO: remove old username mapping?
    }

    return user
  }

  const loadedTelegramData = await telegramData.$jazz.ensureLoaded({
    resolve: { users: true },
  })

  const umUser = await TelegramRealm.createUser(userInfo.username ?? `telegram:${userInfo.id}`)

  const newUser = TelegramUser.create({
    info: userInfo,
    user: umUser,
  })

  // create index to lookup by Telegram user id
  box(TelegramUser).create(
    { value: newUser },
    {
      owner: telegramData.$jazz.owner,
      unique: `user.by-id.${userInfo.id}`,
    },
  )

  // create index to lookup by username if available
  if (userInfo.username) {
    box(TelegramUser).create(
      { value: newUser },
      {
        owner: telegramData.$jazz.owner,
        unique: `user.by-username.${userInfo.username}`,
      },
    )
  }

  // add to list of users
  loadedTelegramData.users.$jazz.push(newUser)

  // allow accounts with access to users list to read the Telegram user
  newUser.$jazz.owner.addMember(loadedTelegramData.users.$jazz.owner, "reader")

  return newUser
}
