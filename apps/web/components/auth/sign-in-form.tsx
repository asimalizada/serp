'use client';

import { loginSchema } from '@serp/shared';
import { useRef, useState, type FormEvent } from 'react';

type Field = 'email' | 'password';
type FieldErrors = Partial<Record<Field, string>>;

export function SignInForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showPendingMessage, setShowPendingMessage] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function clearFieldError(field: Field) {
    setErrors((current) => ({ ...current, [field]: undefined }));
    setShowPendingMessage(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowPendingMessage(false);

    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      const nextErrors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if ((field === 'email' || field === 'password') && !nextErrors[field]) {
          nextErrors[field] = issue.message;
        }
      }
      setErrors(nextErrors);
      if (nextErrors.email) emailRef.current?.focus();
      else if (nextErrors.password) passwordRef.current?.focus();
      return;
    }

    setErrors({});
    setShowPendingMessage(true);
  }

  const inputClassName =
    'block h-12 w-full rounded-control border bg-surface px-3.5 text-[0.9375rem] text-ink transition-[border-color,box-shadow] duration-[var(--motion-standard)] focus:border-accent focus:outline-offset-2';

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="login-email" className="mb-2 block text-sm font-medium text-ink">
          Email
        </label>
        <input
          ref={emailRef}
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            clearFieldError('email');
          }}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'login-email-error' : undefined}
          className={`${inputClassName} ${errors.email ? 'border-danger' : 'border-line-strong hover:border-ink-faint'}`}
        />
        {errors.email && (
          <p id="login-email-error" className="mt-2 text-sm leading-5 text-danger">
            {errors.email}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="login-password" className="mb-2 block text-sm font-medium text-ink">
          Password
        </label>
        <div className="relative">
          <input
            ref={passwordRef}
            id="login-password"
            name="password"
            type={passwordVisible ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              clearFieldError('password');
            }}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? 'login-password-error' : undefined}
            className={`${inputClassName} pr-18 ${errors.password ? 'border-danger' : 'border-line-strong hover:border-ink-faint'}`}
          />
          <button
            type="button"
            aria-label={passwordVisible ? 'Hide password' : 'Show password'}
            aria-pressed={passwordVisible}
            aria-controls="login-password"
            onClick={() => setPasswordVisible((visible) => !visible)}
            className="absolute inset-y-1 right-1 min-w-14 rounded-control px-2 text-sm font-medium text-ink-muted hover:bg-surface-subtle hover:text-ink focus-visible:outline-offset-0"
          >
            {passwordVisible ? 'Hide' : 'Show'}
          </button>
        </div>
        {errors.password && (
          <p id="login-password-error" className="mt-2 text-sm leading-5 text-danger">
            {errors.password}
          </p>
        )}
      </div>

      <button
        type="submit"
        className="mt-2 flex h-12 w-full items-center justify-center rounded-control bg-accent px-4 text-[0.9375rem] font-medium text-white transition-[background-color,transform] duration-[var(--motion-standard)] hover:bg-accent-hover active:translate-y-px"
      >
        Sign in
      </button>

      {showPendingMessage && (
        <p role="status" className="rounded-control border border-line bg-surface-subtle px-3.5 py-3 text-sm leading-5 text-ink-muted">
          Authentication integration is pending. This preview does not sign you in.
        </p>
      )}
    </form>
  );
}