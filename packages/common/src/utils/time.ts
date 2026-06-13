import { create } from "@bufbuild/protobuf"
import { DurationSchema } from "@bufbuild/protobuf/wkt"
import { type DateTime, DateTimeSchema } from "@reside/api/google/type/datetime"

/**
 * Converts a JavaScript Date into google.type.DateTime-compatible shape.
 *
 * @param date The date value to convert.
 * @returns A protobuf-compatible date time object.
 */
export function toProtoDateTime(date: Date): DateTime {
  return create(DateTimeSchema, {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hours: date.getUTCHours(),
    minutes: date.getUTCMinutes(),
    seconds: date.getUTCSeconds(),
    nanos: date.getUTCMilliseconds() * 1_000_000,
    timeOffset: {
      case: "utcOffset",
      value: create(DurationSchema, {
        seconds: 0n,
        nanos: 0,
      }),
    },
  })
}
