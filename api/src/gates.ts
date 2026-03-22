import { query } from './db.js';

export interface PlanFeatures {
  plan_id:          string;
  max_job_posts:    number | null;  // null = unlimited
  can_view_contacts: boolean;
  has_ai_match:     boolean;
  has_whatsapp:     boolean;
}

/** Fetch the active plan features for a user. Always returns something (defaults to free). */
export async function getPlanFeatures(user_id: string): Promise<PlanFeatures> {
  const res = await query<any>(
    `SELECT p.plan_id, p.max_job_posts, p.can_view_contacts, p.has_ai_match, p.has_whatsapp
     FROM app.subscriptions s
     JOIN app.plans p ON s.plan_id = p.plan_id
     WHERE s.user_id = $1 AND s.status = 'active'
     LIMIT 1`,
    [user_id],
  );
  return res.rows[0] ?? {
    plan_id: 'free',
    max_job_posts: 1,
    can_view_contacts: false,
    has_ai_match: false,
    has_whatsapp: false,
  };
}

/** How many active listings does this owner currently have this month? */
export async function getActiveListingCount(owner_id: string): Promise<number> {
  const res = await query<any>(
    `SELECT COUNT(*) as count FROM app.listings
     WHERE owner_id = $1 AND status = 'active'`,
    [owner_id],
  );
  return parseInt(res.rows[0]?.count ?? '0', 10);
}

/** Standard 402 plan gate response */
export function planGateResponse(feature: string, requiredPlan: string) {
  return {
    success: false,
    error:   `${feature} requires the ${requiredPlan} plan or higher. Upgrade to unlock.`,
    data:    null,
    upgrade_required: true,
    required_plan:    requiredPlan,
  };
}
