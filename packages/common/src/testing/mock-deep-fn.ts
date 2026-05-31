import { type Mock, mock } from "bun:test"
import type { DeepMockProxy } from "./types"

export const mockDeepFn = <T extends object>(): DeepMockProxy<T> => {
  const createDeepMock = <U extends object>(): DeepMockProxy<U> => {
    // biome-ignore lint/suspicious/noExplicitAny: required as it is automocking
    const mocks = new Map<string | symbol, any>()

    return new Proxy({} as DeepMockProxy<U>, {
      get: (_target, prop) => {
        if (!mocks.has(prop)) {
          const hybridMock = createHybridMock()
          mocks.set(prop, hybridMock)
        }

        return mocks.get(prop)
      },
    })
  }

  const createHybridMock = () => {
    const regularMock = mock()
    const deepMock = createDeepMock()

    return new Proxy(regularMock, {
      get: (target, prop) => {
        if (typeof prop === "string" && prop.startsWith("mock")) {
          // biome-ignore lint/suspicious/noExplicitAny: required as it is automocking
          const method = target[prop as keyof Mock<any>]
          return typeof method === "function" ? method.bind(target) : method
        }

        if (prop === "spy") {
          return () => target
        }

        // biome-ignore lint/suspicious/noExplicitAny: required as it is automocking
        return (deepMock as any)[prop]
      },

      apply: (target, _thisArg, args) => {
        return target.apply(target, args)
      },
    })
  }

  return createDeepMock<T>()
}
