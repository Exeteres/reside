import { describe, expect, test } from "bun:test"
import { CommandParameterType } from "@reside/api/interaction/definition.v1"
import { strings } from "../../locale"
import {
  parseBindingCommandText,
  parseClearContextCommandText,
  resolveBindingMessageThreadId,
  resolveBindingTopicInfo,
} from "./bot"
import {
  parseCommandInvocation,
  parseCommandParameters,
  parseLeadingMention,
  parseStoredCommandParameters,
  resolveNlsMessageThreadId,
} from "./bot-command"

describe("parseBindingCommandText", () => {
  test("parses channel name", () => {
    expect(
      parseBindingCommandText("/bind_notification_channel alerts", "bind_notification_channel"),
    ).toEqual({
      channel: "alerts",
    })
  })

  test("strips bot mention", () => {
    expect(
      parseBindingCommandText(
        "/bind_notification_channel@reside_bot alerts",
        "bind_notification_channel",
      ),
    ).toEqual({
      channel: "alerts",
    })
  })

  test("rejects topic id argument", () => {
    expect(
      parseBindingCommandText("/bind_notification_channel alerts 5", "bind_notification_channel"),
    ).toBeNull()
  })
})

describe("parseClearContextCommandText", () => {
  test("parses replica name", () => {
    expect(parseClearContextCommandText("/clear_context alpha")).toEqual({
      target: {
        kind: "replica",
        value: "alpha",
      },
    })
  })

  test("parses avatar mention", () => {
    expect(parseClearContextCommandText("/clear_context @alpha_bot")).toEqual({
      target: {
        kind: "mention",
        value: "alpha_bot",
      },
    })
  })

  test("strips manager bot mention", () => {
    expect(parseClearContextCommandText("/clear_context@reside_bot alpha")).toEqual({
      target: {
        kind: "replica",
        value: "alpha",
      },
    })
  })

  test("rejects missing and extra arguments", () => {
    expect(parseClearContextCommandText("/clear_context")).toBeNull()
    expect(parseClearContextCommandText("/clear_context alpha beta")).toBeNull()
  })
})

describe("resolveBindingMessageThreadId", () => {
  test("uses topic message thread id", () => {
    expect(
      resolveBindingMessageThreadId({
        is_topic_message: true,
        message_thread_id: 99,
      }),
    ).toBe(99)
  })

  test("ignores thread id outside topic message", () => {
    expect(
      resolveBindingMessageThreadId({
        message_thread_id: 99,
      }),
    ).toBeUndefined()
  })
})

describe("resolveBindingTopicInfo", () => {
  test("uses telegram topic title from topic creation message", () => {
    expect(
      resolveBindingTopicInfo(
        {
          is_topic_message: true,
          message_thread_id: 99,
          reply_to_message: {
            forum_topic_created: {
              name: "Updates",
            },
          },
        },
        "-1001",
      ),
    ).toEqual({
      chatId: "-1001",
      messageThreadId: 99,
      title: "Updates",
    })
  })
})

describe("parseCommandInvocation", () => {
  test("returns null for non-command text", () => {
    expect(parseCommandInvocation("hello world")).toBeNull()
  })

  test("parses command name and parameters", () => {
    expect(parseCommandInvocation("/create_task one two")).toEqual({
      name: "create_task",
      parameters: ["one", "two"],
    })
  })

  test("trims spaces and strips bot mention", () => {
    expect(parseCommandInvocation("   /create_task@reside_bot   one   two   ")).toEqual({
      name: "create_task",
      parameters: ["one", "two"],
    })
  })

  test("returns null when slash command has no command name", () => {
    expect(parseCommandInvocation("/")).toBeNull()
  })
})

describe("parseLeadingMention", () => {
  test("returns mention payload for leading mention", () => {
    expect(parseLeadingMention("@reside hello")).toEqual({
      username: "reside",
      prompt: "hello",
    })
  })

  test("returns null for non-leading mention", () => {
    expect(parseLeadingMention("hello @reside")).toBeNull()
  })
})

describe("resolveNlsMessageThreadId", () => {
  test("uses direct message_thread_id when provided", () => {
    expect(
      resolveNlsMessageThreadId({
        message_id: 10,
        message_thread_id: 99,
      }),
    ).toBe(99)
  })

  test("falls back to reply thread id", () => {
    expect(
      resolveNlsMessageThreadId({
        message_id: 10,
        reply_to_message: {
          message_thread_id: 77,
        },
      }),
    ).toBe(77)
  })

  test("falls back to message id for non-forum chats", () => {
    expect(
      resolveNlsMessageThreadId({
        message_id: 10,
      }),
    ).toBe(10)
  })
})

describe("parseStoredCommandParameters", () => {
  test("returns empty list for non-array input", () => {
    expect(parseStoredCommandParameters({})).toEqual([])
  })

  test("normalizes parameter records and filters invalid entries", () => {
    const parsed = parseStoredCommandParameters([
      {
        name: "task",
        title: "Task",
        description: "Task description",
        type: CommandParameterType.STRING,
        required: true,
        rest: true,
      },
      {
        name: "broken",
        type: CommandParameterType.INTEGER,
      },
      "invalid",
      null,
    ])

    expect(parsed).toEqual([
      {
        name: "task",
        title: "Task",
        description: "Task description",
        type: CommandParameterType.STRING,
        required: true,
        rest: true,
      },
    ])
  })
})

describe("parseCommandParameters", () => {
  test("returns empty object for invalid parameter schema", () => {
    expect(parseCommandParameters(null, ["value"])).toEqual({})
  })

  test("parses string, integer and boolean parameters", () => {
    const parameters = [
      {
        name: "name",
        title: "Name",
        type: CommandParameterType.STRING,
      },
      {
        name: "count",
        title: "Count",
        type: CommandParameterType.INTEGER,
      },
      {
        name: "enabled",
        title: "Enabled",
        type: CommandParameterType.BOOLEAN,
      },
    ]

    expect(parseCommandParameters(parameters, ["alice", "42", "true"])).toEqual({
      name: "alice",
      count: 42,
      enabled: true,
    })
  })

  test("parses boolean values from 1 and 0", () => {
    const parameters = [
      {
        name: "enabled",
        title: "Enabled",
        type: CommandParameterType.BOOLEAN,
      },
    ]

    expect(parseCommandParameters(parameters, ["1"])).toEqual({ enabled: true })
    expect(parseCommandParameters(parameters, ["0"])).toEqual({ enabled: false })
  })

  test("skips optional parameters when values are missing", () => {
    const parameters = [
      {
        name: "name",
        title: "Name",
        type: CommandParameterType.STRING,
      },
      {
        name: "description",
        title: "Description",
        type: CommandParameterType.STRING,
      },
    ]

    expect(parseCommandParameters(parameters, ["alice"])).toEqual({
      name: "alice",
    })
  })

  test("throws when required non-rest parameter is missing", () => {
    const parameters = [
      {
        name: "name",
        title: "Name",
        type: CommandParameterType.STRING,
        required: true,
      },
    ]

    expect(() => parseCommandParameters(parameters, [])).toThrow(
      strings.worker.bot.parameterRequired("name"),
    )
  })

  test("captures all remaining arguments into rest parameter", () => {
    const parameters = [
      {
        name: "target",
        title: "Target",
        type: CommandParameterType.STRING,
      },
      {
        name: "task",
        title: "Task",
        type: CommandParameterType.STRING,
        rest: true,
      },
    ]

    expect(parseCommandParameters(parameters, ["room-1", "make", "coffee", "please"])).toEqual({
      target: "room-1",
      task: "make coffee please",
    })
  })

  test("throws when required rest parameter is missing", () => {
    const parameters = [
      {
        name: "task",
        title: "Task",
        type: CommandParameterType.STRING,
        required: true,
        rest: true,
      },
    ]

    expect(() => parseCommandParameters(parameters, [])).toThrow(
      strings.worker.bot.parameterRequired("task"),
    )
  })

  test("throws for invalid integer value", () => {
    const parameters = [
      {
        name: "count",
        title: "Count",
        type: CommandParameterType.INTEGER,
      },
    ]

    expect(() => parseCommandParameters(parameters, ["abc"])).toThrow(
      strings.worker.bot.parameterMustBeInteger("count"),
    )
  })

  test("throws for invalid boolean value", () => {
    const parameters = [
      {
        name: "enabled",
        title: "Enabled",
        type: CommandParameterType.BOOLEAN,
      },
    ]

    expect(() => parseCommandParameters(parameters, ["yes"])).toThrow(
      strings.worker.bot.parameterMustBeBoolean("enabled"),
    )
  })

  test("throws when rest parameter is not last", () => {
    const parameters = [
      {
        name: "task",
        title: "Task",
        type: CommandParameterType.STRING,
        rest: true,
      },
      {
        name: "count",
        title: "Count",
        type: CommandParameterType.INTEGER,
      },
    ]

    expect(() => parseCommandParameters(parameters, ["one", "2"])).toThrow(
      strings.worker.bot.commandExecutionFailed,
    )
  })

  test("throws when multiple rest parameters are defined", () => {
    const parameters = [
      {
        name: "task",
        title: "Task",
        type: CommandParameterType.STRING,
        rest: true,
      },
      {
        name: "comment",
        title: "Comment",
        type: CommandParameterType.STRING,
        rest: true,
      },
    ]

    expect(() => parseCommandParameters(parameters, ["one", "two"])).toThrow(
      strings.worker.bot.commandExecutionFailed,
    )
  })
})
