import { Module } from '@nestjs/common';
import { AppConfigModule } from '../app-config';
import { PrismaService } from './prisma.service';

@Module({
  imports: [AppConfigModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}