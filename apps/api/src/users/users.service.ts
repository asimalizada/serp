import { BadRequestException, Injectable } from '@nestjs/common';
import { isValidIanaTimezone } from '@serp/shared';
import { UserProfile, UsersRepository } from './repositories/users.repository';

export { UserProfile } from './repositories/users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async updateTimezone(userId: string, timezone: string): Promise<{ user: UserProfile }> {
    if (!isValidIanaTimezone(timezone)) {
      throw new BadRequestException('A valid IANA timezone is required');
    }
    const user = await this.usersRepository.updateTimezone(userId, timezone);
    return { user };
  }
}