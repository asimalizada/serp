import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import { loginSchema, LoginInput } from '@serp/shared';
import { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ACCESS_TOKEN_SECONDS, AuthService, REFRESH_TOKEN_SECONDS } from './auth.service';
import { AuthGuard, AuthRequest, refreshToken } from './guards/auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private cookieOptions(maxAge?: number) {
    return {
      httpOnly: true,
      secure: this.config.getOrThrow<string>('NODE_ENV') === 'production',
      sameSite: 'lax' as const,
      path: '/',
      ...(maxAge !== undefined ? { maxAge } : {}),
    };
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { user, accessToken, refreshToken: refreshTok } = await this.auth.login(
      body.email,
      body.password,
    );

    response.cookie('serp_access', accessToken, this.cookieOptions(ACCESS_TOKEN_SECONDS * 1000));
    response.cookie('serp_refresh', refreshTok, this.cookieOptions(REFRESH_TOKEN_SECONDS * 1000));

    return { user };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ success: true }> {
    const token = refreshToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const { accessToken, refreshToken: newRefreshToken } = await this.auth.refresh(token);

    response.cookie('serp_access', accessToken, this.cookieOptions(ACCESS_TOKEN_SECONDS * 1000));
    response.cookie('serp_refresh', newRefreshToken, this.cookieOptions(REFRESH_TOKEN_SECONDS * 1000));

    return { success: true };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ success: true }> {
    const token = refreshToken(request);
    await this.auth.logout(token);

    response.clearCookie('serp_access', this.cookieOptions());
    response.clearCookie('serp_refresh', this.cookieOptions());

    return { success: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: AuthRequest) {
    return { user: request.user };
  }
}