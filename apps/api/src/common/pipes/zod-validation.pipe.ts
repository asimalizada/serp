import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodError, ZodType } from 'zod';

export interface FieldValidationError {
  field: string;
  message: string;
  code: string;
}

export interface FormattedValidationResponse {
  message: string[];
  errors: FieldValidationError[];
}

@Injectable()
export class ZodValidationPipe<T = unknown> implements PipeTransform<unknown, Promise<T>> {
  constructor(private readonly schema: ZodType<T>) { }

  async transform(value: unknown, _metadata?: ArgumentMetadata): Promise<T> {
    const result = await this.schema.safeParseAsync(value);

    if (!result.success) {
      throw new BadRequestException(this.formatErrors(result.error));
    }

    return result.data;
  }

  private formatErrors(error: ZodError): FormattedValidationResponse {
    const errors: FieldValidationError[] = error.issues.map((issue) => {
      let field = issue.path.join('.');
      if (!field && 'keys' in issue && Array.isArray((issue as { keys: unknown[] }).keys)) {
        field = (issue as { keys: unknown[] }).keys.map(String).join('.');
      }
      if (!field) {
        field = 'root';
      }

      return {
        field,
        message: issue.message,
        code: issue.code,
      };
    });

    const message = errors.map((e) =>
      e.field !== 'root' ? `${e.field}: ${e.message}` : e.message,
    );

    return {
      message,
      errors,
    };
  }
}
