import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface UserProfile {
  id: string;
  email: string;
  timezone: string;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(userId: string): Promise<UserProfile | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        timezone: true,
      },
    });
  }

  async updateTimezone(userId: string, timezone: string): Promise<UserProfile> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { timezone },
      select: {
        id: true,
        email: true,
        timezone: true,
      },
    });
  }
}