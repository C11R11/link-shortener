import { z } from 'zod';

const envSchema = z.object({
  APP_PORT: z.coerce.number().int().positive().default(3000),
  SHORTENER_DOMAIN: z.string().min(1),
  SHORTENER_SCHEME: z.enum(['http', 'https']).default('https'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(604800),
  SESSION_COOKIE_NAME: z.string().min(1).default('link_shortener_session'),
  CSRF_COOKIE_NAME: z.string().min(1).default('link_shortener_csrf'),
  ADMIN_TOKEN: z.string().min(1).optional(),
  REDIRECT_STATUS_CODE: z.coerce.number().int().refine((value) => value === 301 || value === 302 || value === 307 || value === 308, {
    message: 'REDIRECT_STATUS_CODE must be 301, 302, 307, or 308',
  }).default(302),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}

export function getBaseUrl(config: AppConfig): string {
  return `${config.SHORTENER_SCHEME}://${config.SHORTENER_DOMAIN}`;
}
