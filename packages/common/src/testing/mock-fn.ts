import { type Mock, mock } from "bun:test"
import type { MockFnWithSpy, MockProxy } from "./types"

export function mockFn(): MockFnWithSpy
export function mockFn<T>(): MockProxy<T>
export function mockFn<T>(): MockProxy<T> | MockFnWithSpy {
  // biome-ignore lint/suspicious/noExplicitAny: required as it is automocking
  const mocks = new Map<string | symbol, Mock<any>>()
  const selfMock = mock()

  // biome-ignore lint/suspicious/noExplicitAny: proxy target needs to be callable with arbitrary args
  const target = Object.assign((..._args: any[]) => {}, {}) as any

  return new Proxy(target, {
    get: (_, prop) => {
      if (prop === "spy") {
        return () => selfMock
      }

      if (!mocks.has(prop)) {
        const regularMock = mock()

        const mockWithSpy = new Proxy(regularMock, {
          get: (mockTarget, spyProp) => {
            if (spyProp === "spy") {
              return () => mockTarget
            }

            // biome-ignore lint/suspicious/noExplicitAny: required as it is automocking
            const value = mockTarget[spyProp as keyof Mock<any>]
            return typeof value === "function" ? value.bind(mockTarget) : value
          },
          apply: (mockTarget, _thisArg, args) => {
            return mockTarget.apply(mockTarget, args)
          },
        })

        mocks.set(prop, mockWithSpy)
      }

      return mocks.get(prop)
    },
    apply: (_target, _thisArg, args) => {
      return selfMock(...args)
    },
  })
}
