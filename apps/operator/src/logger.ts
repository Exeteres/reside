import pino from "pino"

export const logger = pino({
  name: "reside-operator",
  level: process.env.LOG_LEVEL ?? "info",
})
