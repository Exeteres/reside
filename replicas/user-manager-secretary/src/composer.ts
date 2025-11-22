import type { Logger } from "pino"
import { AlphaContract, getReplicasImplementingContract } from "@contracts/alpha.v1"
import { type ResideTelegramContext, TelegramContract, TelegramRealm } from "@contracts/telegram.v1"
import {
  getMe,
  getUserById,
  grantPermissionToUser,
  UserManagerContract,
} from "@contracts/user-manager.v1"
import { createRequirement, resolveDisplayInfo } from "@reside/shared"
import { Composer, InlineKeyboard } from "grammy"
import { GrantSession } from "./grant-session"
import { UserProfile } from "./profile-ui"

export function createComposer(
  umAccountId: string,
  alphaAccountId: string,
  telegramAccountId: string,
  _logger: Logger,
) {
  const composer = new Composer<ResideTelegramContext>()

  composer.command("profile", async ctx => {
    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const userManager = await createRequirement(UserManagerContract, umAccountId, account)

      const me = await getMe(userManager.data)
      if (!me) {
        await ctx.reply("Профиль не найден. Это странно. И грустно.")
        return
      }

      const loadedMe = await me.$jazz.ensureLoaded({
        resolve: { permissionSets: { $each: { permissions: { $each: { permission: true } } } } },
      })

      const allPermissions = loadedMe.permissionSets.flatMap(ps =>
        ps.permissions.map(p => p.permission),
      )

      const permissionTitles = allPermissions.map(
        p => resolveDisplayInfo(p.displayInfo, ctx.from?.language_code)?.title ?? p.name,
      )

      const profileMessage = UserProfile({
        telegramUser: ctx.user!,
        user: loadedMe,
        permissions: permissionTitles,
      })

      await ctx.reply(profileMessage.value, { parse_mode: "HTML" })
    })
  })

  composer.command("from", async ctx => {
    ctx.reply(JSON.stringify(ctx.from, null, 2))
  })

  // step 1: show user selection
  composer.command("grant", async ctx => {
    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const telegram = await createRequirement(TelegramContract, telegramAccountId, account)

      // try to load telegram users - access check
      const loadedTelegram = await telegram.data.$jazz.ensureLoaded({
        resolve: {
          users: { $each: { user: true } },
        },
      })

      if (!loadedTelegram.users.$isLoaded) {
        await ctx.reply("У вас нет доступа к списку пользователей.")
        return
      }

      const keyboard = new InlineKeyboard()
      for (const telegramUser of loadedTelegram.users.values()) {
        if (!telegramUser.$isLoaded || !telegramUser.user.$isLoaded) {
          continue
        }

        const userId = telegramUser.user.id
        let displayName = `User ID ${userId}`

        // use telegram username if available
        if (telegramUser.info.username) {
          displayName = `@${telegramUser.info.username}`
        } else {
          displayName = `${telegramUser.info.first_name} (ID ${userId})`
        }

        keyboard.text(displayName, `grant:user:${userId}`).row()
      }

      await ctx.reply("Выберите пользователя, которому хотите выдать разрешение:", {
        reply_markup: keyboard,
      })
    })
  })

  // step 2: user selected, create session and show contract selection
  composer.callbackQuery(/^grant:user:(\d+)$/, async ctx => {
    const userId = Number(ctx.match[1])

    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const alpha = await createRequirement(AlphaContract, alphaAccountId, account)
      const userManager = await createRequirement(UserManagerContract, umAccountId, account)

      // get target user
      const targetUser = await getUserById(userManager.data, userId)
      if (!targetUser) {
        await ctx.answerCallbackQuery({ text: "Пользователь не найден!", show_alert: true })
        return
      }

      // create grant session
      const session = GrantSession.create({
        targetUser,
        step: "select-contract",
      })

      // check access to contracts list
      const loadedAlpha = await alpha.data.$jazz.ensureLoaded({
        resolve: { contracts: { $each: true } },
      })

      if (!loadedAlpha.contracts.$isLoaded) {
        await ctx.answerCallbackQuery({ text: "У вас нет доступа к списку контрактов!" })
        return
      }

      const keyboard = new InlineKeyboard()
      for (const contract of loadedAlpha.contracts.values()) {
        if (!contract.$isLoaded) {
          continue
        }

        const displayInfo = resolveDisplayInfo(contract.displayInfo, ctx.from?.language_code)
        const title = displayInfo?.title ?? contract.identity

        // use session ID instead of encoding data in callback
        keyboard.text(title, `grant:contract:${session.$jazz.id}:${contract.id}`).row()
      }

      await ctx.editMessageText("Выберите контракт:", { reply_markup: keyboard })
      await ctx.answerCallbackQuery()
    })
  })

  // step 3: contract selected, show permission selection
  composer.callbackQuery(/^grant:contract:([^:]+):(\d+)$/, async ctx => {
    const sessionId = ctx.match[1]
    const contractId = Number(ctx.match[2])

    if (!sessionId) {
      await ctx.answerCallbackQuery({ text: "Неверные параметры!", show_alert: true })
      return
    }

    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const alpha = await createRequirement(AlphaContract, alphaAccountId, account)

      // load session
      const session = await GrantSession.load(sessionId, { loadAs: account })
      if (!session || !session.$isLoaded) {
        await ctx.answerCallbackQuery({ text: "Сессия не найдена!", show_alert: true })
        return
      }

      // check access to contracts
      const loadedAlpha = await alpha.data.$jazz.ensureLoaded({
        resolve: { contracts: { $each: true } },
      })

      if (!loadedAlpha.contracts.$isLoaded) {
        await ctx.answerCallbackQuery({ text: "Нет доступа к контрактам!", show_alert: true })
        return
      }

      const contract = Array.from(loadedAlpha.contracts.values()).find(
        c => c.$isLoaded && c.id === contractId,
      )

      if (!contract || !contract.$isLoaded) {
        await ctx.answerCallbackQuery({ text: "Контракт не найден!", show_alert: true })
        return
      }

      // update session with contract
      session.$jazz.set("contract", contract)
      session.$jazz.set("step", "select-permission")

      const loadedContract = await contract.$jazz.ensureLoaded({
        resolve: { permissions: { $each: true } },
      })

      const keyboard = new InlineKeyboard()
      for (const permName of Object.keys(loadedContract.permissions)) {
        const permission = loadedContract.permissions[permName]
        if (!permission) {
          continue
        }

        const displayInfo = resolveDisplayInfo(permission.displayInfo, ctx.from?.language_code)
        const title = displayInfo?.title ?? permName

        // encode permission name to handle special characters
        const encodedPermName = Buffer.from(permName).toString("base64url")

        keyboard.text(title, `grant:perm:${sessionId}:${encodedPermName}`).row()
      }

      await ctx.editMessageText("Выберите разрешение:", { reply_markup: keyboard })
      await ctx.answerCallbackQuery()
    })
  })

  // step 4: permission selected, grant it
  composer.callbackQuery(/^grant:perm:([^:]+):([A-Za-z0-9_-]+=*)$/, async ctx => {
    const sessionId = ctx.match[1]
    const encodedPermissionName = ctx.match[2]

    if (!sessionId || !encodedPermissionName) {
      await ctx.answerCallbackQuery({ text: "Неверные параметры запроса!", show_alert: true })
      return
    }

    // decode permission name from base64url
    const permissionName = Buffer.from(encodedPermissionName, "base64url").toString("utf-8")

    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const alpha = await createRequirement(AlphaContract, alphaAccountId, account)
      const userManager = await createRequirement(UserManagerContract, umAccountId, account)

      // load session
      const session = await GrantSession.load(sessionId, { loadAs: account })
      if (!session || !session.$isLoaded) {
        await ctx.answerCallbackQuery({ text: "Сессия не найдена!", show_alert: true })
        return
      }

      const loadedSession = await session.$jazz.ensureLoaded({
        resolve: { targetUser: true, contract: { permissions: { $each: true } } },
      })

      if (!loadedSession.contract || !loadedSession.contract.$isLoaded) {
        await ctx.answerCallbackQuery({ text: "Контракт не найден в сессии!", show_alert: true })
        return
      }

      const permission = loadedSession.contract.permissions[permissionName]
      if (!permission) {
        await ctx.answerCallbackQuery({ text: "Разрешение не найдено!", show_alert: true })
        return
      }

      // load target user with permissions
      const targetUser = await getUserById(userManager.data, loadedSession.targetUser.id)
      if (!targetUser) {
        await ctx.answerCallbackQuery({
          text: "Пользователь не найден в системе!",
          show_alert: true,
        })
        return
      }

      const loadedTargetUser = await targetUser.$jazz.ensureLoaded({
        resolve: {
          permissionSets: {
            $each: {
              contract: true,
              replicas: { $each: true },
              permissions: { $each: { permission: true } },
            },
          },
        },
      })

      // check if user has permission to manage user permissions
      if (!loadedTargetUser.permissionSets.$isLoaded) {
        await ctx.answerCallbackQuery({
          text: "У вас нет доступа к управлению разрешениями этого пользователя!",
          show_alert: true,
        })
        return
      }

      const replicas = await getReplicasImplementingContract(alpha.data, loadedSession.contract.id)

      if (replicas.length === 0) {
        await ctx.answerCallbackQuery({
          text: "Нет реплик, реализующих этот контракт!",
          show_alert: true,
        })
        return
      }

      const result = await grantPermissionToUser(
        loadedTargetUser,
        loadedSession.contract,
        permission,
        replicas,
      )

      // update session
      session.$jazz.set("step", "completed")

      if (result.action === "duplicate") {
        await ctx.editMessageText(
          `⚠️ Разрешение "${permissionName}" уже существует в наборе разрешений для пользователя ID ${loadedSession.targetUser.id}.`,
        )
      } else if (result.action === "added") {
        await ctx.editMessageText(
          `✅ Разрешение "${permissionName}" добавлено в существующий набор разрешений для пользователя ID ${loadedSession.targetUser.id}.`,
        )
      } else {
        await ctx.editMessageText(
          `✅ Создан новый набор разрешений и выдано разрешение "${permissionName}" пользователю ID ${loadedSession.targetUser.id}.`,
        )
      }

      await ctx.answerCallbackQuery()
    })
  })

  return composer
}
