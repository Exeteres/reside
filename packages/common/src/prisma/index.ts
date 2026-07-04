import { userInfo } from "node:os"
import { defineConfig } from "prisma/config"

export function definePrismaConfig() {
  const user = userInfo().username

  return defineConfig({
    schema: "prisma",
    migrations: {
      path: "prisma/migrations",
    },
    datasource: {
      url:
        process.env.DATABASE_URL ??
        `postgresql://${user}@localhost/${user}?host=${process.env.PGHOST}/`,
      shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
    },
  })
}
