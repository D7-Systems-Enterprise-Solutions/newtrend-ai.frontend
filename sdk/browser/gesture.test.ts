import assert from 'node:assert/strict'
import { test } from 'node:test'
import { burstForSend, clickFollowsPress, startOnPointerDown, traceStateWithBurst } from './src/gesture.ts'

test('the second option starts a new press even inside the same select', () => {
  assert.equal(startOnPointerDown(true), true)
  assert.equal(startOnPointerDown(false), true)
})

test('the click that finishes a press does not start another one', () => {
  assert.equal(clickFollowsPress(true, false, false), true)
  assert.equal(clickFollowsPress(false, true, false), true)
  assert.equal(clickFollowsPress(false, false, true), true)
  assert.equal(clickFollowsPress(false, false, false), false)
})

test('a request opened by Water stays on Water when Electricity becomes current', () => {
  const water = 'burst-water'
  const electricity = 'burst-electricity'

  assert.equal(burstForSend(water, electricity, true), water)
  assert.equal(burstForSend(undefined, electricity, true), undefined)
  assert.equal(burstForSend(electricity, electricity, true), electricity)
  assert.equal(burstForSend(undefined, electricity, false), electricity)
})

test('tracestate keeps the burst that opened the request', () => {
  assert.equal(
    traceStateWithBurst('Newtrend-AI=burst-water,other=1', 'burst-electricity'),
    'Newtrend-AI=burst-electricity,other=1',
  )
  assert.equal(traceStateWithBurst('', 'burst-electricity'), 'Newtrend-AI=burst-electricity')
})
