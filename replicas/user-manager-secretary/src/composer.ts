import type { Logger } from "pino"
import {
  AlphaContract,
  GrantedPermission,
  getContractEntityByIdentity,
  getReplicasImplementingContract,
} from "@contracts/alpha.v1"
import { type ResideTelegramContext, TelegramRealm } from "@contracts/telegram.v1"
import {
  createGrantedPermissionSet,
  getMe,
  getUserById,
  UserManagerContract,
} from "@contracts/user-manager.v1"
import { createRequirement, resolveDisplayInfo } from "@reside/shared"
import { Composer, InlineKeyboard } from "grammy"
import { UserProfile } from "./profile-ui"

export function createComposer(umAccountId: string, alphaAccountId: string, _logger: Logger) {
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

  // /grant command - step 1: show user selection
  composer.command("grant", async ctx => {
    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const userManager = await createRequirement(UserManagerContract, umAccountId, account)

      const loadedUserManager = await userManager.data.$jazz.ensureLoaded({
        resolve: { users: { $each: true } },
      })

      if (!loadedUserManager.users.$isLoaded) {
        await ctx.reply("У вас нет доступа к списку пользователей.")
        return
      }

      const keyboard = new InlineKeyboard()
      for (const user of loadedUserManager.users.values()) {
        // display user ID
        const displayName = `User ID ${user.id}`

        keyboard.text(displayName, `grant:user:${user.id}`).row()
      }

      await ctx.reply("Выберите пользователя, которому хотите выдать разрешение:", {
        reply_markup: keyboard,
      })
    })
  })

  // step 2: user selected, show contract selection
  composer.callbackQuery(/^grant:user:(\d+)$/, async ctx => {
    const userId = Number(ctx.match[1])

    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const alpha = await createRequirement(AlphaContract, alphaAccountId, account)

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

        keyboard.text(title, `grant:contract:${userId}:${contract.identity}`).row()
      }

      await ctx.editMessageText("Выберите контракт:", { reply_markup: keyboard })
      await ctx.answerCallbackQuery()
    })
  })

  // step 3: contract selected, show permission selection
  composer.callbackQuery(/^grant:contract:(\d+):(.+)$/, async ctx => {
    const userId = Number(ctx.match[1])
    const contractIdentity = ctx.match[2]

    if (!contractIdentity) {
      await ctx.answerCallbackQuery({ text: "Неверные параметры запроса!", show_alert: true })
      return
    }

    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const alpha = await createRequirement(AlphaContract, alphaAccountId, account)

      const contractEntity = await getContractEntityByIdentity(alpha.data, contractIdentity)
      if (!contractEntity) {
        await ctx.answerCallbackQuery({ text: "Контракт не найден!", show_alert: true })
        return
      }

      const loadedContract = await contractEntity.$jazz.ensureLoaded({
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

        keyboard.text(title, `grant:perm:${userId}:${contractIdentity}:${permName}`).row()
      }

      await ctx.editMessageText("Выберите разрешение:", { reply_markup: keyboard })
      await ctx.answerCallbackQuery()
    })
  })

  // step 4: permission selected, grant it
  composer.callbackQuery(/^grant:perm:(\d+):(.+):(.+)$/, async ctx => {
    const userId = Number(ctx.match[1])
    const contractIdentity = ctx.match[2]
    const permissionName = ctx.match[3]

    if (!contractIdentity || !permissionName) {
      await ctx.answerCallbackQuery({ text: "Неверные параметры запроса!", show_alert: true })
      return
    }

    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const alpha = await createRequirement(AlphaContract, alphaAccountId, account)
      const userManager = await createRequirement(UserManagerContract, umAccountId, account)

      const contractEntity = await getContractEntityByIdentity(alpha.data, contractIdentity)
      if (!contractEntity) {
        await ctx.answerCallbackQuery({ text: "Контракт не найден!", show_alert: true })
        return
      }

      const loadedContract = await contractEntity.$jazz.ensureLoaded({
        resolve: { permissions: { $each: true } },
      })

      const permission = loadedContract.permissions[permissionName]
      if (!permission) {
        await ctx.answerCallbackQuery({ text: "Разрешение не найдено!", show_alert: true })
        return
      }

      const user = await getUserById(userManager.data, userId)
      if (!user) {
        await ctx.answerCallbackQuery({
          text: "Пользователь не найден в системе!",
          show_alert: true,
        })
        return
      }

      const loadedTargetUser = await user.$jazz.ensureLoaded({
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

      const replicas = await getReplicasImplementingContract(alpha.data, contractEntity.id)

      if (replicas.length === 0) {
        await ctx.answerCallbackQuery({
          text: "Нет реплик, реализующих этот контракт!",
          show_alert: true,
        })
        return
      }

      // find existing permission set for this contract
      const existingPermissionSet = loadedTargetUser.permissionSets.find(
        ps => ps.contract.id === contractEntity.id,
      )

      const newPermission = GrantedPermission.create({
        requestType: "manual",
        status: "approved",
        permission,
        instanceId: undefined,
        params: {},
      })

      if (existingPermissionSet) {
        // add permission to existing set
        newPermission.$jazz.owner.addMember(existingPermissionSet.$jazz.owner, "reader")
        existingPermissionSet.permissions.$jazz.push(newPermission)

        await ctx.editMessageText(
          `✅ Разрешение "${permissionName}" добавлено в существующий набор разрешений для пользователя ID ${userId}.`,
        )
      } else {
        // create new permission set
        await createGrantedPermissionSet(
          loadedTargetUser.permissionSets,
          contractEntity,
          replicas,
          [newPermission],
        )

        await ctx.editMessageText(
          `✅ Создан новый набор разрешений и выдано разрешение "${permissionName}" пользователю ID ${userId}.`,
        )
      }

      await ctx.answerCallbackQuery()
    })
  })

  return composer
}
