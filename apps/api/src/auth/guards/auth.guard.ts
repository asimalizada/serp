import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthUser, JwtPayload } from '../types/auth.types';

export type AuthRequest = Request & { user: AuthUser };

export function accessToken(request: Request): string | undefined {
  const cookies = request.headers.cookie?.split(';').map((part) => part.trim());
  const accessCookie = cookies
    ?.find((part) => part.startsWith('serp_access='))
    ?.slice('serp_access='.length);
  if (accessCookie) return accessCookie;

  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }
  return undefined;
}

export function refreshToken(request: Request): string | undefined {
  return request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('serp_refresh='))
    ?.slice('serp_refresh='.length);
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Optional() private readonly jwtService?: JwtService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (request.user) {
      return true;
    }

    const token = accessToken(request);
    if (!token) {
      throw new UnauthorizedException('Authentication token missing');
    }

    if (!this.jwtService || !this.config) {
      throw new UnauthorizedException('JWT authentication not configured');
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        issuer: this.config.get<string>('JWT_ISSUER') ?? 'serp-api',
        audience: this.config.get<string>('JWT_AUDIENCE') ?? 'serp-web',
        algorithms: ['HS256'],
      });

      if (!payload.sub || !payload.email || !payload.timezone) {
        throw new UnauthorizedException('Invalid token payload');
      }

      request.user = {
        id: payload.sub,
        email: payload.email,
        timezone: payload.timezone,
      };
      return true;
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired authentication token');
    }
  }
}