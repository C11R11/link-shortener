import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import crypto from 'node:crypto';
import { loadConfig, getBaseUrl } from './config.js';
import { createLinkService } from './lib/links.js';

const config = loadConfig();
const app = Fastify({ logger: true });
const links = createLinkService(config);

await app.register(helmet);
await app.register(rateLimit, {
  global: true,
  max: 120,
  timeWindow: '1 minute',
});

function requireAdmin(request: { headers: Record<string, unknown> }) {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || header !== `Bearer ${config.ADMIN_TOKEN}`) {
    const error = new Error('Unauthorized');
    // @ts-expect-error Fastify decorations are runtime-only here
    error.statusCode = 401;
    throw error;
  }
}

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
    title: body.title?.trim() || null,
    description: body.description?.trim() || null,
    createdBy: body.createdBy?.trim() || null,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
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
    title?: string | null;
    description?: string | null;
    createdBy?: string | null;
    expiresAt?: string | null;
    status?: 'active' | 'disabled' | 'archived';
  };

  const updated = await links.updateLink(id, {
    ...(body.slug !== undefined ? { slug: body.slug.trim() } : {}),
    ...(body.destinationUrl !== undefined ? { destinationUrl: body.destinationUrl.trim() } : {}),
    ...(body.title !== undefined ? { title: body.title?.trim() ?? null } : {}),
    ...(body.description !== undefined ? { description: body.description?.trim() ?? null } : {}),
    ...(body.createdBy !== undefined ? { createdBy: body.createdBy?.trim() ?? null } : {}),
    ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null } : {}),
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
  if (!slug || slug.startsWith('api/') || slug === 'healthz') {
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

  reply.code(config.REDIRECT_STATUS_CODE);
  return reply.redirect(link.destinationUrl);
});

app.setErrorHandler((error, request, reply) => {
  request.log.error({ error }, 'request failed');

  const typedError = error as { statusCode?: number; message?: string };
  const statusCode = typeof typedError.statusCode === 'number'
    ? typedError.statusCode
    : 500;

  reply.code(statusCode).send({
    error: statusCode === 500 ? 'Internal Server Error' : (typedError.message ?? 'Error'),
  });
});

const port = config.APP_PORT;
await app.listen({ port, host: '0.0.0.0' });
