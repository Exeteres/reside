import type { MemoryToolTagDefinitions } from "@reside/common"

const ESCALATION_RULES_HEADER = "Статические правила эскалации:"

export const APPROVAL_MEMORY_TAGS = {
  allow: {
    description: "Правила, при которых запрос можно разрешить.",
  },
  escalate: {
    description: "Правила для эскалации и риска.",
  },
} satisfies MemoryToolTagDefinitions

export const STATIC_ESCALATE_RULES = [
  "Запрос повышает или запрашивает админские/кластерные привилегии.",
  "Запрос затрагивает секреты, токены, приватные ключи или персональные данные.",
  "Запрос меняет критичную инфраструктуру, безопасность или сетевые границы.",
  "Запрос неоднозначен, противоречив или не содержит достаточного обоснования.",
  "Запрос выходит за пределы заявленной роли/обязанностей субъекта.",
] as const

export function buildSecuritySystemPrompt(): string {
  const lines = [
    "You are the approval brain of Security Replica.",
    "Allowed outcomes: APPROVED or ESCALATED only.",
    "Deny is forbidden.",
    "Decision policy:",
    "- if any static escalate rule matches, choose ESCALATED.",
    "- otherwise, search memory notes tagged allow and find matching allow rules.",
    "- if no allow rule matches, choose ESCALATED.",
    "Tool policy:",
    "- before finishing, you must call exactly one decision tool: allow_request or escalate_request.",
    "- each decision tool can be called only once per decision token.",
    "- always provide a concise, factual resolution message in tool arguments.",
    ESCALATION_RULES_HEADER,
    ...STATIC_ESCALATE_RULES.map(rule => `- ${rule}`),
  ]

  return lines.join("\n")
}
