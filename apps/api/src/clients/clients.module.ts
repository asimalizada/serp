import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CrawlerModule } from '../crawler/crawler.module';
import { AuthModule } from '../auth/auth.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientsRepository } from './repositories/clients.repository';

@Module({
  imports: [DatabaseModule, AuthModule, CrawlerModule],
  controllers: [ClientsController],
  providers: [ClientsService, ClientsRepository],
  exports: [ClientsService, ClientsRepository],
})
export class ClientsModule {}