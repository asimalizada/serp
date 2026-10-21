import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import {
  pageListQuerySchema,
  PageListQueryOutput,
  rankHistoryQuerySchema,
  RankHistoryQueryOutput,
} from '@serp/shared';
import { AuthGuard, AuthRequest } from '../auth/guards/auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PagesService } from './pages.service';

@Controller('pages')
@UseGuards(AuthGuard)
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  @Get()
  list(
    @Req() request: AuthRequest,
    @Query(new ZodValidationPipe(pageListQuerySchema)) query: PageListQueryOutput,
  ) {
    return this.pages.list(request.user.id, query);
  }

  @Get(':id/rank-history')
  history(
    @Req() request: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(rankHistoryQuerySchema)) query: RankHistoryQueryOutput,
  ) {
    return this.pages.rankHistory(request.user.id, request.user.timezone, id, query);
  }

  @Get(':id')
  detail(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.pages.detail(request.user.id, id);
  }
}