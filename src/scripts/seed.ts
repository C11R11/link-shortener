import { createDb } from '../db/index.js';
import { links, linkClicks } from '../db/schema.js';
import { loadConfig } from '../config.js';

const referrers = ['google.com', 'x.com', 'reddit.com', 'news.ycombinator.com', 'linkedin.com', null];
const userAgents = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36',
];
const countries = ['US', 'AR', 'ES', 'DE', 'BR', 'MX', 'CA', null];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}

function randomDateWithin(days: number): Date {
  const now = Date.now();
  const offset = randomInt(0, days * 24 * 60 * 60 * 1000);
  return new Date(now - offset);
}

async function main() {
  const config = loadConfig();
  const db = createDb(config);

  const seedLinks = [
    { slug: 'launch', destinationUrl: 'https://getkimchi.com', title: 'Kimchi launch', status: 'active' as const },
    { slug: 'docs', destinationUrl: 'https://docs.example.com', title: 'Documentation', status: 'active' as const },
    { slug: 'blog', destinationUrl: 'https://blog.example.com', title: 'Blog post', status: 'active' as const },
    { slug: 'old-campaign', destinationUrl: 'https://example.com/old', title: 'Old campaign', status: 'archived' as const },
  ];

  console.log('Cleaning existing seed data...');
  const existing = await db.select({ id: links.id }).from(links).where(inArray(links.slug, seedLinks.map((l) => l.slug)));
  if (existing.length > 0) {
    const ids = existing.map((l) => l.id);
    await db.delete(linkClicks).where(inArray(linkClicks.linkId, ids));
    await db.delete(links).where(inArray(links.id, ids));
  }

  console.log('Seeding links...');
  const created = await db.insert(links).values(seedLinks).returning();

  for (const link of created) {
    const clickCount = randomInt(50, 300);
    const clickRows = Array.from({ length: clickCount }).map(() => ({
      linkId: link.id,
      clickedAt: randomDateWithin(30),
      referrer: randomItem(referrers),
      userAgent: randomItem(userAgents),
      country: randomItem(countries),
      ipHash: `hash-${randomInt(1, 20)}`,
    }));

    await db.insert(linkClicks).values(clickRows);
    await db.update(links).set({ clickCount }).where(eq(links.id, link.id));
    console.log(`  ${link.slug}: ${clickCount} clicks`);
  }

  console.log('Seed complete.');
  process.exit(0);
}

import { eq, inArray } from 'drizzle-orm';

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
