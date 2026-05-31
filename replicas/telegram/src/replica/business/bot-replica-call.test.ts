import { describe, expect, test } from "bun:test"
import { Code, ConnectError } from "@connectrpc/connect"
import { mapReplicaCallErrorMessage } from "./bot-replica-call"

describe("mapReplicaCallErrorMessage", () => {
  test("returns dead message for connect unavailable", () => {
    const error = new ConnectError("unavailable", Code.Unavailable)

    const result = mapReplicaCallErrorMessage(error, {
      deadMessage: "dead",
      brokenMessage: "broken",
    })

    expect(result).toBe("dead")
  })

  test("returns dead message for gateway-like text errors", () => {
    const result = mapReplicaCallErrorMessage(new Error("503 Bad Gateway"), {
      deadMessage: "dead",
      brokenMessage: "broken",
    })

    expect(result).toBe("dead")
  })

  test("returns broken message for non-gateway errors", () => {
    const result = mapReplicaCallErrorMessage(new Error("validation failed"), {
      deadMessage: "dead",
      brokenMessage: "broken",
    })

    expect(result).toBe("broken")
  })

  test("returns broken message for non-error unknown value", () => {
    const result = mapReplicaCallErrorMessage(
      { reason: "oops" },
      {
        deadMessage: "dead",
        brokenMessage: "broken",
      },
    )

    expect(result).toBe("broken")
  })
})
