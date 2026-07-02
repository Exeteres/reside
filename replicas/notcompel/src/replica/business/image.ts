import { NOTCOMPEL_IMAGE_FILE_NAME, NOTCOMPEL_IMAGE_URL } from "../../definitions"

const FALLBACK_CONTENT_TYPE = "image/jpeg"

export type FetchedNotcompelImage = {
  name: string
  content: Uint8Array
  contentType: string
}

type NotcompelImageFetcher = (input: string) => Promise<Response>

export async function fetchNotcompelImage(
  fetcher: NotcompelImageFetcher = fetch,
): Promise<FetchedNotcompelImage> {
  const response = await fetcher(NOTCOMPEL_IMAGE_URL)

  if (!response.ok) {
    throw new Error(`Failed to fetch Notcompel image: HTTP ${response.status}`)
  }

  const contentType = response.headers.get("content-type") ?? FALLBACK_CONTENT_TYPE
  const content = new Uint8Array(await response.arrayBuffer())

  if (content.length === 0) {
    throw new Error("Fetched Notcompel image is empty")
  }

  return {
    name: buildImageName(contentType),
    content,
    contentType,
  }
}

function buildImageName(contentType: string): string {
  const extension = contentTypeToExtension(contentType)

  if (!extension) {
    return NOTCOMPEL_IMAGE_FILE_NAME
  }

  return `${NOTCOMPEL_IMAGE_FILE_NAME}.${extension}`
}

function contentTypeToExtension(contentType: string): string | undefined {
  const normalizedContentType = contentType.split(";", 1)[0]?.trim().toLowerCase()

  switch (normalizedContentType) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg"
    case "image/png":
      return "png"
    case "image/gif":
      return "gif"
    case "image/webp":
      return "webp"
    default:
      return undefined
  }
}
