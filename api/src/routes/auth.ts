import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { query } from '../db.js';

const RegisterSchema = z.object({
  phone:     z.string().min(10),
  name:      z.string().min(2),
  password:  z.string().min(8),
  user_type: z.enum(['worker', 'owner']),
  language_code: z.string().default('en'),
});

const LoginSchema = z.object({
  phone:    z.string().min(10),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {

  // POST /auth/register
  app.post('/auth/register', async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.message, data: null });
    }
    const { phone, name, password, user_type, language_code } = parsed.data;

    // Check if phone already exists
    const existing = await query('SELECT user_id FROM app.users WHERE phone = $1', [phone]);
    if (existing.rows.length > 0) {
      return reply.status(409).send({ success: false, error: 'Phone number already registered', data: null });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO app.users (phone, name, user_type, language_code, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING user_id, phone, name, user_type, language_code, created_at`,
      [phone, name, user_type, language_code, password_hash],
    );

    const user = result.rows[0];

    // Create empty profile
    if (user_type === 'worker') {
      await query(
        `INSERT INTO app.worker_profiles (worker_id, role_code, years_experience, current_state, salary_min_cents, salary_max_cents) VALUES ($1, 'kitchen_helper', 0, 'NJ', 140000, 200000)`,
        [user.user_id],
      );
    }

    const token = app.jwt.sign({
      user_id: user.user_id,
      user_type: user.user_type,
      phone: user.phone,
    });

    return reply.status(201).send({
      success: true,
      data: { user, token },
      error: null,
    });
  });

  // POST /auth/login
  app.post('/auth/login', async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.message, data: null });
    }
    const { phone, password } = parsed.data;

    const result = await query(
      `SELECT user_id, phone, name, user_type, password_hash, is_active
       FROM app.users WHERE phone = $1`,
      [phone],
    );

    const user = result.rows[0];
    if (!user) {
      return reply.status(401).send({ success: false, error: 'Invalid credentials', data: null });
    }
    if (!user.is_active) {
      return reply.status(403).send({ success: false, error: 'Account suspended', data: null });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ success: false, error: 'Invalid credentials', data: null });
    }

    const token = app.jwt.sign({
      user_id: user.user_id,
      user_type: user.user_type,
      phone: user.phone,
    });

    return reply.send({
      success: true,
      data: {
        token,
        user: {
          user_id: user.user_id,
          phone: user.phone,
          name: user.name,
          user_type: user.user_type,
        },
      },
      error: null,
    });
  });

  // GET /auth/me
  app.get('/auth/me', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const result = await query(
      `SELECT user_id, phone, name, user_type, language_code, trust_score, is_verified, created_at
       FROM app.users WHERE user_id = $1`,
      [req.user!.user_id],
    );
    if (!result.rows[0]) {
      return reply.status(404).send({ success: false, error: 'User not found', data: null });
    }
    return reply.send({ success: true, data: result.rows[0], error: null });
  });
}
