import type { Mock } from "bun:test"

// biome-ignore lint/suspicious/noExplicitAny: mock functions accept arbitrary arguments
interface MockWithSpy<A extends any[], R> extends Mock<(...args: A) => R> {
  spy(): Mock<(...args: A) => R>
}

type _MockProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? T[K] & MockWithSpy<A, R> : T[K]
}

type MockProxy<T> = _MockProxy<T> & T

type _DeepMockProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? T[K] & MockWithSpy<A, R>
    : T[K] & _DeepMockProxy<T[K]>
}

type DeepMockProxy<T> = _DeepMockProxy<T> & T

// biome-ignore lint/suspicious/noExplicitAny: mock functions accept arbitrary arguments
type MockFnWithSpy = ((...args: any[]) => unknown) & {
  // biome-ignore lint/suspicious/noExplicitAny: spy returns a generic mock
  spy(): Mock<(...args: any[]) => unknown>
}

export type { DeepMockProxy, MockFnWithSpy, MockProxy }
