import assert from 'node:assert/strict'
import { test } from 'node:test'
import { httpQueryLines, toCurl } from './src/format.ts'

test('curl includes the bearer token and skips the body on GET', () => {
  const curl = toCurl({
    name: 'GET /api/communications/channels/options',
    httpUrl: 'https://host/api/communications/channels/options?active=true',
    httpHeaders: 'Authorization: Bearer eyJ.token\nAccept: application/json',
    httpBody: '{"ignored":true}',
  })

  assert.equal(
    curl,
    "curl.exe -X GET 'https://host/api/communications/channels/options?active=true' -H 'Authorization: Bearer eyJ.token' -H 'Accept: application/json'",
  )
})

test('localhost https skips certificate verification', () => {
  const curl = toCurl({
    name: 'GET /api/reference/pet-types/grid',
    httpUrl: 'https://localhost:7029/api/reference/pet-types/grid?pageNumber=1',
    httpHeaders: 'Authorization: Bearer eyJ.token',
  })

  assert.equal(
    curl,
    "curl.exe -k -X GET 'https://localhost:7029/api/reference/pet-types/grid?pageNumber=1' -H 'Authorization: Bearer eyJ.token'",
  )
})

test('curl on the browser step includes the bearer token recorded by the API', () => {
  const curl = toCurl({
    name: 'GET /api/v1/telemetry-laboratories',
    httpUrl: 'http://localhost:8080/api/v1/telemetry-laboratories',
    httpHeaders: 'Accept: application/json',
  }, [
    {
      name: 'GET /api/v1/telemetry-laboratories',
      httpUrl: 'http://localhost:8080/api/v1/telemetry-laboratories',
      httpHeaders: 'Authorization: Bearer eyJ.token\nAccept: application/json',
    },
  ])

  assert.equal(
    curl,
    "curl.exe -X GET 'http://localhost:8080/api/v1/telemetry-laboratories' -H 'Authorization: Bearer eyJ.token' -H 'Accept: application/json'",
  )
})

test('query lines list each parameter from the request url', () => {
  const lines = httpQueryLines(
    'https://localhost:7029/api/business/utility-meters/list-crud?pageNumber=1&pageSize=20&sortField=code&sortDirection=asc&projectId=c9bd77a0-c4d5-469f-92a2-b6b160e75798&utilityTypeId=61043b33-1aa4-4a66-94ab-0f8cd5c57e40',
  )

  assert.equal(
    lines,
    [
      'pageNumber=1',
      'pageSize=20',
      'sortField=code',
      'sortDirection=asc',
      'projectId=c9bd77a0-c4d5-469f-92a2-b6b160e75798',
      'utilityTypeId=61043b33-1aa4-4a66-94ab-0f8cd5c57e40',
    ].join('\n'),
  )
})

test('query lines are empty when the url has no query', () => {
  assert.equal(httpQueryLines('https://host/api/meters'), null)
  assert.equal(httpQueryLines(''), null)
  assert.equal(httpQueryLines(null), null)
})

test('query lines decode parameter values', () => {
  assert.equal(httpQueryLines('https://host/api/search?q=hello%20world&tag=a%26b'), 'q=hello world\ntag=a&b')
})

test('curl sends the body for POST and escapes quotes', () => {
  const curl = toCurl({
    name: 'POST /providers',
    httpUrl: 'https://host/providers',
    httpHeaders: 'Content-Type: application/json',
    httpBody: '{"name":"O\'Brien"}',
  })

  assert.equal(
    curl,
    'curl.exe -X POST \'https://host/providers\' -H \'Content-Type: application/json\' --data-raw \'{"name":"O\'\'Brien"}\'',
  )
})
