import type { Logger } from "pino"
import { type ResideTelegramContext, TelegramRealm } from "@contracts/telegram.v1"
import { getMe, UserManagerContract } from "@contracts/user-manager.v1"
import { createRequirement, resolveDisplayInfo } from "@reside/shared"
import { Composer } from "grammy"
import { UserProfile } from "./profile-ui"

export function createComposer(umAccountId: string, _logger: Logger) {
  const composer = new Composer<ResideTelegramContext>()

  composer.command("profile", async ctx => {
    const loadedUser = await ctx.user!.$jazz.ensureLoaded({ resolve: { user: true } })

    await TelegramRealm.impersonate(loadedUser.user, async account => {
      const userManager = await createRequirement(
        UserManagerContract,
        umAccountId,
        undefined,
        account,
      )

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

  return composer
}
