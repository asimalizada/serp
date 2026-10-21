import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveSession } from '../lib/session-response.ts';

const user = { id: 'user-1', email: 'person@example.com', timezone: 'America/Toronto' };

test('accepts the current user returned by /auth/me', async () => {
  const result = await resolveSession({
    kind: 'response',
    response: Response.json({ user }),
  });
  assert.deepEqual(result, { kind: 'authenticated', user });
});

test('treats expired credentials as unauthenticated', async () => {
  assert.deepEqual(await resolveSession({ kind: 'auth-expired' }), { kind: 'unauthenticated' });
  assert.deepEqual(await resolveSession({
    kind: 'response', response: new Response(null, { status: 401 }),
  }), { kind: 'unauthenticated' });
});

test('keeps network and server errors separate from logout', async () => {
  assert.deepEqual(await resolveSession({ kind: 'network-error' }), {
    kind: 'unavailable', reason: 'network',
  });
  assert.deepEqual(await resolveSession({ kind: 'server-error' }), {
    kind: 'unavailable', reason: 'server',
  });
  assert.deepEqual(await resolveSession({
    kind: 'response', response: new Response(null, { status: 503 }),
  }), { kind: 'unavailable', reason: 'server' });
  assert.deepEqual(await resolveSession({
    kind: 'response', response: Response.json({ user: { email: 'person@example.com' } }),
  }), { kind: 'unavailable', reason: 'server' });
  assert.deepEqual(await resolveSession({
    kind: 'response', response: new Response('invalid JSON'),
  }), { kind: 'unavailable', reason: 'server' });
});