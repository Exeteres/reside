import {
  type DisplayInfo,
  type LocalizedDisplayInfo,
  resolveDisplayInfo as _resolveDisplayInfo,
} from "@reside/shared"

export function resolveDisplayInfo(
  info: LocalizedDisplayInfo | undefined | null,
): DisplayInfo | undefined {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale

  return _resolveDisplayInfo(info, locale)
}
