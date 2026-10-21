'use client';

import { loginSchema } from '@serp/shared';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

type Field = 'email' | 'password';
type FieldErrors = Partial<Record<Field, string>>;

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInProgress = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function clearFieldError(field: Field) {
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInProgress.current) return;
    setFormError(null);

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
    const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN
      ?? (process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : undefined);
    if (!apiOrigin) {
      setFormError('Sign in is temporarily unavailable. Please try again later.');
      return;
    }

    submissionInProgress.current = true;
    setIsSubmitting(true);
    let signedIn = false;

    try {
      const response = await fetch(new URL('/auth/login', apiOrigin), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(result.data),
      });

      if (response.ok) {
        signedIn = true;
        router.replace('/pages');
        return;
      }

      if (response.status === 401) {
        setFormError('Email or password is incorrect.');
      } else if (response.status === 429) {
        setFormError('Too many sign-in attempts. Please wait a few minutes and try again.');
      } else if (response.status === 400) {
        setFormError('Please check your email and password and try again.');
      } else {
        setFormError('Sign in could not be completed. Please try again.');
      }
    } catch {
      setFormError('Unable to reach the server. Check your connection and try again.');
    } finally {
      if (!signedIn) {
        submissionInProgress.current = false;
        setIsSubmitting(false);
      }
    }
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
        disabled={isSubmitting}
        className="mt-2 flex h-12 w-full items-center justify-center rounded-control bg-accent px-4 text-[0.9375rem] font-medium text-white transition-[background-color,transform] duration-[var(--motion-standard)] hover:bg-accent-hover active:translate-y-px disabled:cursor-wait disabled:opacity-70"
      >
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </button>

      {formError && (
        <p role="alert" className="text-sm leading-5 text-danger">
          {formError}
        </p>
      )}
    </form>
  );
}