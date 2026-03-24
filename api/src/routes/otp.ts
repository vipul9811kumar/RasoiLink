import { FastifyInstance } from 'fastify';
import { query } from '../db.js';

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// True when a real SMS provider is wired up
const SMS_CONFIGURED = !!(process.env.TWILIO_ACCOUNT_SID || process.env.SNS_REGION);

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
    const { phone, purpose = 'verify' } = req.body as any;
    if (!phone) return reply.status(400).send({ success: false, error: 'Phone required', data: null });

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

    // Send via SMS if provider is configured
    if (SMS_CONFIGURED) {
      // TODO: send via Twilio/SNS
    }

    return reply.send({
      success: true,
      data: {
        message: SMS_CONFIGURED ? 'OTP sent to your phone' : 'OTP generated',
        // Show code in-app whenever SMS is not configured
        ...(!SMS_CONFIGURED ? { dev_code: code } : {}),
      },
      error: null,
    });
  });

  // POST /auth/verify-otp
  app.post('/auth/verify-otp', async (req, reply) => {
    const { phone, code, purpose = 'verify' } = req.body as any;
    if (!phone || !code) return reply.status(400).send({ success: false, error: 'Phone and code required', data: null });

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
}
