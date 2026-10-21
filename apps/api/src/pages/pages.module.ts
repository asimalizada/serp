import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { PagesController } from './pages.controller';
import { PagesRepository } from './repositories/pages.repository';
import { PagesService } from './pages.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [PagesController],
  providers: [PagesRepository, PagesService],
  exports: [PagesService, PagesRepository],
})
export class PagesModule {}