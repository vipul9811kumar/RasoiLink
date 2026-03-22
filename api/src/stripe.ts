import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-02-25.clover',
  typescript: true,
});

// Price IDs — create these in Stripe Dashboard → Products
// then paste the price_xxx IDs here
export const PRICES = {
  owner_starter:   process.env.STRIPE_PRICE_STARTER        ?? '',  // $39/mo
  owner_growth:    process.env.STRIPE_PRICE_GROWTH         ?? '',  // $99/mo
  worker_boost:    process.env.STRIPE_PRICE_WORKER_BOOST   ?? '',  // $7/mo
  hire_fee:        process.env.STRIPE_PRICE_HIRE_FEE       ?? '',  // $149 one-time
  job_boost:       process.env.STRIPE_PRICE_JOB_BOOST      ?? '',  // $29 one-time
  course:          process.env.STRIPE_PRICE_COURSE         ?? '',  // $19 one-time
  background_check:process.env.STRIPE_PRICE_BG_CHECK       ?? '',  // $15 one-time
} as const;

export type PlanId = 'free' | 'starter' | 'growth' | 'worker_boost';

export const PLAN_FROM_PRICE: Record<string, PlanId> = {
  [process.env.STRIPE_PRICE_STARTER      ?? '__starter__']: 'starter',
  [process.env.STRIPE_PRICE_GROWTH       ?? '__growth__']:  'growth',
  [process.env.STRIPE_PRICE_WORKER_BOOST ?? '__boost__']:   'worker_boost',
};
