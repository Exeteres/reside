import type { ResideTelegramContext } from "@contracts/telegram.v1"
import type { Logger } from "pino"
import type { StreamerService } from "./service"
import { Composer } from "grammy"

export function createComposer(
  _streamer: StreamerService,
  _logger: Logger,
): Composer<ResideTelegramContext> {
  const composer = new Composer<ResideTelegramContext>()

  return composer
}
