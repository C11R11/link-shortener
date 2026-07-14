import { and, count, desc, eq, gte, isNull } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import { createDb } from '../db/index.js';
import { linkClicks, links } from '../db/schema.js';

export type LinkRecord = typeof links.$inferSelect;
export type NewLinkInput = {
  slug: string;
  destinationUrl: string;
  redirectStatusCode: number;
  title?: string | null;
  description?: string | null;
  createdBy?: string | null;
  expiresAt?: Date | null;
};

export type LinkStats = {
  link: LinkRecord;
  totalClicks: number;
  clicksLast7Days: number;
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

export function createLinkService(config: AppConfig) {
  const db = createDb(config);

  return {
    db,
    async listLinks() {
      return db.select().from(links).orderBy(desc(links.createdAt));
    },
    async getLinkBySlug(slug: string) {
      const [link] = await db.select().from(links).where(and(eq(links.slug, slug), isNull(links.deletedAt))).limit(1);
      return link ?? null;
    },
    async getLinkById(id: string) {
      const [link] = await db.select().from(links).where(eq(links.id, id)).limit(1);
      return link ?? null;
    },
    async createLink(input: NewLinkInput) {
      const [created] = await db.insert(links).values({
        slug: input.slug,
        destinationUrl: input.destinationUrl,
        redirectStatusCode: input.redirectStatusCode,
        title: input.title ?? null,
        description: input.description ?? null,
        createdBy: input.createdBy ?? null,
        expiresAt: input.expiresAt ?? null,
      }).returning();

      return created;
    },
    async updateLink(id: string, patch: Partial<NewLinkInput> & { status?: 'active' | 'disabled' | 'archived' | null }) {
      const nextValues: Partial<{
        slug: string;
        destinationUrl: string;
        redirectStatusCode: number;
        title: string | null;
        description: string | null;
        createdBy: string | null;
        expiresAt: Date | null;
        status: 'active' | 'disabled' | 'archived';
        updatedAt: Date;
      }> = {
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.destinationUrl !== undefined ? { destinationUrl: patch.destinationUrl } : {}),
        ...(patch.redirectStatusCode !== undefined ? { redirectStatusCode: patch.redirectStatusCode } : {}),
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.createdBy !== undefined ? { createdBy: patch.createdBy } : {}),
        ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
        ...(patch.status !== undefined && patch.status !== null ? { status: patch.status } : {}),
        updatedAt: new Date(),
      };

      const [updated] = await db.update(links).set(nextValues).where(eq(links.id, id)).returning();

      return updated ?? null;
    },
    async disableLink(id: string) {
      const [updated] = await db.update(links).set({
        status: 'disabled',
        updatedAt: new Date(),
      }).where(eq(links.id, id)).returning();

      return updated ?? null;
    },
    async recordClick(link: LinkRecord, event: { referrer?: string | null; userAgent?: string | null; country?: string | null; ipHash?: string | null }) {
      await db.transaction(async (tx) => {
        await tx.insert(linkClicks).values({
          linkId: link.id,
          referrer: event.referrer ?? null,
          userAgent: event.userAgent ?? null,
          country: event.country ?? null,
          ipHash: event.ipHash ?? null,
        });

        await tx.update(links).set({
          clickCount: link.clickCount + 1,
          lastClickedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(links.id, link.id));
      });
    },
    async getLinkStats(id: string): Promise<LinkStats | null> {
      const [link] = await db.select().from(links).where(eq(links.id, id)).limit(1);
      if (!link) {
        return null;
      }

      const [totalRow] = await db.select({ count: count() }).from(linkClicks).where(eq(linkClicks.linkId, id));
      const [recent7Row] = await db.select({ count: count() }).from(linkClicks).where(
        and(eq(linkClicks.linkId, id), gte(linkClicks.clickedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))),
      );
      const referrerRows = await db.select({
        referrer: linkClicks.referrer,
        count: count(),
      }).from(linkClicks).where(eq(linkClicks.linkId, id)).groupBy(linkClicks.referrer);
      const recentClicks = await db.select({
        clickedAt: linkClicks.clickedAt,
        referrer: linkClicks.referrer,
        userAgent: linkClicks.userAgent,
        country: linkClicks.country,
      }).from(linkClicks).where(eq(linkClicks.linkId, id)).orderBy(desc(linkClicks.clickedAt)).limit(10);

      return {
        link,
        totalClicks: Number(totalRow?.count ?? 0),
        clicksLast7Days: Number(recent7Row?.count ?? 0),
        topReferrers: referrerRows
          .map((row) => ({
            referrer: row.referrer ?? '(direct)',
            count: Number(row.count),
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5),
        recentClicks,
      };
    },
  };
}
