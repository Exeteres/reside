import { type KubernetesObject, KubernetesObjectApi, PatchStrategy } from "@kubernetes/client-node"
import { kubeConfig } from "./shared"

export async function applyObject(body: Record<string, unknown>): Promise<void> {
  const objectApi = KubernetesObjectApi.makeApiClient(kubeConfig)

  await objectApi.patch(
    body as KubernetesObject,
    undefined,
    undefined,
    "reside",
    true,
    PatchStrategy.ServerSideApply,
  )
}
