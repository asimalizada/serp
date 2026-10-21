export interface AuthUser {
  id: string;
  email: string;
  timezone: string;
}

export interface UserAuthRecord extends AuthUser {
  passwordHash: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  timezone: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

export interface CreateRefreshTokenData {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}