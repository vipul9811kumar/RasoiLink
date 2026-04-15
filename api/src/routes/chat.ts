import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { query } from '../db.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are RasoiLink's friendly AI assistant helping Indian restaurant workers and owners in the USA find jobs and staff.

You support these languages: English (en), Hindi (hi), Punjabi (pa), Gujarati (gu), Telugu (te), Tamil (ta), Malayalam (ml), Kannada (kn), Bengali (bn).

ALWAYS respond in the same language the user writes in.

Your job during worker onboarding is to collect these fields through friendly conversation:
- role_code: their job role (head_chef, sous_chef, tandoor_chef, biryani_chef, line_cook, pastry_mithai, kitchen_helper, dishwasher, manager, cashier, server, host, delivery_driver)
- years_experience: number of years working
- cuisine_specializations: array of cuisines they know (north_indian, south_indian, punjabi, gujarati, maharashtrian, bengali, kerala, chettinad, hyderabadi, biryani, tandoor, mughlai, street_food, mithai, indo_chinese)
- current_state: US state they currently live in (2-letter code)
- preferred_states: states they'd like to work in
- willing_to_relocate: yes/no
- salary_min_cents: minimum weekly pay in cents (e.g. $500/week = 50000)
- salary_max_cents: maximum weekly pay in cents
- needs_accommodation: do they need housing provided

Once you have collected AT LEAST role_code, years_experience, current_state, salary_min_cents, salary_max_cents and needs_accommodation — output the profile update block immediately, using best guesses for any missing optional fields:
<PROFILE_UPDATE>
{
  "role_code": "tandoor_chef",
  "years_experience": 5,
  "cuisine_specializations": ["tandoor", "north_indian"],
  "current_state": "NJ",
  "preferred_states": ["NJ", "NY"],
  "willing_to_relocate": false,
  "salary_min_cents": 220000,
  "salary_max_cents": 280000,
  "needs_accommodation": false
}
</PROFILE_UPDATE>

Be warm, conversational, and encouraging. Ask one or two questions at a time. Do NOT keep asking questions once you have the core fields — emit the PROFILE_UPDATE block as soon as you have enough information. 
For salary, ask in weekly dollars and convert to cents yourself.
For states, accept full names and convert to 2-letter codes yourself.`;

const MessageSchema = z.object({
  message:      z.string().min(1),
  session_id:   z.string().optional(),
  language_code: z.string().default('en'),
});

export async function chatRoutes(app: FastifyInstance) {

  // POST /chat/message
  app.post('/chat/message', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const parsed = MessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.message, data: null });
    }

    const { message, language_code } = parsed.data;
    let { session_id } = parsed.data;
    const user_id = req.user!.user_id;

    // Get or create session
    let sessionRow;
    if (session_id) {
      const res = await query(
        `SELECT * FROM app.chat_sessions WHERE session_id = $1 AND user_id = $2`,
        [session_id, user_id],
      );
      sessionRow = res.rows[0];
    }

    if (!sessionRow) {
      const res = await query(
        `INSERT INTO app.chat_sessions (user_id, language_code, flow_context)
         VALUES ($1, $2, 'onboarding_worker') RETURNING *`,
        [user_id, language_code],
      );
      sessionRow = res.rows[0];
      session_id = sessionRow.session_id;
    }

    // Load conversation history
    const historyRes = await query(
      `SELECT role, content_text FROM app.chat_messages
       WHERE session_id = $1 ORDER BY created_at ASC LIMIT 20`,
      [session_id],
    );

    const history = historyRes.rows.map(r => ({
      role: r.role as 'user' | 'assistant',
      content: r.content_text,
    }));

    // Add current message to history
    history.push({ role: 'user', content: message });

    // Save user message
    await query(
      `INSERT INTO app.chat_messages (session_id, role, content_text)
       VALUES ($1, 'user', $2)`,
      [session_id, message],
    );

    // Call Claude
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: history,
    });

    const assistantText = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('');

    // Save assistant message
    await query(
      `INSERT INTO app.chat_messages (session_id, role, content_text, tokens_used)
       VALUES ($1, 'assistant', $2, $3)`,
      [session_id, assistantText, response.usage.output_tokens],
    );

    // Check if profile update is ready
    const profileMatch = assistantText.match(/<PROFILE_UPDATE>([\s\S]*?)<\/PROFILE_UPDATE>/);
    if (profileMatch) {
      try {
        const profileData = JSON.parse(profileMatch[1].trim());
        const fields = Object.entries(profileData);
        const setClauses = fields.map(([k], i) => `${k} = $${i + 1}`);
        const values = fields.map(([, v]) => v);
        values.push(user_id);
        await query(
          `UPDATE app.worker_profiles SET ${setClauses.join(', ')}, profile_completeness = 85, updated_at = now()
           WHERE worker_id = $${values.length}`,
          values,
        );
      } catch (e) {
        req.log.warn('Failed to parse profile update from AI response');
      }
    }

    // Update session message count
    await query(
      `UPDATE app.chat_sessions SET message_count = message_count + 1, last_message_at = now()
       WHERE session_id = $1`,
      [session_id],
    );

    return reply.send({
      success: true,
      data: {
        session_id,
        message: assistantText,
        profile_updated: !!profileMatch,
      },
      error: null,
    });
  });

  // GET /chat/sessions — list user's chat sessions
  app.get('/chat/sessions', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const result = await query(
      `SELECT session_id, language_code, flow_context, message_count, last_message_at, created_at
       FROM app.chat_sessions WHERE user_id = $1 ORDER BY last_message_at DESC`,
      [req.user!.user_id],
    );
    return reply.send({ success: true, data: result.rows, error: null });
  });

  // GET /chat/sessions/:session_id/messages
  app.get<{ Params: { session_id: string } }>('/chat/sessions/:session_id/messages', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const result = await query(
      `SELECT role, content_text, created_at FROM app.chat_messages
       WHERE session_id = $1 ORDER BY created_at ASC`,
      [req.params.session_id],
    );
    return reply.send({ success: true, data: result.rows, error: null });
  });
}
