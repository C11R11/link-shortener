import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBaseUrl, type AppConfig } from './config.js';
import { registerDashboard } from './admin/dashboard.handlers.js';

export type LinkRecord = {
  id: string;
  slug: string;
  destinationUrl: string;
  redirectStatusCode: number;
  title?: string | null;
  description?: string | null;
  status: string;
  clickCount: number;
  lastClickedAt: Date | null;
  createdBy?: string | null;
  expiresAt?: Date | null;
  deletedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export type LinkStats = {
  link: LinkRecord;
  totalClicks: number;
  clicksLast7Days: number;
  clicksByDay: Array<{
    bucket: string;
    count: number;
  }>;
  clicksByHour: Array<{
    bucket: string;
    count: number;
  }>;
  topReferrers: Array<{
    referrer: string;
    count: number;
  }>;
  recentClicks: Array<{
    clickedAt: Date;
    referrer: string | null;
    userAgent: string | null;
    country: string | null;
  }>;
};

export type LinkService = {
  listLinks(): Promise<LinkRecord[]>;
  getLinkBySlug(slug: string): Promise<LinkRecord | null>;
  getLinkById(id: string): Promise<LinkRecord | null>;
  createLink(input: {
    slug: string;
    destinationUrl: string;
    redirectStatusCode: number;
    title?: string | null;
    description?: string | null;
    createdBy?: string | null;
    expiresAt?: Date | null;
  }): Promise<LinkRecord>;
  updateLink(
    id: string,
    patch: Partial<{
      slug: string;
      destinationUrl: string;
      redirectStatusCode: number;
      title: string | null;
      description: string | null;
      createdBy: string | null;
      expiresAt: Date | null;
      status: string | null;
    }>,
  ): Promise<LinkRecord | null>;
  disableLink(id: string): Promise<LinkRecord | null>;
  recordClick(
    link: LinkRecord,
    event: { referrer?: string | null; userAgent?: string | null; country?: string | null; ipHash?: string | null },
  ): Promise<void>;
  getLinkStats(id: string): Promise<LinkStats | null>;
};

export function createApp(config: AppConfig, links: LinkService) {
  const app = Fastify({ logger: true });
  const registerHelmet = async () => {
    if (config.SHORTENER_SCHEME === 'http') {
      await app.register(helmet, { contentSecurityPolicy: false });
    } else {
      await app.register(helmet, {
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://cdn.jsdelivr.net'],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", 'https://cdn.jsdelivr.net'],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
          },
        },
      });
    }
  };

  const setup = async () => {
    await registerHelmet();
    await app.register(formbody);
    await app.register(rateLimit, {
      global: true,
      max: 120,
      timeWindow: '1 minute',
    });
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    await app.register(fastifyStatic, {
      root: path.join(__dirname, 'admin'),
      prefix: '/admin/',
      serveDotFiles: false,
    });
    registerDashboard(app, config, links, requireAdmin);
  };

  const isAuthorized = (request: { headers: Record<string, unknown> }) => {
    const header = request.headers.authorization;
    if (typeof header !== 'string') {
      return false;
    }

    if (header === `Bearer ${config.ADMIN_TOKEN}`) {
      return true;
    }

    if (header.startsWith('Basic ')) {
      const encoded = header.slice(6);
      try {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        const [, password] = decoded.split(':', 2);
        return password === config.ADMIN_TOKEN;
      } catch {
        return false;
      }
    }

    return false;
  };

  const requireAdmin = (request: { headers: Record<string, unknown> }) => {
    if (!isAuthorized(request)) {
      const error = new Error('Unauthorized');
      // @ts-expect-error Fastify decorations are runtime-only here
      error.statusCode = 401;
      throw error;
    }
  };

  app.get('/healthz', async () => ({
    ok: true,
    service: 'link-shortener',
    baseUrl: getBaseUrl(config),
  }));

  app.get('/api/links', async () => {
    const items = await links.listLinks();
    return {
      items,
      baseUrl: getBaseUrl(config),
    };
  });

  app.post('/api/links', async (request, reply) => {
    requireAdmin(request);
    const body = request.body as {
      slug?: string;
      destinationUrl?: string;
      redirectStatusCode?: string | number;
      title?: string;
      description?: string;
      createdBy?: string;
      expiresAt?: string;
    };

    if (!body?.slug || !body?.destinationUrl) {
      return reply.code(400).send({ error: 'slug and destinationUrl are required' });
    }

    if (!/^https?:\/\//i.test(body.destinationUrl)) {
      return reply.code(400).send({ error: 'destinationUrl must start with http:// or https://' });
    }

    const created = await links.createLink({
      slug: body.slug.trim(),
      destinationUrl: body.destinationUrl.trim(),
      redirectStatusCode: normalizeRedirectCode(body.redirectStatusCode, config.REDIRECT_STATUS_CODE),
      title: body.title?.trim() || null,
      description: body.description?.trim() || null,
      createdBy: body.createdBy?.trim() || null,
      expiresAt: parseDateTimeLocal(body.expiresAt),
    });

    return reply.code(201).send({
      ...created,
      shortUrl: `${getBaseUrl(config)}/${created.slug}`,
    });
  });

  app.get('/api/links/:id', async (request, reply) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const link = await links.getLinkById(id);
    if (!link) {
      return reply.code(404).send({ error: 'Link not found' });
    }

    return {
      ...link,
      shortUrl: `${getBaseUrl(config)}/${link.slug}`,
    };
  });

  app.patch('/api/links/:id', async (request, reply) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = request.body as {
      slug?: string;
      destinationUrl?: string;
      redirectStatusCode?: number;
      title?: string | null;
      description?: string | null;
      createdBy?: string | null;
      expiresAt?: string | null;
      status?: 'active' | 'disabled' | 'archived';
    };

    const updated = await links.updateLink(id, {
      ...(body.slug !== undefined ? { slug: body.slug.trim() } : {}),
      ...(body.destinationUrl !== undefined ? { destinationUrl: body.destinationUrl.trim() } : {}),
      ...(body.redirectStatusCode !== undefined ? { redirectStatusCode: normalizeRedirectCode(body.redirectStatusCode, config.REDIRECT_STATUS_CODE) } : {}),
      ...(body.title !== undefined ? { title: body.title?.trim() ?? null } : {}),
      ...(body.description !== undefined ? { description: body.description?.trim() ?? null } : {}),
      ...(body.createdBy !== undefined ? { createdBy: body.createdBy?.trim() ?? null } : {}),
      ...(body.expiresAt !== undefined ? { expiresAt: parseDateTimeLocal(body.expiresAt) } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    });

    if (!updated) {
      return reply.code(404).send({ error: 'Link not found' });
    }

    return {
      ...updated,
      shortUrl: `${getBaseUrl(config)}/${updated.slug}`,
    };
  });

  app.delete('/api/links/:id', async (request, reply) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const disabled = await links.disableLink(id);
    if (!disabled) {
      return reply.code(404).send({ error: 'Link not found' });
    }

    return reply.code(204).send();
  });

  app.get('/api/links/:id/stats', async (request, reply) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const stats = await links.getLinkStats(id);
    if (!stats) {
      return reply.code(404).send({ error: 'Link not found' });
    }

    return {
      ...stats,
      shortUrl: `${getBaseUrl(config)}/${stats.link.slug}`,
    };
  });

  app.get('/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    if (!slug || slug.startsWith('api/') || slug === 'healthz' || slug.startsWith('admin/')) {
      return reply.code(404).send({ error: 'Not found' });
    }

    const link = await links.getLinkBySlug(slug);
    if (!link) {
      return reply.code(404).send({ error: 'Link not found' });
    }

    if (link.status !== 'active') {
      return reply.code(410).send({ error: 'Link disabled' });
    }

    if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
      return reply.code(410).send({ error: 'Link expired' });
    }

    await links.recordClick(link, {
      referrer: request.headers.referer ?? null,
      userAgent: request.headers['user-agent'] ?? null,
      country: typeof request.headers['cf-ipcountry'] === 'string' ? request.headers['cf-ipcountry'] : null,
      ipHash: request.ip ? crypto.createHash('sha256').update(request.ip).digest('hex') : null,
    });

    reply.code(link.redirectStatusCode || config.REDIRECT_STATUS_CODE);
    return reply.redirect(link.destinationUrl);
  });

  app.post('/admin/links', async (request, reply) => {
    requireAdmin(request);
    const body = request.body as {
      slug?: string;
      destinationUrl?: string;
      redirectStatusCode?: string | number;
      title?: string;
      description?: string;
      status?: 'active' | 'disabled' | 'archived';
      createdBy?: string;
      expiresAt?: string;
    };

    if (!body?.slug || !body?.destinationUrl) {
      return reply.code(400).send({ error: 'slug and destinationUrl are required' });
    }

    if (!/^https?:\/\//i.test(body.destinationUrl)) {
      return reply.code(400).send({ error: 'destinationUrl must start with http:// or https://' });
    }

    const created = await links.createLink({
      slug: body.slug.trim(),
      destinationUrl: body.destinationUrl.trim(),
      redirectStatusCode: normalizeRedirectCode(body.redirectStatusCode, config.REDIRECT_STATUS_CODE),
      title: body.title?.trim() || null,
      description: body.description?.trim() || null,
      createdBy: body.createdBy?.trim() || null,
      expiresAt: parseDateTimeLocal(body.expiresAt),
    });

    if (body.status && body.status !== 'active') {
      await links.updateLink(created.id, { status: body.status });
    }

    return reply.redirect('/admin/dashboard');
  });

  app.post('/admin/links/:id', async (request, reply) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = request.body as {
      slug?: string;
      destinationUrl?: string;
      redirectStatusCode?: string | number;
      title?: string | null;
      description?: string | null;
      createdBy?: string | null;
      expiresAt?: string | null;
      status?: 'active' | 'disabled' | 'archived';
      _method?: string;
    };

    const updated = await links.updateLink(id, {
      ...(body.slug !== undefined ? { slug: body.slug.trim() } : {}),
      ...(body.destinationUrl !== undefined ? { destinationUrl: body.destinationUrl.trim() } : {}),
      ...(body.redirectStatusCode !== undefined ? { redirectStatusCode: normalizeRedirectCode(body.redirectStatusCode, config.REDIRECT_STATUS_CODE) } : {}),
      ...(body.title !== undefined ? { title: body.title?.trim() ?? null } : {}),
      ...(body.description !== undefined ? { description: body.description?.trim() ?? null } : {}),
      ...(body.createdBy !== undefined ? { createdBy: body.createdBy?.trim() ?? null } : {}),
      ...(body.expiresAt !== undefined ? { expiresAt: parseDateTimeLocal(body.expiresAt) } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    });

    if (!updated) {
      return reply.code(404).send({ error: 'Link not found' });
    }

    return reply.redirect('/admin/dashboard');
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error }, 'request failed');

    const typedError = error as { statusCode?: number; message?: string };
    const statusCode = typeof typedError.statusCode === 'number'
      ? typedError.statusCode
      : 500;

    if (statusCode === 401) {
      reply.header('WWW-Authenticate', 'Basic realm="Link Shortener Admin"');
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const message = statusCode >= 500 || isProduction
      ? genericMessageForStatus(statusCode)
      : (typedError.message ?? 'Error');

    reply.code(statusCode).send({ error: message });
  });

  return {
    app,
    ready: setup,
  };
}

function normalizeRedirectCode(value: string | number | undefined | null, fallback: number): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (numeric === 301 || numeric === 302 || numeric === 307 || numeric === 308) {
    return numeric;
  }

  return fallback;
}

function parseDateTimeLocal(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function genericMessageForStatus(statusCode: number): string {
  if (statusCode >= 500) return 'Internal Server Error';
  if (statusCode === 400) return 'Bad Request';
  if (statusCode === 401) return 'Unauthorized';
  if (statusCode === 403) return 'Forbidden';
  if (statusCode === 404) return 'Not Found';
  if (statusCode === 409) return 'Conflict';
  if (statusCode === 410) return 'Gone';
  if (statusCode === 413) return 'Payload Too Large';
  if (statusCode === 415) return 'Unsupported Media Type';
  if (statusCode === 422) return 'Unprocessable Entity';
  if (statusCode === 429) return 'Too Many Requests';
  return 'Error';
}
