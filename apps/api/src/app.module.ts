import { Controller, Get, Module } from '@nestjs/common';

@Controller()
class AppController {
  @Get()
  getRoot(): { name: string } {
    return { name: 'SERP API' };
  }
}

@Module({ controllers: [AppController] })
export class AppModule {}
