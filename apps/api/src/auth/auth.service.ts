import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { normalizeEmail } from '../normalize-email';
import { AuthRepository } from './repositories/auth.repository';
import { AuthUser, JwtPayload } from './types/auth.types';

export { AuthUser } from './types/auth.types';
export const ACCESS_TOKEN_SECONDS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_SECONDS = 7 * 24 * 60 * 60; // 7 days
const DUMMY_HASH = '$2b$12$V7LkX3BKrqu7dxP9EwyeQOjNhZGs3VlsK0o3H3DlR1sT5sehlujlm';

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(
    emailInput: string,
    password: string,
  ): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }> {
    if (Buffer.byteLength(password, 'utf8') > 72) {
      throw new BadRequestException('Password exceeds bcrypt length limit');
    }
    const email = normalizeEmail(emailInput);
    const user = await this.authRepository.findUserByNormalizedEmail(email);
    const valid = await compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const authUser: AuthUser = { id: user.id, email: user.email, timezone: user.timezone };
    const accessToken = await this.generateAccessToken(authUser);
    const refreshToken = this.generateOpaqueToken();

    await this.authRepository.createRefreshToken({
      tokenHash: tokenHash(refreshToken),
      userId: user.id,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000),
    });

    return {
      user: authUser,
      accessToken,
      refreshToken,
    };
  }

  async refresh(
    token: string | undefined,
  ): Promise<{ user: AuthUser; accessToken: string; refreshToken: string }> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const newRefreshToken = this.generateOpaqueToken();
    const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000);

    const user = await this.authRepository.rotateRefreshToken(
      tokenHash(token),
      tokenHash(newRefreshToken),
      newExpiresAt,
    );

    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const accessToken = await this.generateAccessToken(user);

    return {
      user,
      accessToken,
      refreshToken: newRefreshToken,
    };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      await this.authRepository.revokeRefreshToken(tokenHash(token));
    }
  }

  async issueAccessToken(user: AuthUser): Promise<string> {
    return this.generateAccessToken(user);
  }

  accessCookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.getOrThrow<string>('NODE_ENV') === 'production',
      sameSite: 'lax' as const,
      path: '/',
      maxAge: ACCESS_TOKEN_SECONDS * 1000,
    };
  }

  private async generateAccessToken(user: AuthUser): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      timezone: user.timezone,
    };
    return this.jwtService.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_SECRET'),
      expiresIn: `${ACCESS_TOKEN_SECONDS}s`,
      issuer: this.config.get<string>('JWT_ISSUER') ?? 'serp-api',
      audience: this.config.get<string>('JWT_AUDIENCE') ?? 'serp-web',
      algorithm: 'HS256',
    });
  }

  private generateOpaqueToken(): string {
    return randomBytes(32).toString('base64url');
  }
}