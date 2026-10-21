import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { apiRequest } from '../lib/api-client.ts';
import { timezoneDisplayName, timezoneValidationError, updateTimezone } from '../lib/timezone-settings.ts';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalOrigin = process.env.NEXT_PUBLIC_API_ORIGIN;

before(() => {
  globalThis.window = {};
  process.env.NEXT_PUBLIC_API_ORIGIN = 'http://api.test';
});

after(() => {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
  if (originalOrigin === undefined) delete process.env.NEXT_PUBLIC_API_ORIGIN;
  else process.env.NEXT_PUBLIC_API_ORIGIN = originalOrigin;
});

const user = {
  id: 'e4b18e18-fde2-4c03-bd07-dae9e1b17251',
  email: 'person@example.com',
  timezone: 'Asia/Baku',
};

test('validates IANA values with the shared schema and formats readable labels', () => {
  assert.equal(timezoneValidationError('America/Toronto'), null);
  assert.equal(timezoneValidationError('Asia/Baku'), null);
  assert.match(timezoneValidationError('Invalid/Nowhere'), /IANA timezone/);
  assert.match(timezoneValidationError(''), /required/);
  assert.equal(timezoneDisplayName('America/Argentina/Buenos_Aires'), 'Buenos Aires · Argentina · America');
});

test('saves the selected timezone once with credentials and accepts only the confirmed user', async () => {
  const calls = [];
  globalThis.fetch = async (request) => {
    calls.push({ method: request.method, path: new URL(request.url).pathname,
      credentials: request.credentials, body: await request.text() });
    return Response.json({ user });
  };
  assert.deepEqual(await updateTimezone(apiRequest, 'Asia/Baku', user.id), { kind: 'success', user });
  assert.deepEqual(calls, [{
    method: 'PATCH', path: '/users/me/timezone', credentials: 'include',
    body: JSON.stringify({ timezone: 'Asia/Baku' }),
  }]);

  globalThis.fetch = async () => Response.json({ user: { ...user, id: '8a480660-02e8-4e0e-a322-767e9b3ceb39' } });
  assert.deepEqual(await updateTimezone(apiRequest, 'Asia/Baku', user.id), { kind: 'uncertain' });
});

test('handles invalid values and expired authentication without claiming a save', async () => {
  globalThis.fetch = async () => new Response(null, { status: 400 });
  assert.deepEqual(await updateTimezone(apiRequest, 'Invalid/Nowhere', user.id), { kind: 'invalid-timezone' });
  assert.deepEqual(await updateTimezone(async () => ({ kind: 'auth-expired' }), 'Asia/Baku', user.id), { kind: 'auth-expired' });
});

test('does not replay a timezone PATCH after refresh', async () => {
  const calls = [];
  globalThis.fetch = async (request) => {
    const url = new URL(request instanceof Request ? request.url : request);
    calls.push(`${request instanceof Request ? request.method : 'POST'} ${url.pathname}`);
    return url.pathname === '/auth/refresh'
      ? new Response(null, { status: 200 })
      : new Response(null, { status: 401 });
  };
  assert.deepEqual(await updateTimezone(apiRequest, 'Asia/Baku', user.id), { kind: 'resubmit-required' });
  assert.deepEqual(calls, ['PATCH /users/me/timezone', 'POST /auth/refresh']);
});

test('keeps network and unconfirmed server outcomes separate from saved state', async () => {
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  assert.deepEqual(await updateTimezone(apiRequest, 'Asia/Baku', user.id), { kind: 'uncertain' });
  globalThis.fetch = async () => new Response(null, { status: 503 });
  assert.deepEqual(await updateTimezone(apiRequest, 'Asia/Baku', user.id), { kind: 'uncertain' });
  globalThis.fetch = async () => Response.json({ user: { ...user, timezone: 'UTC' } });
  assert.deepEqual(await updateTimezone(apiRequest, 'Asia/Baku', user.id), { kind: 'uncertain' });
});