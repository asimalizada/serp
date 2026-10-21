import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { updateTimezoneSchema, UpdateTimezoneInput } from '@serp/shared';
import { Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { AuthGuard, AuthRequest } from '../auth/guards/auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @Patch('me/timezone')
  @HttpCode(HttpStatus.OK)
  async updateTimezone(
    @Req() request: AuthRequest,
    @Body(new ZodValidationPipe(updateTimezoneSchema)) body: UpdateTimezoneInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { user } = await this.users.updateTimezone(request.user.id, body.timezone);
    const newAccessToken = await this.auth.issueAccessToken(user);
    response.cookie('serp_access', newAccessToken, this.auth.accessCookieOptions());
    return { user };
  }
}