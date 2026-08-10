import { relations } from 'drizzle-orm';
import { integer, pgTable, text, timestamp, uuid, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const links = pgTable('links', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  destinationUrl: text('destination_url').notNull(),
  redirectStatusCode: integer('redirect_status_code').notNull().default(302),
  title: text('title'),
  description: text('description'),
  status: text('status').notNull().default('active'),
  clickCount: integer('click_count').notNull().default(0),
  lastClickedAt: timestamp('last_clicked_at', { withTimezone: true }),
  createdBy: text('created_by'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  slugIdx: uniqueIndex('links_slug_unique').on(table.slug),
  statusIdx: index('links_status_idx').on(table.status),
}));

export const linkClicks = pgTable('link_clicks', {
  id: uuid('id').primaryKey().defaultRandom(),
  linkId: uuid('link_id').notNull().references(() => links.id, { onDelete: 'cascade' }),
  clickedAt: timestamp('clicked_at', { withTimezone: true }).notNull().defaultNow(),
  referrer: text('referrer'),
  userAgent: text('user_agent'),
  country: text('country'),
  ipHash: text('ip_hash'),
  ipAddress: text('ip_address'),
});

export const linkRelations = relations(links, ({ many }) => ({
  clicks: many(linkClicks),
}));

export const clickRelations = relations(linkClicks, ({ one }) => ({
  link: one(links, {
    fields: [linkClicks.linkId],
    references: [links.id],
  }),
}));
