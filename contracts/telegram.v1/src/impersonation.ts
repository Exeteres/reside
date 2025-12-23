import type { Account } from "jazz-tools"
import type { ResideTelegramContext } from "./context"
import { createRequirement, type Requirement } from "@reside/shared"
import { TelegramRealm } from "./realm"

/**
 * Impersonates the user of the provided context with the specified requirements.
 *
 * @param ctx The Telegram context to impersonate the user from.
 * @param requirements The requirements to impersonate the user with.
 * @param handler The handler function to execute with the impersonated user and requirements.
 */
export async function impersonateContext<
  // biome-ignore lint/suspicious/noExplicitAny: to simplify types
  TRequirements extends Record<string, Requirement<any>>,
  TResult,
>(
  ctx: ResideTelegramContext,
  requirements: TRequirements,
  handler: (requirements: TRequirements, account: Account) => TResult | Promise<TResult>,
): Promise<TResult> {
  if (!ctx.user) {
    throw new Error("Cannot impersonate user: no user in context")
  }

  const loadedUser = await ctx.user.$jazz.ensureLoaded({ resolve: { user: true } })

  return await TelegramRealm.impersonate(loadedUser.user, async account => {
    // biome-ignore lint/suspicious/noExplicitAny: to simplify types
    const impersonated: Record<string, Requirement<any>> = {}

    for (const [key, requirement] of Object.entries(requirements)) {
      impersonated[key] = await createRequirement(
        requirement.contract,
        requirement.accountId,
        account,
      )
    }

    return await handler(impersonated as TRequirements, account)
  })
}
