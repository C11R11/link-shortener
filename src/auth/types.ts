export interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string | null;
}

export interface CreateSessionResult {
  sessionRecord: SessionRecord;
  rawToken: string;
}

export interface GetSessionResult {
  session: SessionRecord;
  user: UserRecord;
}

export class AuthError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface AuthService {
  hashPassword(plain: string): Promise<string>;
  createUser(input: CreateUserInput): Promise<UserRecord>;
  validateCredentials(email: string, password: string, ip: string): Promise<UserRecord | null>;
  createSession(userId: string, ttlSeconds?: number): Promise<CreateSessionResult>;
  getSessionByToken(rawToken: string): Promise<GetSessionResult | null>;
  revokeSessionByRawToken(rawToken: string): Promise<void>;
  revokeSessionByHash(tokenHash: string): Promise<void>;
  revokeAllUserSessions(userId: string): Promise<void>;
  updatePassword(userId: string, newPassword: string): Promise<void>;
}
