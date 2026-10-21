const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  normalizeHttpUrl,
  normalizeDomain,
  isPublicIp,
  resolveWithin,
  validateDestination,
} = require('../dist/crawler/http/url-safety.js');
const {
  SafeHttpClient,
  undiciTransport,
} = require('../dist/crawler/http/safe-http.client.js');

test('normalizeHttpUrl validates protocols, removes hashes, and enforces ports and credentials', () => {
  // Valid URLs
  assert.equal(normalizeHttpUrl('https://example.com/blog#section'), 'https://example.com/blog');
  assert.equal(normalizeHttpUrl('http://example.com:80/path'), 'http://example.com/path');
  assert.equal(normalizeHttpUrl('https://example.com:443/'), 'https://example.com/');
  assert.equal(normalizeHttpUrl('  https://example.com/clean  '), 'https://example.com/clean');

  // Invalid protocol
  assert.throws(() => normalizeHttpUrl('ftp://example.com'), /credential-free HTTP\(S\)/);
  assert.throws(() => normalizeHttpUrl('javascript:alert(1)'), /Only credential-free HTTP\(S\) URLs are allowed/);
  assert.throws(() => normalizeHttpUrl('file:///etc/passwd'), /credential-free HTTP\(S\)/);

  // Credentials forbidden
  assert.throws(() => normalizeHttpUrl('http://admin:secret@example.com/'), /credential-free HTTP\(S\)/);
  assert.throws(() => normalizeHttpUrl('http://user@example.com/'), /credential-free HTTP\(S\)/);

  // Non-standard ports forbidden
  assert.throws(() => normalizeHttpUrl('http://example.com:8080/'), /Unsafe HTTP port/);
  assert.throws(() => normalizeHttpUrl('https://example.com:8443/'), /Unsafe HTTP port/);
  assert.throws(() => normalizeHttpUrl('http://example.com:22/'), /Unsafe HTTP port/);

  // Malformed URLs
  assert.throws(() => normalizeHttpUrl('not a url'), /Invalid website URL/);
  assert.throws(() => normalizeHttpUrl(''), /Invalid website URL/);
});

test('normalizeDomain extracts and canonicalizes hostname without leading www', () => {
  assert.equal(normalizeDomain('https://www.example.com/blog'), 'example.com');
  assert.equal(normalizeDomain('http://EXAMPLE.COM/'), 'example.com');
  assert.equal(normalizeDomain('https://blog.example.co.uk/articles'), 'blog.example.co.uk');
  assert.equal(normalizeDomain('https://www.sub.domain.com/'), 'sub.domain.com');
});

test('isPublicIp strictly permits only public unicast addresses and rejects private, loopback, and link-local', () => {
  // Valid public unicast
  assert.equal(isPublicIp('93.184.215.14'), true);
  assert.equal(isPublicIp('8.8.8.8'), true);
  assert.equal(isPublicIp('1.1.1.1'), true);
  assert.equal(isPublicIp('2607:f8b0:4005:805::200e'), true);

  // Loopback
  assert.equal(isPublicIp('127.0.0.1'), false);
  assert.equal(isPublicIp('127.0.1.1'), false);
  assert.equal(isPublicIp('::1'), false);

  // RFC 1918 Private networks
  assert.equal(isPublicIp('10.0.0.1'), false);
  assert.equal(isPublicIp('10.254.254.254'), false);
  assert.equal(isPublicIp('172.16.0.1'), false);
  assert.equal(isPublicIp('172.31.255.255'), false);
  assert.equal(isPublicIp('192.168.1.1'), false);
  assert.equal(isPublicIp('192.168.0.254'), false);

  // Link-local / Cloud metadata (AWS, GCP, Azure metadata service)
  assert.equal(isPublicIp('169.254.169.254'), false);
  assert.equal(isPublicIp('fe80::1'), false);

  // Carrier-Grade NAT (RFC 6598)
  assert.equal(isPublicIp('100.64.0.1'), false);

  // Unspecified & broadcast
  assert.equal(isPublicIp('0.0.0.0'), false);
  assert.equal(isPublicIp('255.255.255.255'), false);
  assert.equal(isPublicIp('::'), false);

  // IPv4-mapped IPv6 addresses
  assert.equal(isPublicIp('::ffff:127.0.0.1'), false);
  assert.equal(isPublicIp('::ffff:169.254.169.254'), false);
  assert.equal(isPublicIp('::ffff:10.0.0.1'), false);
  assert.equal(isPublicIp('::ffff:192.168.1.1'), false);

  // Malformed IP strings
  assert.equal(isPublicIp('not-an-ip'), false);
  assert.equal(isPublicIp(''), false);
});

test('validateDestination enforces public addresses and rejects mixed public/private DNS answers', async () => {
  // Public destination passes
  const publicResolver = async () => [{ address: '93.184.215.14', family: 4 }];
  const res = await validateDestination('https://example.com/articles', publicResolver);
  assert.equal(res.url, 'https://example.com/articles');
  assert.equal(res.addresses[0].address, '93.184.215.14');

  // Private destination rejected
  const privateResolver = async () => [{ address: '127.0.0.1', family: 4 }];
  await assert.rejects(
    validateDestination('http://localhost:80/', privateResolver),
    /Unsafe destination: localhost/,
  );

  // Direct IP literal in URL rejected if private
  await assert.rejects(
    validateDestination('http://127.0.0.1/admin'),
    /Unsafe destination: 127.0.0.1/,
  );
  await assert.rejects(
    validateDestination('http://169.254.169.254/latest/meta-data/'),
    /Unsafe destination: 169.254.169.254/,
  );

  // Mixed DNS answers (one public, one private) must be strictly rejected
  const mixedResolver = async () => [
    { address: '93.184.215.14', family: 4 },
    { address: '10.0.0.1', family: 4 },
  ];
  await assert.rejects(
    validateDestination('https://rebind-test.com/', mixedResolver),
    /Unsafe destination: rebind-test.com/,
  );

  // Empty DNS answers rejected
  const emptyResolver = async () => [];
  await assert.rejects(
    validateDestination('https://nonexistent.domain/', emptyResolver),
    /Unsafe destination: nonexistent.domain/,
  );
});

test('resolveWithin enforces timeout and abort signal propagation', async () => {
  // Timeout triggers
  const hangingResolver = () => new Promise(() => {});
  await assert.rejects(
    resolveWithin(hangingResolver, 'slow.example.com', 50),
    /DNS lookup timed out/,
  );

  // Abort signal cancels lookup
  const abortController = new AbortController();
  const promise = resolveWithin(hangingResolver, 'abort.example.com', 5000, abortController.signal);
  abortController.abort();
  await assert.rejects(promise, /DNS lookup aborted/);
});

test('SafeHttpClient enforces redirect limits, validates every hop, and prevents HTTPS downgrade', async () => {
  let hops = 0;
  const mockTransport = async (url) => {
    hops++;
    if (url === 'https://example.com/initial') {
      return { status: 301, contentType: 'text/html', body: Buffer.alloc(0), location: 'https://example.com/step1' };
    }
    if (url === 'https://example.com/step1') {
      return { status: 302, contentType: 'text/html', body: Buffer.alloc(0), location: 'http://example.com/downgrade' };
    }
    return { status: 200, contentType: 'text/html', body: Buffer.from('OK') };
  };

  const resolver = async () => [{ address: '93.184.215.14', family: 4 }];
  const client = new SafeHttpClient(resolver, mockTransport);

  // HTTPS downgrade attempt rejected
  await assert.rejects(
    client.get('https://example.com/initial', 10000),
    /HTTPS downgrade redirect refused/,
  );
  assert.equal(hops, 2);

  // Redirect to private IP rejected
  const redirectToPrivate = async () => ({
    status: 302,
    contentType: 'text/html',
    body: Buffer.alloc(0),
    location: 'http://169.254.169.254/secret',
  });
  const client2 = new SafeHttpClient(resolver, redirectToPrivate);
  await assert.rejects(
    client2.get('http://example.com/entry', 10000),
    /Unsafe destination: 169.254.169.254/,
  );

  // Too many redirects rejected (> 5)
  let loopCount = 0;
  const redirectLoop = async () => {
    loopCount++;
    return {
      status: 302,
      contentType: 'text/html',
      body: Buffer.alloc(0),
      location: `https://example.com/loop-${loopCount}`,
    };
  };
  const client3 = new SafeHttpClient(resolver, redirectLoop);
  await assert.rejects(
    client3.get('https://example.com/loop-0', 10000),
    /Too many redirects/,
  );
  assert.equal(loopCount, 6);
});

// Controlled local HTTP test fixtures
test('Real Undici transport tests against controlled local HTTP server', async (t) => {
  let server;
  let port;

  await new Promise((resolve) => {
    server = http.createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<html><body>Hello World</body></html>');
      } else if (req.url === '/large') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        // Send 10KB
        res.end('A'.repeat(10240));
      } else if (req.url === '/hang') {
        // Never respond to test timeout / cancellation
      } else if (req.url === '/slow') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('part1');
        setTimeout(() => res.end('part2'), 500);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });

  after(() => {
    server.close();
  });

  const address = { address: '127.0.0.1', family: 4 };

  await t.test('undiciTransport successfully fetches response with pinned address', async () => {
    const res = await undiciTransport(`http://127.0.0.1:${port}/ok`, address, 10000);
    assert.equal(res.status, 200);
    assert.equal(res.contentType, 'text/html; charset=utf-8');
    assert.equal(res.body.toString('utf8'), '<html><body>Hello World</body></html>');
  });

  await t.test('undiciTransport enforces maxBytes response size limit during streaming', async () => {
    await assert.rejects(
      undiciTransport(`http://127.0.0.1:${port}/large`, address, 2048),
      /Response exceeds 2048 bytes/,
    );
  });

  await t.test('undiciTransport respects caller AbortSignal cancellation', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const start = Date.now();
    await assert.rejects(
      undiciTransport(`http://127.0.0.1:${port}/hang`, address, 10000, controller.signal),
      (err) => err.name === 'AbortError' || /aborted/i.test(err.message),
    );
    assert.ok(Date.now() - start < 1000, 'Abort should cancel promptly');
  });

  await t.test('SafeHttpClient gracefully aborts and cleans up resources on application shutdown', async () => {
    let agentCreated = false;
    const client = new SafeHttpClient(
      async () => [{ address: '93.184.215.14', family: 4 }],
      // Custom transport simulating active agent connection
      async (_url, _addr, _maxBytes, signal) => {
        return undiciTransport(
          `http://127.0.0.1:${port}/hang`,
          address,
          10000,
          signal,
          () => {
            agentCreated = true;
          },
        );
      },
    );

    const promise = client.get('http://example.com/hang', 10000);

    // Give it a brief moment to initiate connection
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(agentCreated, true, 'Agent should be created and tracked');

    // Simulate NestJS application shutdown
    client.beforeApplicationShutdown();

    await assert.rejects(
      promise,
      /Request aborted: application shutting down/,
    );
  });
});
