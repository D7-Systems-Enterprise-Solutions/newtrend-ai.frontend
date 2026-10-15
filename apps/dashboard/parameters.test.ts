import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parameterPieces } from './src/parameters.ts'

function values(text: string, kind: 'sql' | 'query'): string[] {
  return parameterPieces(text, kind).filter((piece) => piece.parameter).map((piece) => piece.text)
}

test('sql literals and numbers are parameters', () => {
  const sql = [
    "WHERE [u0].[WorkspaceId] = '71e76511-5789-41da-8fff-8fef1fd67dea'",
    'AND [u].[IsDeleted] = CAST(0 AS bit)',
    'OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY',
  ].join('\n')

  assert.deepEqual(values(sql, 'sql'), [
    "'71e76511-5789-41da-8fff-8fef1fd67dea'",
    '0',
    '0',
    '20',
  ])
})

test('query values are parameters and the names stay plain', () => {
  const lines = 'pageNumber=1\npageSize=20\nutilityTypeId=61043b33-1aa4-4a66-94ab-0f8cd5c57e40'
  const pieces = parameterPieces(lines, 'query')
  assert.deepEqual(values(lines, 'query'), ['1', '20', '61043b33-1aa4-4a66-94ab-0f8cd5c57e40'])
  assert.equal(pieces.some((piece) => piece.text.includes('pageNumber=') && !piece.parameter), true)
})

test('a url keeps the path plain and marks each query value', () => {
  const url = "GET 'https://localhost:7029/api/business/utility-meters/list-crud?pageNumber=1&sortField=code'"
  assert.deepEqual(values(url, 'query'), ['1', 'code'])
  assert.equal(parameterPieces(url, 'query').some((piece) => piece.text.includes('7029') && piece.parameter), false)
})
