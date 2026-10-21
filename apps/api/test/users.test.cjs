const { test } = require('node:test');
const assert = require('node:assert/strict');
const { updateTimezoneSchema, isValidIanaTimezone } = require('@serp/shared');
const { UsersRepository } = require('../dist/users/repositories/users.repository.js');
const { UsersService } = require('../dist/users/users.service.js');
const { UsersController } = require('../dist/users/users.controller.js');
const { AuthService, ACCESS_TOKEN_SECONDS } = require('../dist/auth/auth.service.js');
const { AuthGuard } = require('../dist/auth/guards/auth.guard.js');
const { AuthController } = require('../dist/auth/auth.controller.js');
const { AuthRepository } = require('../dist/auth/repositories/auth.repository.js');
const { ZodValidationPipe } = require('../dist/common/pipes/zod-validation.pipe.js');
const { ApiExceptionFilter } = require('../dist/api-exception.filter.js');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { JwtModule, JwtService } = require('@nestjs/jwt');
const { ConfigService } = require('@nestjs/config');

const TEST_JWT_SECRET = 'serp_test_secret_at_least_32_chars_long_1234567890';
const TEST_JWT_ISSUER = 'serp-api';
const TEST_JWT_AUDIENCE = 'serp-web';

function createMockConfig() {
  return {
    getOrThrow: (key) => {
      if (key === 'JWT_SECRET') return TEST_JWT_SECRET;
      if (key === 'NODE_ENV') return 'test';
      throw new Error(`Config key missing: ${key}`);
    },
    get: (key) => {
      if (key === 'JWT_ISSUER') return TEST_JWT_ISSUER;
      if (key === 'JWT_AUDIENCE') return TEST_JWT_AUDIENCE;
      return undefined;
    },
  };
}

// -------------------------------------------------------------
// 1. Zod updateTimezoneSchema tests
// -------------------------------------------------------------

test('updateTimezoneSchema accepts valid IANA timezones', () => {
  const validZones = [
    'America/Toronto',
    'Pacific/Auckland',
    'UTC',
    'Europe/London',
    'Asia/Tokyo',
    'America/Argentina/Buenos_Aires',
    'Africa/Cairo',
  ];

  for (const zone of validZones) {
    const res = updateTimezoneSchema.safeParse({ timezone: zone });
    assert.equal(res.success, true, `Expected valid timezone for "${zone}"`);
    assert.equal(res.data.timezone, zone);
  }
});

test('updateTimezoneSchema rejects invalid IANA timezones', () => {
  const invalidZones = [
    'Mars/Olympus',
    'Invalid/Zone',
    'not-a-zone',
    'America/NonExistentCity',
    '12345',
    'GMT+99',
  ];

  for (const zone of invalidZones) {
    const res = updateTimezoneSchema.safeParse({ timezone: zone });
    assert.equal(res.success, false, `Expected invalid timezone for "${zone}"`);
    assert.ok(res.error.issues.some((i) => i.message.includes('valid IANA timezone')));
  }
});

test('updateTimezoneSchema rejects missing or empty timezone', () => {
  assert.equal(updateTimezoneSchema.safeParse({}).success, false);
  assert.equal(updateTimezoneSchema.safeParse({ timezone: '' }).success, false);
  assert.equal(updateTimezoneSchema.safeParse({ timezone: '   ' }).success, false);
});

test('updateTimezoneSchema rejects unknown properties in strict mode', () => {
  const res = updateTimezoneSchema.safeParse({
    timezone: 'UTC',
    extraField: 'not allowed',
  });
  assert.equal(res.success, false);
});

test('updateTimezoneSchema rejects values exceeding 64 characters', () => {
  const res = updateTimezoneSchema.safeParse({
    timezone: 'America/Toronto'.padEnd(65, 'o'),
  });
  assert.equal(res.success, false);
});

// -------------------------------------------------------------
// 2. UsersRepository unit tests
// -------------------------------------------------------------

test('UsersRepository.findById returns profile and excludes password hash', async () => {
  const mockUser = {
    id: 'user-id-1',
    email: 'user1@example.com',
    passwordHash: 'secret-hash-1234',
    timezone: 'America/Toronto',
  };

  const mockPrisma = {
    user: {
      findUnique: async ({ where, select }) => {
        assert.equal(where.id, mockUser.id);
        assert.equal(select.passwordHash, undefined, 'passwordHash must never be selected');
        return {
          id: mockUser.id,
          email: mockUser.email,
          timezone: mockUser.timezone,
        };
      },
    },
  };

  const repo = new UsersRepository(mockPrisma);
  const found = await repo.findById('user-id-1');
  assert.ok(found);
  assert.equal(found.id, mockUser.id);
  assert.equal(found.email, mockUser.email);
  assert.equal(found.timezone, mockUser.timezone);
  assert.equal(found.passwordHash, undefined);
});

test('UsersRepository.updateTimezone scopes update to authenticated user ID', async () => {
  let updatedWhere;
  let updatedData;

  const mockPrisma = {
    user: {
      update: async ({ where, data, select }) => {
        updatedWhere = where;
        updatedData = data;
        assert.equal(select.passwordHash, undefined, 'passwordHash must never be selected');
        return {
          id: where.id,
          email: 'user1@example.com',
          timezone: data.timezone,
        };
      },
    },
  };

  const repo = new UsersRepository(mockPrisma);
  const result = await repo.updateTimezone('user-id-42', 'Europe/Paris');
  assert.equal(updatedWhere.id, 'user-id-42', 'Must scope update to userId');
  assert.equal(updatedData.timezone, 'Europe/Paris');
  assert.equal(result.id, 'user-id-42');
  assert.equal(result.timezone, 'Europe/Paris');
});

// -------------------------------------------------------------
// 3. UsersService unit tests
// -------------------------------------------------------------

test('UsersService delegates valid timezone update to repository', async () => {
  let repoCalledWith;
  const mockRepo = {
    updateTimezone: async (userId, timezone) => {
      repoCalledWith = { userId, timezone };
      return { id: userId, email: 'test@example.com', timezone };
    },
  };

  const service = new UsersService(mockRepo);
  const { user } = await service.updateTimezone('u123', 'Pacific/Auckland');
  assert.equal(repoCalledWith.userId, 'u123');
  assert.equal(repoCalledWith.timezone, 'Pacific/Auckland');
  assert.equal(user.timezone, 'Pacific/Auckland');
});

test('UsersService throws BadRequestException for invalid IANA timezone', async () => {
  const mockRepo = {
    updateTimezone: async () => assert.fail('Repository should not be called'),
  };

  const service = new UsersService(mockRepo);
  await assert.rejects(
    service.updateTimezone('u123', 'Mars/Olympus'),
    /A valid IANA timezone is required/,
  );
});

// -------------------------------------------------------------
// 4. UsersController HTTP pipeline integration tests
// -------------------------------------------------------------

test('UsersController HTTP pipeline: update timezone, immediate JWT consistency, and rejection of invalid payloads', async () => {
  const testUser = {
    id: 'test-user-http-1',
    email: 'user.http@serp.local',
    timezone: 'America/Toronto',
  };

  let currentUserTimezone = testUser.timezone;

  const mockUsersRepo = {
    findById: async (id) => {
      if (id === testUser.id) return { ...testUser, timezone: currentUserTimezone };
      return null;
    },
    updateTimezone: async (id, timezone) => {
      if (id !== testUser.id) throw new Error('User not found');
      currentUserTimezone = timezone;
      return { ...testUser, timezone };
    },
  };

  const mockAuthRepo = {
    findUserByNormalizedEmail: async () => null,
    createRefreshToken: async () => {},
    rotateRefreshToken: async () => null,
    revokeRefreshToken: async () => {},
    deleteExpiredRefreshTokens: async () => 0,
  };

  const mockConfig = createMockConfig();

const { ThrottlerModule } = require('@nestjs/throttler');

  class TestModule {}
  Module({
    imports: [
      ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
      JwtModule.register({
        secret: TEST_JWT_SECRET,
        signOptions: {
          expiresIn: `${ACCESS_TOKEN_SECONDS}s`,
          issuer: TEST_JWT_ISSUER,
          audience: TEST_JWT_AUDIENCE,
          algorithm: 'HS256',
        },
      }),
    ],
    controllers: [UsersController, AuthController],
    providers: [
      { provide: UsersRepository, useValue: mockUsersRepo },
      UsersService,
      { provide: AuthRepository, useValue: mockAuthRepo },
      {
        provide: AuthService,
        useFactory: (r, jwt, c) => new AuthService(r, jwt, c),
        inject: [AuthRepository, JwtService, ConfigService],
      },
      {
        provide: ConfigService,
        useValue: mockConfig,
      },
      AuthGuard,
    ],
  })(TestModule);

  const app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0);
  const port = app.getHttpServer().address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const jwtService = app.get(JwtService);

  // Generate initial access JWT with timezone A (America/Toronto)
  const initialToken = await jwtService.signAsync({
    sub: testUser.id,
    email: testUser.email,
    timezone: 'America/Toronto',
  }, {
    secret: TEST_JWT_SECRET,
    expiresIn: '15m',
    issuer: TEST_JWT_ISSUER,
    audience: TEST_JWT_AUDIENCE,
  });

  try {
    // 1. Unauthenticated request rejected with 401
    const unauthRes = await fetch(`${baseUrl}/users/me/timezone`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone: 'Pacific/Auckland' }),
    });
    assert.equal(unauthRes.status, 401);

    // 2. Initial /auth/me returns timezone A
    const meInitialRes = await fetch(`${baseUrl}/auth/me`, {
      headers: { cookie: `serp_access=${initialToken}` },
    });
    assert.equal(meInitialRes.status, 200);
    const meInitialData = await meInitialRes.json();
    assert.equal(meInitialData.user.timezone, 'America/Toronto');

    // 3. Valid PATCH /users/me/timezone updates timezone to Pacific/Auckland
    const updateRes = await fetch(`${baseUrl}/users/me/timezone`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: `serp_access=${initialToken}`,
      },
      body: JSON.stringify({ timezone: 'Pacific/Auckland' }),
    });
    assert.equal(updateRes.status, 200);
    const updateData = await updateRes.json();
    assert.equal(updateData.user.id, testUser.id);
    assert.equal(updateData.user.timezone, 'Pacific/Auckland');

    // 4. Verify updated serp_access cookie was set with new JWT
    const setCookieHeaders = updateRes.headers.getSetCookie
      ? updateRes.headers.getSetCookie()
      : [updateRes.headers.get('set-cookie')].filter(Boolean);
    const accessCookieHeader = setCookieHeaders.find((c) => c.startsWith('serp_access='));
    assert.ok(accessCookieHeader, 'Must set updated serp_access cookie');
    assert.match(accessCookieHeader, /HttpOnly/i);
    assert.match(accessCookieHeader, /SameSite=Lax/i);

    const [nameVal] = accessCookieHeader.split(';');
    const [, newAccessToken] = nameVal.split('=');
    assert.ok(newAccessToken);

    // 5. Decode new access JWT and verify claims reflect timezone B
    const decodedNewToken = await jwtService.verifyAsync(newAccessToken, {
      secret: TEST_JWT_SECRET,
      issuer: TEST_JWT_ISSUER,
      audience: TEST_JWT_AUDIENCE,
    });
    assert.equal(decodedNewToken.sub, testUser.id);
    assert.equal(decodedNewToken.email, testUser.email);
    assert.equal(decodedNewToken.timezone, 'Pacific/Auckland');

    // 6. Immediate consistency: Next request with the new cookie reflects timezone B immediately
    const meAfterRes = await fetch(`${baseUrl}/auth/me`, {
      headers: { cookie: `serp_access=${newAccessToken}` },
    });
    assert.equal(meAfterRes.status, 200);
    const meAfterData = await meAfterRes.json();
    assert.equal(meAfterData.user.timezone, 'Pacific/Auckland');

    // 7. Invalid IANA timezone rejected with 400
    const invalidTzRes = await fetch(`${baseUrl}/users/me/timezone`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: `serp_access=${newAccessToken}`,
      },
      body: JSON.stringify({ timezone: 'Mars/Olympus' }),
    });
    assert.equal(invalidTzRes.status, 400);
    const invalidTzData = await invalidTzRes.json();
    assert.equal(invalidTzData.error, 'Bad Request');

    // 8. Unknown properties rejected with 400
    const unknownPropRes = await fetch(`${baseUrl}/users/me/timezone`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: `serp_access=${newAccessToken}`,
      },
      body: JSON.stringify({ timezone: 'Europe/Paris', extraField: 123 }),
    });
    assert.equal(unknownPropRes.status, 400);

    // 9. Missing timezone rejected with 400
    const missingTzRes = await fetch(`${baseUrl}/users/me/timezone`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: `serp_access=${newAccessToken}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(missingTzRes.status, 400);
  } finally {
    await app.close();
  }
});
