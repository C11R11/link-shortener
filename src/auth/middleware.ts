/// <reference path="./types.d.ts" />
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { AuthService } from './types.js';

export interface RequireAdmin {
  requireAdminApi: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  requireAdminHtml: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

function extractLegacyToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') {
    return null;
  }

  if (header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length);
  }

  if (header.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      const password = idx === -1 ? decoded : decoded.slice(idx + 1);
      return password;
    } catch {
      return null;
    }
  }

  return null;
}

async function trySession(
  auth: AuthService,
  config: AppConfig,
  request: FastifyRequest,
): Promise<boolean> {
  const cookieName = config.SESSION_COOKIE_NAME;
  const raw = request.cookies?.[cookieName];
  if (!raw) {
    return false;
  }
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) {
    return false;
  }
  const result = await auth.getSessionByToken(unsigned.value);
  if (!result) {
    return false;
  }
  request.adminUser = { id: result.user.id, email: result.user.email };
  return true;
}

function legacyTokenMatches(config: AppConfig, token: string | null): boolean {
  if (!token) return false;
  if (!config.ADMIN_TOKEN) return false;
  return token === config.ADMIN_TOKEN;
}

export function createRequireAdmin(auth: AuthService, config: AppConfig): RequireAdmin {
  async function requireAdminApi(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (await trySession(auth, config, request)) {
      return;
    }
    if (legacyTokenMatches(config, extractLegacyToken(request))) {
      return;
    }
    reply.code(401).send({ error: 'Unauthorized' });
  }

  async function requireAdminHtml(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (await trySession(auth, config, request)) {
      return;
    }
    reply.redirect('/admin/login');
  }

  return { requireAdminApi, requireAdminHtml };
}
