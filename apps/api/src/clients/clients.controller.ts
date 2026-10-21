import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { createClientSchema, CreateClientInput } from '@serp/shared';
import { AuthGuard, AuthRequest } from '../auth/guards/auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ClientsService } from './clients.service';

@Controller('clients')
@UseGuards(AuthGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(@Req() request: AuthRequest) {
    return this.clients.list(request.user.id);
  }

  @Post()
  @HttpCode(202)
  create(
    @Req() request: AuthRequest,
    @Body(new ZodValidationPipe(createClientSchema)) body: CreateClientInput,
  ) {
    return this.clients.create(request.user.id, body);
  }

  @Get(':id/crawl-status')
  crawlStatus(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.clients.crawlStatus(request.user.id, id);
  }
}