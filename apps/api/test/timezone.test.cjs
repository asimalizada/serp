const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const { localDateBounds } = require('../dist/pages/pages.service.js');

test('local calendar-day bounds follow DST transitions', () => {
  const spring = DateTime.fromISO('2026-03-08', { zone: 'America/Toronto' });
  const springBounds = localDateBounds(spring, spring);
  assert.equal(springBounds.start.toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(springBounds.end.toISOString(), '2026-03-09T04:00:00.000Z');
  const fall = DateTime.fromISO('2026-11-01', { zone: 'America/Toronto' });
  const fallBounds = localDateBounds(fall, fall);
  assert.equal(fallBounds.start.toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(fallBounds.end.toISOString(), '2026-11-02T05:00:00.000Z');
});