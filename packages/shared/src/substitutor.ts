import { mapValues } from "remeda"

export type Substitutor = <T>(something: T) => T

/**
 * Creates a substitutor function that replaces variables in the format `{name}` within all strings in the arbitrary input.
 *
 * @param variables The record of variables to substitute.
 */
export function createSubstitutor(variables: Record<string, string>): Substitutor {
  function substitutor<T>(something: T): T {
    if (typeof something === "string") {
      let result: string = something

      for (const [key, value] of Object.entries(variables)) {
        result = result.replaceAll(`{${key}}`, value)
      }

      return result as T
    }

    if (Array.isArray(something)) {
      return something.map(item => substitutor(item)) as T
    }

    if (typeof something === "object" && something !== null) {
      return mapValues(something, item => substitutor(item)) as T
    }

    return something
  }

  return substitutor
}
