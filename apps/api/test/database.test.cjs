const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Load environment variables
const envPath = [
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(process.cwd(), '.env'),
].find((p) => fs.existsSync(p));
if (envPath) require('dotenv').config({ path: envPath, quiet: true });

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module.js');
const { DatabaseModule } = require('../dist/database/database.module.js');
const { PrismaService } = require('../dist/database/prisma.service.js');
const { PrismaClient } = require('../dist/generated/prisma/client.js');
const { ClientsRepository } = require('../dist/clients/repositories/clients.repository.js');
const { PagesRepository } = require('../dist/pages/repositories/pages.repository.js');
const { AuthRepository } = require('../dist/auth/repositories/auth.repository.js');
const { UsersRepository } = require('../dist/users/repositories/users.repository.js');
const { CrawlWorker } = require('../dist/crawler/workers/crawl-worker.js');
const { PostgresThrottlerStorage } = require('../dist/auth/throttling/postgres-throttler.storage.js');
const { PrismaCrawlStore } = require('../dist/crawler/persistence/prisma-crawl.store.js');

test('PrismaService connects on module init and disconnects on application shutdown', async () => {
  let connected = false;
  let disconnected = false;

  const mockConfig = {
    getOrThrow: (key) => {
      if (key === 'DATABASE_URL') return process.env.DATABASE_URL || 'postgresql://user:pass@localhost:5432/db';
      throw new Error(`Unexpected config key: ${key}`);
    },
  };

  const service = new PrismaService(mockConfig);
  // Monkey-patch $connect and $disconnect to observe lifecycle calls
  service.$connect = async () => { connected = true; };
  service.$disconnect = async () => { disconnected = true; };

  await service.onModuleInit();
  assert.equal(connected, true, 'PrismaService must call $connect on onModuleInit');

  await service.onApplicationShutdown();
  assert.equal(disconnected, true, 'PrismaService must call $disconnect on onApplicationShutdown');
});

test('NestJS application context bootstraps with DatabaseModule singleton and resolves all repositories', async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    // 1. Singleton verification: PrismaService is the single database provider instance
    const prismaService = app.get(PrismaService);

    assert.equal(prismaService.constructor, PrismaService);
    assert.ok(prismaService.$connect && prismaService.$disconnect);

    // 2. Repositories resolve without errors or circular dependencies
    const clientsRepo = app.get(ClientsRepository);
    const pagesRepo = app.get(PagesRepository);
    const authRepo = app.get(AuthRepository);
    const usersRepo = app.get(UsersRepository);
    const throttlerStorage = app.get(PostgresThrottlerStorage);
    const crawlStore = app.get(PrismaCrawlStore);
    const crawlWorker = app.get(CrawlWorker);

    assert.ok(clientsRepo instanceof ClientsRepository);
    assert.ok(pagesRepo instanceof PagesRepository);
    assert.ok(authRepo instanceof AuthRepository);
    assert.ok(usersRepo instanceof UsersRepository);
    assert.ok(throttlerStorage instanceof PostgresThrottlerStorage);
    assert.ok(crawlStore instanceof PrismaCrawlStore);
    assert.ok(crawlWorker instanceof CrawlWorker);

    // 3. Verify that all repositories received the exact same PrismaService singleton
    assert.equal(clientsRepo.prisma, prismaService);
    assert.equal(pagesRepo.prisma, prismaService);
    assert.equal(authRepo.prisma, prismaService);
    assert.equal(usersRepo.prisma, prismaService);
    assert.equal(throttlerStorage.prisma, prismaService);
    assert.equal(crawlStore.prisma, prismaService);
    assert.equal(crawlWorker.prisma, prismaService);
  } finally {
    await app.close();
  }
});