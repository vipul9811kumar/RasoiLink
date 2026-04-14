import { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { sendOtpWhatsApp, WHATSAPP_ENABLED, normalizePhone } from '../whatsapp.js';

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}


async function ensureOtpTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS app.otps (
      otp_id        TEXT        NOT NULL PRIMARY KEY DEFAULT gen_ulid(),
      phone         TEXT        NOT NULL,
      code          VARCHAR(6)  NOT NULL,
      purpose       VARCHAR(20) NOT NULL DEFAULT 'verify',
      attempt_count INT         NOT NULL DEFAULT 0,
      used_at       TIMESTAMPTZ,
      expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '10 minutes',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function otpRoutes(app: FastifyInstance) {

  // Ensure the table exists on first load (handles missing migration on Railway)
  await ensureOtpTable();

  // POST /auth/send-otp
  app.post('/auth/send-otp', async (req, reply) => {
    const { phone: rawPhone, purpose = 'verify', name } = req.body as any;
    if (!rawPhone) return reply.status(400).send({ success: false, error: 'Phone required', data: null });
    const phone = normalizePhone(rawPhone);

    // Invalidate old OTPs for this phone+purpose
    await query(`
      UPDATE app.otps SET used_at = now()
      WHERE phone = $1 AND purpose = $2 AND used_at IS NULL
    `, [phone, purpose]);

    const code = generateOTP();

    await query(`
      INSERT INTO app.otps (phone, code, purpose)
      VALUES ($1, $2, $3)
    `, [phone, code, purpose]);

    console.log(`\n🔐 OTP for ${phone}: ${code}\n`);

    // WHATSAPP TEMPORARILY DISABLED — re-enable when AiSensy templates approved
    // if (WHATSAPP_ENABLED) {
    //   await sendOtpWhatsApp(phone, code, name);
    // }

    // Always return the code in the response so the app can show it to the user
    return reply.send({
      success: true,
      data: {
        message: 'Your login code is ready',
        login_code: code,
      },
      error: null,
    });
  });

  // POST /auth/verify-otp
  app.post('/auth/verify-otp', async (req, reply) => {
    const { phone: rawPhone, code, purpose = 'verify' } = req.body as any;
    if (!rawPhone || !code) return reply.status(400).send({ success: false, error: 'Phone and code required', data: null });
    const phone = normalizePhone(rawPhone);

    // Find valid OTP
    const result = await query(`
      SELECT otp_id, attempt_count FROM app.otps
      WHERE phone = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1
    `, [phone, purpose]);

    if (!result.rows.length) {
      return reply.status(400).send({ success: false, error: 'OTP expired or not found. Please request a new one.', data: null });
    }

    const otp = result.rows[0];

    // Max 5 attempts
    if (otp.attempt_count >= 5) {
      await query(`UPDATE app.otps SET used_at = now() WHERE otp_id = $1`, [otp.otp_id]);
      return reply.status(400).send({ success: false, error: 'Too many attempts. Please request a new OTP.', data: null });
    }

    // Increment attempt
    await query(`UPDATE app.otps SET attempt_count = attempt_count + 1 WHERE otp_id = $1`, [otp.otp_id]);

    // Check code
    const valid = await query(`
      SELECT otp_id FROM app.otps WHERE otp_id = $1 AND code = $2
    `, [otp.otp_id, code]);

    if (!valid.rows.length) {
      return reply.status(400).send({ success: false, error: 'Invalid OTP. Please try again.', data: null });
    }

    // Mark used
    await query(`UPDATE app.otps SET used_at = now() WHERE otp_id = $1`, [otp.otp_id]);

    // If user already exists, mark verified
    await query(`UPDATE app.users SET is_verified = true WHERE phone = $1`, [phone]);

    return reply.send({ success: true, data: { verified: true, phone }, error: null });
  });

  // POST /auth/otp-login
  // Verify OTP, auto-register if new user, return JWT + is_new flag.
  app.post('/auth/otp-login', async (req, reply) => {
    const { phone: rawPhone, code, name, user_type = 'worker', language_code = 'en' } = req.body as any;
    if (!rawPhone || !code) {
      return reply.status(400).send({ success: false, error: 'Phone and code required', data: null });
    }
    const phone = normalizePhone(rawPhone);

    // Find valid OTP (any purpose)
    const otpRes = await query(`
      SELECT otp_id, attempt_count, code FROM app.otps
      WHERE phone = $1 AND used_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1
    `, [phone]);

    if (!otpRes.rows.length) {
      return reply.status(400).send({ success: false, error: 'OTP expired or not found. Request a new one.', data: null });
    }

    const otp = otpRes.rows[0];

    if (otp.attempt_count >= 5) {
      await query(`UPDATE app.otps SET used_at = now() WHERE otp_id = $1`, [otp.otp_id]);
      return reply.status(400).send({ success: false, error: 'Too many attempts. Request a new code.', data: null });
    }

    await query(`UPDATE app.otps SET attempt_count = attempt_count + 1 WHERE otp_id = $1`, [otp.otp_id]);

    if (otp.code !== code) {
      return reply.status(400).send({ success: false, error: 'Invalid code. Try again.', data: null });
    }

    // Mark OTP used
    await query(`UPDATE app.otps SET used_at = now() WHERE otp_id = $1`, [otp.otp_id]);

    // Check if user exists
    let userRow = await query(
      `SELECT user_id, phone, name, user_type, language_code, trust_score, is_verified, created_at FROM app.users WHERE phone = $1`,
      [phone],
    );

    let is_new = false;

    if (!userRow.rows.length) {
      // Auto-register new user
      const inserted = await query(
        `INSERT INTO app.users (phone, name, user_type, language_code, is_verified, password_hash)
         VALUES ($1, $2, $3, $4, true, '')
         RETURNING user_id, phone, name, user_type, language_code, trust_score, is_verified, created_at`,
        [phone, name?.trim() || 'New User', user_type, language_code],
      );
      const uid = inserted.rows[0].user_id;

      if (user_type === 'worker') {
        await query(
          `INSERT INTO app.worker_profiles (worker_id, role_code, years_experience, current_state, salary_min_cents, salary_max_cents)
           VALUES ($1, 'kitchen_helper', 0, 'NJ', 140000, 200000)`,
          [uid],
        );
      } else {
        await query(
          `INSERT INTO app.owner_profiles (owner_id, restaurant_name, restaurant_address, city, state, zip_code)
           VALUES ($1, 'My Restaurant', '123 Main St', 'Edison', 'NJ', '08817')`,
          [uid],
        );
      }

      userRow = inserted;
      is_new = true;
    } else {
      await query(`UPDATE app.users SET is_verified = true WHERE phone = $1`, [phone]);
    }

    const user = userRow.rows[0];
    const token = app.jwt.sign({ user_id: user.user_id, user_type: user.user_type, phone: user.phone });

    return reply.send({ success: true, data: { token, user, is_new }, error: null });
  });
}
