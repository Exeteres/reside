import { describe, expect, test } from "bun:test"
import {
  validateChannelDefinitions,
  validateCommandDefinitions,
  validateUniqueNames,
} from "./definition"

describe("validateChannelDefinitions", () => {
  test("passes for unique channel names", () => {
    expect(() => {
      validateChannelDefinitions([
        { name: "alerts", title: "Alerts" },
        { name: "events", title: "Events" },
      ])
    }).not.toThrow()
  })

  test("throws for duplicate channel names", () => {
    expect(() => {
      validateChannelDefinitions([
        { name: "alerts", title: "Alerts" },
        { name: "alerts", title: "Alerts Duplicate" },
      ])
    }).toThrow('Field "channels" contains duplicate name "alerts"')
  })
})

describe("validateCommandDefinitions", () => {
  test("passes for valid commands", () => {
    expect(() => {
      validateCommandDefinitions([
        {
          name: "hello",
          title: "Hello",
          callbackEndpoint: "http://example",
          parameters: [
            {
              name: "name",
              title: "Name",
              type: "STRING",
            },
          ],
        },
      ])
    }).not.toThrow()
  })

  test("throws when callback endpoint is empty", () => {
    expect(() => {
      validateCommandDefinitions([
        {
          name: "hello",
          title: "Hello",
          callbackEndpoint: "   ",
          parameters: [],
        },
      ])
    }).toThrow('Command "hello" must provide non-empty callback_endpoint')
  })

  test("throws when rest parameter is not last", () => {
    expect(() => {
      validateCommandDefinitions([
        {
          name: "hello",
          title: "Hello",
          callbackEndpoint: "http://example",
          parameters: [
            {
              name: "tail",
              title: "Tail",
              type: "STRING",
              rest: true,
            },
            {
              name: "next",
              title: "Next",
              type: "STRING",
            },
          ],
        },
      ])
    }).toThrow('Command "hello" must declare rest parameter as the last parameter')
  })

  test("throws when command names are duplicated", () => {
    expect(() => {
      validateCommandDefinitions([
        {
          name: "hello",
          title: "Hello",
          callbackEndpoint: "http://example",
          parameters: [],
        },
        {
          name: "hello",
          title: "Hello Again",
          callbackEndpoint: "http://example",
          parameters: [],
        },
      ])
    }).toThrow('Field "commands" contains duplicate name "hello"')
  })
})

describe("validateUniqueNames", () => {
  test("throws when a name is empty after trim", () => {
    expect(() => {
      validateUniqueNames(["ok", "   "], "test")
    }).toThrow('Field "test" contains empty name')
  })
})
