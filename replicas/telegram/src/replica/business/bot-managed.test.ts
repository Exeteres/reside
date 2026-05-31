import { describe, expect, test } from "bun:test"
import {
  extractManagedBotCreatedEvent,
  extractManagedBotUpdatedEvent,
  isManagedBotUsernameAccepted,
  isManagedBotUsernamePattern,
} from "./bot-managed"

describe("extractManagedBotCreatedEvent", () => {
  test("extracts managed bot identity from direct message payload", () => {
    const payload = {
      message: {
        managed_bot_created: {
          id: 10,
          username: "reside_alpha_bot",
        },
      },
    }

    expect(extractManagedBotCreatedEvent(payload)).toEqual({
      managedBotId: "10",
      managedBotUsername: "reside_alpha_bot",
    })
  })

  test("extracts managed bot identity from nested bot payload", () => {
    const payload = {
      message: {
        managedBotCreated: {
          bot: {
            id: "11",
            username: "reside_beta_bot",
          },
        },
      },
    }

    expect(extractManagedBotCreatedEvent(payload)).toEqual({
      managedBotId: "11",
      managedBotUsername: "reside_beta_bot",
    })
  })

  test("returns undefined for malformed payload", () => {
    expect(extractManagedBotCreatedEvent({ message: {} })).toBeUndefined()
  })
})

describe("extractManagedBotUpdatedEvent", () => {
  test("extracts managed bot identity", () => {
    const payload = {
      managed_bot: {
        id: 15,
        username: "reside_gamma_bot",
      },
    }

    expect(extractManagedBotUpdatedEvent(payload)).toEqual({
      managedBotId: "15",
      managedBotUsername: "reside_gamma_bot",
    })
  })

  test("returns undefined for malformed payload", () => {
    expect(extractManagedBotUpdatedEvent({ managed_bot: {} })).toBeUndefined()
  })
})

describe("managed bot username helpers", () => {
  test("validates accepted usernames", () => {
    expect(isManagedBotUsernameAccepted("reside_alpha_helper_bot", "reside_alpha")).toBeTrue()
    expect(isManagedBotUsernameAccepted("alpha_bot", "reside_alpha")).toBeFalse()
    expect(isManagedBotUsernameAccepted("reside_alpha", "reside_alpha")).toBeFalse()
  })

  test("validates managed bot username pattern", () => {
    expect(isManagedBotUsernamePattern("reside_alpha_bot")).toBeTrue()
    expect(isManagedBotUsernamePattern("reside_alpha")).toBeFalse()
  })
})
