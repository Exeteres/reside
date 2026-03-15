import { pino } from "pino"

export const logger = pino({
  name: process.env.REPLICA_COMPONENT_NAME,
  errorKey: "error",
  level: "debug",
})
