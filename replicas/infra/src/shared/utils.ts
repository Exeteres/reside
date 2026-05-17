export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

export function quoteLiteral(literal: string): string {
  return `'${literal.replaceAll("'", "''")}'`
}
