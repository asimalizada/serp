import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthUser, CreateRefreshTokenData, UserAuthRecord } from '../types/auth.types';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByNormalizedEmail(email: string): Promise<UserAuthRecord | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        timezone: true,
        passwordHash: true,
      },
    });
  }

  async createRefreshToken(data: CreateRefreshTokenData): Promise<void> {
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: data.tokenHash,
        userId: data.userId,
        expiresAt: data.expiresAt,
      },
    });
  }

  async rotateRefreshToken(
    oldTokenHash: string,
    newTokenHash: string,
    newExpiresAt: Date,
    now: Date = new Date(),
  ): Promise<AuthUser | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.refreshToken.findUnique({
          where: { tokenHash: oldTokenHash },
          select: {
            expiresAt: true,
            user: {
              select: {
                id: true,
                email: true,
                timezone: true,
              },
            },
          },
        });

        if (!existing || existing.expiresAt <= now) {
          return null;
        }

        await tx.refreshToken.delete({
          where: { tokenHash: oldTokenHash },
        });

        await tx.refreshToken.create({
          data: {
            tokenHash: newTokenHash,
            userId: existing.user.id,
            expiresAt: newExpiresAt,
          },
        });

        return existing.user;
      });
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code: string }).code === 'P2025'
      ) {
        return null;
      }
      throw error;
    }
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { tokenHash },
    });
  }

  async deleteExpiredRefreshTokens(now: Date = new Date()): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    return result.count;
  }
}