import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode = exception instanceof HttpException ? exception.getStatus() : 500;
    if (statusCode >= 500) this.logger.error(exception instanceof Error ? exception.message : String(exception),
      exception instanceof Error ? exception.stack : undefined);
    const details = exception instanceof HttpException ? exception.getResponse() : null;
    const message = typeof details === 'string' ? details : details && typeof details === 'object' && 'message' in details
      ? (details as { message: unknown }).message : statusCode === 500 ? 'Internal server error' : 'Request failed';
    response.status(statusCode).json({ statusCode, error: statusCode >= 500 ? 'Internal Server Error'
      : statusCode === 404 ? 'Not Found' : statusCode === 401 ? 'Unauthorized'
        : statusCode === 403 ? 'Forbidden' : statusCode === 409 ? 'Conflict'
          : statusCode === 429 ? 'Too Many Requests' : 'Bad Request', message });
  }
}