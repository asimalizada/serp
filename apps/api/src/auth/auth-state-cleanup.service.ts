import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AuthRepository } from './repositories/auth.repository';
import { PostgresThrottlerStorage } from './throttling/postgres-throttler.storage';

export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class AuthStateCleanupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AuthStateCleanupService.name);
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly throttlerStorage: PostgresThrottlerStorage,
  ) { }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.cleanupExpiredState();
    } catch (error: unknown) {
      this.logger.error(
        'Initial authentication state cleanup failed on startup',
        error instanceof Error ? error.stack : String(error),
      );
    }

    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredState().catch((error: unknown) => {
        this.logger.error(
          'Could not remove expired authentication state',
          error instanceof Error ? error.stack : String(error),
        );
      });
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  async cleanupExpiredState(
    now: Date = new Date(),
  ): Promise<{ refreshTokens: number; throttles: number }> {
    const [tokensResult, throttlesResult] = await Promise.allSettled([
      this.authRepository.deleteExpiredRefreshTokens(now),
      this.throttlerStorage.deleteExpiredThrottles(now),
    ]);

    let refreshTokens = 0;
    let throttles = 0;

    if (tokensResult.status === 'fulfilled') {
      refreshTokens = tokensResult.value;
    } else {
      this.logger.error(
        'Failed to delete expired authentication refresh tokens',
        tokensResult.reason instanceof Error ? tokensResult.reason.stack : String(tokensResult.reason),
      );
    }

    if (throttlesResult.status === 'fulfilled') {
      throttles = throttlesResult.value;
    } else {
      this.logger.error(
        'Failed to delete expired authentication throttles',
        throttlesResult.reason instanceof Error ? throttlesResult.reason.stack : String(throttlesResult.reason),
      );
    }

    if (tokensResult.status === 'rejected' || throttlesResult.status === 'rejected') {
      const reasons = [
        tokensResult.status === 'rejected' ? tokensResult.reason : null,
        throttlesResult.status === 'rejected' ? throttlesResult.reason : null,
      ].filter(Boolean);
      throw new Error(
        `Authentication state cleanup failed: ${reasons.map((r) => (r instanceof Error ? r.message : String(r))).join(', ')}`,
      );
    }

    return { refreshTokens, throttles };
  }
}