export type ParameterPiece = {
  text: string
  parameter: boolean
}

const sqlLiteral = /N?'(?:[^']|'')*'|(?<![\w.])\d+(?:\.\d+)?(?![\w.])/g
const queryValue = /(^|[?&\n])([^=\s?&'"\n]+)=([^&\n'"]*)/g

/** Values a person passed in: SQL literals, and the value side of name=value. */
export function parameterPieces(text: string, kind: 'sql' | 'query'): ParameterPiece[] {
  const pattern = kind === 'sql' ? sqlLiteral : queryValue
  const pieces: ParameterPiece[] = []
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    const value = kind === 'query' ? match[3] ?? '' : match[0]
    const valueStart = start + match[0].length - value.length
    if (valueStart > cursor) pieces.push({ text: text.slice(cursor, valueStart), parameter: false })
    if (value) pieces.push({ text: value, parameter: true })
    cursor = valueStart + value.length
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), parameter: false })
  if (pieces.length === 0) pieces.push({ text, parameter: false })
  return pieces
}
