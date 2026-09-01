# Fastify, a working introduction

This covers what you need to build the delivery tracking API. Not the whole framework, just the parts that come up in this project.

## Creating the instance

Everything starts with one call. This instance is what you register routes and plugins on.

```typescript
import Fastify from 'fastify';

const app = Fastify({
  logger: true, // uses pino under the hood, matches the logging choice in the architecture doc
});
```

`logger: true` gives you structured request logs for free, method, URL, status code, response time, without adding anything yourself.

## Routes

A route is a method, a path, and a handler. The handler is an async function that gets `request` and `reply`.

```typescript
app.get('/health', async (request, reply) => {
  return { status: 'ok' };
});
```

Returning a plain object is enough, Fastify serializes it to JSON and sets the content type for you. For more control over the status code, use `reply`:

```typescript
app.post('/shipments', async (request, reply) => {
  const shipment = await createShipment(request.body);
  return reply.code(201).send(shipment);
});
```

`request` carries `request.body`, `request.params`, `request.query`, and `request.headers`. `reply` carries `reply.code()`, `reply.header()`, and `reply.send()`.

## Schema validation with Zod

This is the part that makes Fastify worth learning over Express. You define the shape of a request once, and get both runtime validation and TypeScript types from that one definition.

Install the type provider:

```
npm install fastify-type-provider-zod zod
```

Set it up:

```typescript
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

const app = Fastify().withTypeProvider<ZodTypeProvider>();
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
```

Now routes take a `schema` object built from Zod, and `request.body` is typed automatically, no manual casting.

```typescript
const createShipmentSchema = z.object({
  pickupAddress: z.string().min(1),
  dropoffAddress: z.string().min(1),
});

app.post('/shipments', {
  schema: {
    body: createShipmentSchema,
    response: {
      201: z.object({
        id: z.string().uuid(),
        status: z.string(),
      }),
    },
  },
}, async (request, reply) => {
  // request.body is typed as { pickupAddress: string; dropoffAddress: string }
  const shipment = await createShipment(request.body);
  return reply.code(201).send(shipment);
});
```

If the request body doesn't match the schema, Fastify rejects it with a 400 before your handler code runs. You never write an `if (!pickupAddress) return reply.code(400)` check by hand.

The `response` schema does two things. It validates what you're sending back, catching bugs where a handler returns the wrong shape, and it's what Fastify uses to compile the fast serializer mentioned in the architecture doc. Skipping it still works, but you lose the main performance benefit, so define it for every route.

## Plugins

Plugins are how you add anything beyond a single route: a database connection, a set of related routes, auth logic. Register with `app.register()`.

```typescript
import fp from 'fastify-plugin';

async function dbPlugin(app: FastifyInstance) {
  const db = drizzle(connectionString);
  app.decorate('db', db);
}

app.register(fp(dbPlugin));
```

Wrapping with `fastify-plugin` (the `fp` import) is what makes a decorator like `app.db` visible outside the plugin's own scope. Without it, Fastify encapsulates the plugin, and `app.db` would only exist inside routes registered within that same plugin. This trips up almost everyone the first time, so it's worth remembering deliberately: encapsulated by default, `fp()` opts out of that.

Once registered, every route handler can reach it:

```typescript
app.get('/shipments/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const [shipment] = await app.db.select().from(shipments).where(eq(shipments.id, id));
  return shipment;
});
```

Organize routes as plugins too, once you have more than a handful. A `shipmentRoutes` plugin registered at a prefix keeps related endpoints grouped and versionable.

```typescript
async function shipmentRoutes(app: FastifyInstance) {
  app.post('/shipments', { schema: { body: createShipmentSchema } }, async (request, reply) => {
    // ...
  });
  app.get('/shipments/:id/track', async (request, reply) => {
    // ...
  });
}

app.register(shipmentRoutes, { prefix: '/api' });
```

## Hooks

Hooks run code at fixed points in the request lifecycle, before validation, before the handler, after the response is sent. The one you'll use first is `onRequest`, for things like rate limiting or auth checks that should run before anything else.

```typescript
app.addHook('onRequest', async (request, reply) => {
  request.log.info({ url: request.url }, 'incoming request');
});
```

For the token bucket rate limiter on `POST /couriers/:id/location`, `@fastify/rate-limit` registers as a plugin and applies itself as a hook internally, you won't usually write the hook by hand for that case.

## Error handling

Throw a normal error inside an async handler and Fastify catches it, no try/catch boilerplate required per route.

```typescript
app.get('/shipments/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const [shipment] = await app.db.select().from(shipments).where(eq(shipments.id, id));
  if (!shipment) {
    throw app.httpErrors.notFound('shipment not found');
  }
  return shipment;
});
```

That uses `@fastify/sensible`, a small plugin that adds `app.httpErrors` with helpers like `.notFound()`, `.badRequest()`, `.conflict()`, useful for the 409 the state machine needs to return on an invalid transition.

For anything not explicitly thrown as an HTTP error, set a global handler once:

```typescript
app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  reply.code(500).send({ error: 'internal server error' });
});
```

## Starting the server

```typescript
app.listen({ port: Number(process.env.PORT) || 3000 }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
```

## Full example, wiring it together

This is roughly what `POST /shipments/:id/status` looks like once schema validation, the database, and error handling are all in place.

```typescript
const updateStatusSchema = z.object({
  toStatus: z.enum(['picked_up', 'in_transit', 'delivered', 'failed']),
});

const TRANSITIONS: Record<string, string[]> = {
  created: ['picked_up', 'failed'],
  picked_up: ['in_transit', 'failed'],
  in_transit: ['delivered', 'failed'],
  delivered: [],
  failed: [],
};

app.post('/shipments/:id/status', {
  schema: { body: updateStatusSchema },
}, async (request, reply) => {
  const { id } = request.params as { id: string };
  const { toStatus } = request.body;

  const [shipment] = await app.db.select().from(shipments).where(eq(shipments.id, id));
  if (!shipment) throw app.httpErrors.notFound('shipment not found');

  const allowed = TRANSITIONS[shipment.status] ?? [];
  if (!allowed.includes(toStatus)) {
    throw app.httpErrors.conflict(`cannot move from ${shipment.status} to ${toStatus}`);
  }

  await app.db.update(shipments).set({ status: toStatus }).where(eq(shipments.id, id));
  return { id, status: toStatus };
});
```

## Common early mistakes

Forgetting `fp()` on a plugin, then wondering why `app.db` is undefined in a route registered outside it.

Skipping the `response` schema, then not getting the serialization speed Fastify is chosen for in the first place.

Registering routes directly on `app` instead of grouping them into plugins once the route count grows past five or six, which makes the file hard to navigate later.

Forgetting that `request.body` is untyped as `unknown` until you attach a schema. If a route has no `schema.body`, you're back to casting it by hand.