import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toCurl } from './src/format.ts'

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
