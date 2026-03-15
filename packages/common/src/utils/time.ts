import type { DateTime } from "@reside/api/google/type/datetime"

/**
 * Converts a JavaScript Date into google.type.DateTime-compatible shape.
 *
 * @param date The date value to convert.
 * @returns A protobuf-compatible date time object.
 */
export function toProtoDateTime(date: Date): DateTime {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hours: date.getUTCHours(),
    minutes: date.getUTCMinutes(),
    seconds: date.getUTCSeconds(),
    nanos: date.getUTCMilliseconds() * 1_000_000,
    timeOffset: {
      $case: "utcOffset",
      value: {
        seconds: "0",
        nanos: 0,
      },
    },
  }
}
