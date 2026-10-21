import { Controller, Get, Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { ClientsModule } from './clients/clients.module';
import { PagesModule } from './pages/pages.module';
import { UsersModule } from './users/users.module';

@Controller()
class AppController {
  @Get()
  getRoot(): { name: string } {
    return { name: 'SERP API' };
  }
}

@Module({ imports: [DatabaseModule, AuthModule, ClientsModule, PagesModule, UsersModule], controllers: [AppController] })
export class AppModule {}