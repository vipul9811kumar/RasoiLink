import { FastifyInstance } from 'fastify';
import { query } from '../db.js';

// Helper to create a notification
export async function createNotification({
  user_id, event_type, title, body, related_entity_id, related_entity_type, deep_link, language_code = 'en', dedup_key,
}: {
  user_id: string; event_type: string; title: string; body: string;
  related_entity_id?: string; related_entity_type?: string;
  deep_link?: string; language_code?: string; dedup_key?: string;
}) {
  try {
    await query(`
      INSERT INTO app.notifications (
        user_id, event_type, channel, language_code,
        title, body, deep_link,
        related_entity_id, related_entity_type, dedup_key, status
      ) VALUES ($1,$2,'push',$3,$4,$5,$6,$7,$8,$9,'sent')
    `, [
      user_id, event_type, language_code.trim(),
      title, body, deep_link ?? null,
      related_entity_id ?? null, related_entity_type ?? null,
      dedup_key ?? null,
    ]);
  } catch (e: any) {
    // Ignore dedup conflicts silently
    if (e.code !== '23P01') console.error('Notification error:', e.message);
  }
}

export async function notificationRoutes(app: FastifyInstance) {

  // GET /notifications — get user's notifications
  app.get('/notifications', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const user_id = (req.user as any).user_id;
    const result = await query(`
      SELECT
        notification_id, event_type, title, body,
        deep_link, status, related_entity_id, related_entity_type,
        created_at, sent_at
      FROM app.notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [user_id]);

    const unread = result.rows.filter((n: any) => n.status === 'sent').length;

    return reply.send({
      success: true,
      data: { notifications: result.rows, unread },
      error: null,
    });
  });

  // PATCH /notifications/:id/read — mark as delivered (read)
  app.patch<{ Params: { id: string } }>('/notifications/:id/read', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    await query(`
      UPDATE app.notifications SET status = 'delivered', delivered_at = now()
      WHERE notification_id = $1
    `, [req.params.id]);
    return reply.send({ success: true, data: null, error: null });
  });

  // PATCH /notifications/read-all — mark all as read
  app.patch('/notifications/read-all', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const user_id = (req.user as any).user_id;
    await query(`
      UPDATE app.notifications SET status = 'delivered', delivered_at = now()
      WHERE user_id = $1 AND status = 'sent'
    `, [user_id]);
    return reply.send({ success: true, data: null, error: null });
  });
}
