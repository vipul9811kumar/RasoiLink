import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { authRoutes }    from './routes/auth.js';
import { workerRoutes }  from './routes/workers.js';
import { ownerRoutes }   from './routes/owners.js';
import { listingRoutes } from './routes/listings.js';
import { chatRoutes }    from './routes/chat.js';
import { offerRoutes }   from './routes/offers.js';
import { payRoutes }          from './routes/pay.js';
import { notificationRoutes } from './routes/notifications.js';
import { otpRoutes }           from './routes/otp.js';
import { AuthUser } from './types.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const IS_DEV = process.env.NODE_ENV !== 'production';

const app = Fastify({
  logger: {
    level: 'info',
    transport: IS_DEV ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  },
});

await app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
});

await app.register(jwt, {
  secret: process.env.JWT_SECRET ?? 'dev_secret',
});

// Auth decorator
app.decorate('authenticate', async (req: any, reply: any) => {
  try {
    const payload = await req.jwtVerify() as AuthUser;
    req.user = payload;
  } catch {
    reply.status(401).send({ success: false, error: 'Unauthorized', data: null });
  }
});

// Health check
app.get('/health', async () => ({
  status: 'ok',
  service: 'rasoilink-api',
  version: '1.0.0',
}));

// Routes
await app.register(authRoutes);
await app.register(workerRoutes);
await app.register(ownerRoutes);
await app.register(listingRoutes);
await app.register(chatRoutes);
await app.register(offerRoutes);
await app.register(payRoutes);
await app.register(notificationRoutes);
await app.register(otpRoutes);

try {
  await app.listen({ port: PORT, host: process.env.HOST ?? '0.0.0.0' });
  app.log.info(`RasoiLink API running on port ${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
