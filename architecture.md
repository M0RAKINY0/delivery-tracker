# Delivery tracking system, architecture

## Purpose

The whole product is one thing: a customer sees their package's location on a map, updating in real time. A shipment gets created, a courier gets attached to it, the courier's phone sends location pings, and the customer's screen updates as those pings arrive. That's it. No matching algorithm, no multiple couriers competing for a shipment, no pricing. This project teaches you the fundamentals. The Uber MVP is a separate, later project that reuses some of these ideas and adds the harder problems on top, like matching and contention.

## Tech stack

- Node.js + TypeScript
- Postgres for storage
- Redis for caching and rate limiting
- Socket.io for pushing live location updates to the browser
- Leaflet or Mapbox for the map on the frontend

## Recommended dependencies

- **Fastify over Express** for the HTTP layer. Fastify compiles a serializer per route from a schema instead of walking the response object with JSON.stringify on every call, which makes it measurably faster under load. Express works fine too, Fastify's just the better default if you want the practice.
- **postgres.js over pg** for the Postgres client. Lower per-query overhead, and tagged template queries mean you get parameterized SQL without an ORM sitting in between.
- **Drizzle**, on top of postgres.js. At three tables this is more setup than the project strictly needs, but you're using it to learn it, so that's fine. Define the schema in `src/db/schema.ts` with Drizzle's `pgTable`, and use `drizzle-orm/postgres-js` to get a typed query builder over the same postgres.js connection. Run `drizzle-kit generate` and `drizzle-kit migrate` instead of hand-writing `schema.sql`, so the schema in code stays the source of truth.
- **ioredis over node-redis.** Better connection pooling once the rate limiter and cache invalidation are both hitting Redis from the same process.
- **ws over Socket.io**, if you want to manage reconnection logic yourself and skip the extra framing protocol Socket.io adds. Socket.io is the easier path if you'd rather have room-based subscriptions handled for you. Genuine tradeoff, either is a reasonable pick.
- **Zod** for request validation, paired with Fastify's schema compilation so validation and response shape share one definition instead of two.
- **pino over the default console logger.** Structured, asynchronous JSON logging, useful once the location ping endpoint is getting hit every few seconds.

## Startup guide

1. **Set up Postgres.** A free Supabase project or a local install both work fine, no extensions needed for this version.
2. **Set up Redis.** A free Upstash instance, or `docker run -p 6379:6379 redis` locally.
3. **Init the project.**
   ```
   mkdir delivery-tracking && cd delivery-tracking
   npm init -y
   npm install fastify postgres drizzle-orm ioredis ws zod pino
   npm install -D typescript tsx @types/node drizzle-kit
   npx tsc --init
   ```
4. **Set environment variables.** A `.env` with `DATABASE_URL`, `REDIS_URL`, and `PORT`. Load them with Node's built-in `--env-file` flag on Node 20+, or a small `dotenv` import otherwise.
5. **Write the Drizzle schema.** Translate the tables from the data model section into `src/db/schema.ts` using `pgTable`. Add a `drizzle.config.ts` pointing at that file and your `DATABASE_URL`, then run `npx drizzle-kit generate` to produce the migration SQL and `npx drizzle-kit migrate` to apply it.
6. **Write the entry file.** A single `src/server.ts` that boots Fastify, registers the endpoints as stubs returning 501, and listens on `PORT`. Confirm it boots with `npx tsx src/server.ts` before writing real logic.
7. **Add a health check.** `GET /health` that runs `SELECT 1` against Postgres and pings Redis, returns 200 if both succeed. Catches connection mistakes before you build on top of them.
8. **Implement the endpoints one at a time**, in the order listed below, replacing each stub as you go.

## Data model

Three tables, defined in `src/db/schema.ts`.

```typescript
import { pgTable, uuid, text, doublePrecision, timestamp, index } from 'drizzle-orm/pg-core';

export const couriers = pgTable('couriers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
});

export const shipments = pgTable('shipments', {
  id: uuid('id').primaryKey().defaultRandom(),
  pickupAddress: text('pickup_address').notNull(),
  dropoffAddress: text('dropoff_address').notNull(),
  status: text('status').notNull().default('created'),
  courierId: uuid('courier_id').references(() => couriers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const locationPings = pgTable('location_pings', {
  id: uuid('id').primaryKey().defaultRandom(),
  courierId: uuid('courier_id').notNull().references(() => couriers.id),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  courierIdx: index('idx_location_pings_courier').on(table.courierId, table.recordedAt),
}));
```

Plain latitude and longitude columns are enough here. No geospatial extension needed since there's no distance-based matching to do, that's the Uber MVP's job. Query through Drizzle's builder, for example `db.select().from(locationPings).where(eq(locationPings.courierId, id)).orderBy(desc(locationPings.recordedAt)).limit(20)` for the `/track` endpoint, rather than hand-written SQL strings.

## State machine

Five states: `created`, `picked_up`, `in_transit`, `delivered`, `failed`.

```
created    -> picked_up, failed
picked_up  -> in_transit, failed
in_transit -> delivered, failed
delivered  -> (none)
failed     -> (none)
```

```typescript
const TRANSITIONS: Record<string, string[]> = {
  created: ['picked_up', 'failed'],
  picked_up: ['in_transit', 'failed'],
  in_transit: ['delivered', 'failed'],
  delivered: [],
  failed: [],
};
```

Check every status update against this table before writing it. Reject anything not listed with a 409.

## API endpoints

Build these in order.

1. `POST /shipments` — creates a shipment, status defaults to `created`.
2. `POST /shipments/:id/assign` — sets `courier_id` on the shipment.
3. `POST /couriers/:id/location` — inserts a row into `location_pings`.
4. `POST /shipments/:id/status` — validates the transition against the state machine, updates `shipments.status`.
5. `GET /shipments/:id/track` — returns current status plus the last 20 rows from `location_pings` for the assigned courier.

## Real-time updates

A client subscribes to a Socket.io room keyed by `shipment_id`. Whenever a new row lands in `location_pings` for that courier's shipment, or the status changes, emit an update to the room. The browser just listens and moves the pin, no polling.

## Caching

Cache `GET /shipments/:id/track` in Redis with a short TTL, invalidate it on any new ping or status change for that shipment. This is the endpoint that gets read constantly by anyone watching the map, so it's the one worth caching.

## Rate limiting

Apply a token bucket limiter to `POST /couriers/:id/location`, since that's the endpoint getting hit every few seconds by the courier's phone.

## Build order

**Week one:** the first four endpoints, no frontend. Test with curl or Postman.

**Week two:** `/track`, then Socket.io so a subscribed client gets pushed updates.

**Week three:** Redis caching on `/track`, rate limiting on the location ping endpoint.

**Week four:** frontend map with a moving pin, using Leaflet or Mapbox.

## Testing priorities

- State machine: assert every invalid transition gets rejected, not just that valid ones succeed.
- Location pings: seed a few pings for a courier, assert `/track` returns them in the right order and caps at 20.

## Deployment

Postgres on Supabase or any small managed instance. Redis on Upstash or self-hosted. The API runs on any standard Node host to start.

## Relationship to the Uber MVP

This project and the Uber MVP are separate builds, not phases of one system. This one teaches you the state machine, the real-time pipeline, and caching and rate limiting on a hot endpoint. The Uber MVP is where you'd add the parts this project skips on purpose: matching a rider to one of several available drivers by distance, handling contention when two riders want the same driver, and pricing. Start that one once this one is done and working, not before.