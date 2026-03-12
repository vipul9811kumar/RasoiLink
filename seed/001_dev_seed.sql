BEGIN;

INSERT INTO app.users (user_id, phone, user_type, name, language_code, trust_score, is_verified, password_hash) VALUES
  ('usr_worker_rajesh_000001', '+12015550101', 'worker', 'Rajesh Kumar',    'hi', 4.2, true,  'dev_hash'),
  ('usr_worker_priya_0000002', '+12015550102', 'worker', 'Priya Sharma',    'te', 3.8, true,  'dev_hash'),
  ('usr_worker_gurpreet_0003', '+12015550103', 'worker', 'Gurpreet Singh',  'pa', 4.5, true,  'dev_hash'),
  ('usr_worker_ananya_000004', '+12015550104', 'worker', 'Ananya Patel',    'gu', 3.1, false, 'dev_hash'),
  ('usr_worker_irfan_0000005', '+12015550105', 'worker', 'Mohammed Irfan',  'hi', 4.0, true,  'dev_hash'),
  ('usr_worker_lakshmi_00006', '+12015550106', 'worker', 'Lakshmi Nair',    'ml', 0.0, false, 'dev_hash'),
  ('usr_owner_vikram_0000007', '+12015550201', 'owner',  'Vikram Malhotra', 'hi', 4.3, true,  'dev_hash'),
  ('usr_owner_sunita_0000008', '+12015550202', 'owner',  'Sunita Agarwal',  'hi', 3.9, true,  'dev_hash'),
  ('usr_owner_kiran_00000009', '+12015550203', 'owner',  'Kiran Reddy',     'te', 4.1, true,  'dev_hash'),
  ('usr_owner_harjinder_0010', '+12015550204', 'owner',  'Harjinder Bains', 'pa', 3.7, true,  'dev_hash');

INSERT INTO app.worker_profiles (worker_id, role_code, years_experience, cuisine_specializations, current_state, preferred_states, willing_to_relocate, salary_min_cents, salary_max_cents, needs_accommodation, profile_completeness) VALUES
  ('usr_worker_rajesh_000001', 'tandoor_chef',   6, ARRAY['tandoor','north_indian','mughlai'],  'NJ', ARRAY['NJ','NY','CT'], false, 220000, 280000, false, 90),
  ('usr_worker_priya_0000002', 'line_cook',       3, ARRAY['south_indian','kerala','chettinad'], 'TX', ARRAY['TX','CA'],      false, 180000, 220000, true,  85),
  ('usr_worker_gurpreet_0003', 'head_chef',      12, ARRAY['punjabi','north_indian','tandoor'],  'IL', ARRAY['IL','IN','MI'], false, 380000, 450000, false, 95),
  ('usr_worker_ananya_000004', 'pastry_mithai',   2, ARRAY['mithai','gujarati'],                 'NJ', ARRAY['NJ','NY'],      true,  160000, 200000, true,  60),
  ('usr_worker_irfan_0000005', 'biryani_chef',    8, ARRAY['biryani','hyderabadi','mughlai'],    'CA', ARRAY['CA','TX','NJ'], true,  260000, 320000, true,  88),
  ('usr_worker_lakshmi_00006', 'kitchen_helper',  0, ARRAY['south_indian'],                     'NJ', ARRAY['NJ'],           false, 140000, 160000, true,  35);

INSERT INTO app.owner_profiles (owner_id, restaurant_name, restaurant_address, city, state, zip_code, cuisine_types, seat_count, staff_count, biz_verified, pay_reliability_score) VALUES
  ('usr_owner_vikram_0000007', 'Spice Route Kitchen', '123 Oak Tree Rd', 'Edison',  'NJ', '08817', ARRAY['north_indian','tandoor','mughlai'], 80, 12, true, 4.4),
  ('usr_owner_sunita_0000008', 'Chaat House',         '5800 Hillcroft Ave', 'Houston', 'TX', '77036', ARRAY['street_food','north_indian'],       45,  7, true, 3.8),
  ('usr_owner_kiran_00000009', 'Golconda Biryani',    '39159 Fremont Blvd', 'Fremont', 'CA', '94536', ARRAY['biryani','hyderabadi'],             60,  9, true, 4.2),
  ('usr_owner_harjinder_0010', 'Punjab Palace',       '2540 W Devon Ave', 'Chicago', 'IL', '60659', ARRAY['punjabi','north_indian','tandoor'], 70, 10, true, 3.6);

INSERT INTO app.listings (listing_id, owner_id, title, role_code, cuisine_required, state, city, pay_min_cents, pay_max_cents, pay_frequency, hours_per_week, years_exp_required, accommodation_provided, accommodation_address, accommodation_cost_cents, description_en, status) VALUES
  ('lst_spiceroute_tandoor_01', 'usr_owner_vikram_0000007', 'Tandoor Chef - Spice Route',  'tandoor_chef',   ARRAY['tandoor','north_indian'], 'NJ', 'Edison',  240000, 290000, 'weekly', 45, 4, false, NULL,                    0,     'Experienced tandoor chef needed. Must know naan, roti, and kebabs.', 'active'),
  ('lst_spiceroute_linecook02', 'usr_owner_vikram_0000007', 'Line Cook - North Indian',    'line_cook',      ARRAY['north_indian','mughlai'],  'NJ', 'Edison',  180000, 220000, 'weekly', 40, 2, true,  '123 Oak Tree Rd Edison NJ', 50000, 'Line cook for busy North Indian kitchen. Accommodation available.', 'active'),
  ('lst_chaathse_streetfood03', 'usr_owner_sunita_0000008', 'Chaat Specialist',            'line_cook',      ARRAY['street_food'],             'TX', 'Houston', 170000, 210000, 'weekly', 40, 1, false, NULL,                    0,     'Chaat and street food specialist for high-volume Houston restaurant.', 'active'),
  ('lst_chaathse_manager_004',  'usr_owner_sunita_0000008', 'Restaurant Manager',          'manager',        ARRAY['north_indian'],            'TX', 'Houston', 320000, 380000, 'weekly', 45, 5, false, NULL,                    0,     'Experienced restaurant manager for growing Houston location.', 'paused'),
  ('lst_golconda_biryani_005',  'usr_owner_kiran_00000009', 'Biryani Chef - Golconda',     'biryani_chef',   ARRAY['biryani','hyderabadi'],    'CA', 'Fremont', 270000, 330000, 'weekly', 45, 5, true,  '39159 Fremont Blvd Fremont CA', 40000, 'Expert biryani chef for authentic Hyderabadi restaurant in Fremont.', 'active'),
  ('lst_golconda_helper_0006',  'usr_owner_kiran_00000009', 'Kitchen Helper',              'kitchen_helper', ARRAY['biryani'],                 'CA', 'Fremont', 140000, 160000, 'weekly', 40, 0, true,  '39159 Fremont Blvd Fremont CA', 0,  'Kitchen helper needed. Free accommodation provided. No experience required.', 'active'),
  ('lst_punjab_headchef_0007',  'usr_owner_harjinder_0010', 'Head Chef - Punjab Palace',   'head_chef',      ARRAY['punjabi','tandoor'],       'IL', 'Chicago', 400000, 480000, 'weekly', 50, 8, false, NULL,                    0,     'Senior head chef for established Punjabi restaurant on Devon Ave Chicago.', 'active'),
  ('lst_punjab_linecook_0008',  'usr_owner_harjinder_0010', 'Line Cook - Punjabi Cuisine', 'line_cook',      ARRAY['punjabi','north_indian'],  'IL', 'Chicago', 190000, 230000, 'weekly', 40, 2, true,  '2540 W Devon Ave Chicago IL',  30000, 'Line cook for Punjabi kitchen. Shared accommodation available nearby.', 'active');

INSERT INTO app.verifications (user_id, verification_type, status, passed_at) VALUES
  ('usr_worker_rajesh_000001', 'identity',     'passed', now() - INTERVAL '30 days'),
  ('usr_worker_rajesh_000001', 'work_history', 'passed', now() - INTERVAL '28 days'),
  ('usr_worker_priya_0000002', 'identity',     'passed', now() - INTERVAL '20 days'),
  ('usr_worker_gurpreet_0003', 'identity',     'passed', now() - INTERVAL '60 days'),
  ('usr_worker_gurpreet_0003', 'work_history', 'passed', now() - INTERVAL '58 days'),
  ('usr_worker_irfan_0000005', 'identity',     'passed', now() - INTERVAL '15 days');

INSERT INTO app.offers (offer_id, listing_id, worker_id, owner_id, offered_pay_cents, offered_hours_pw, start_date, status) VALUES
  ('off_rajesh_spiceroute_01', 'lst_spiceroute_tandoor_01', 'usr_worker_rajesh_000001', 'usr_owner_vikram_0000007', 260000, 45, current_date + 7,  'accepted'),
  ('off_gurpreet_punjab_0001', 'lst_punjab_headchef_0007',  'usr_worker_gurpreet_0003', 'usr_owner_harjinder_0010', 440000, 50, current_date + 14, 'pending'),
  ('off_irfan_golconda_00001', 'lst_golconda_biryani_005',  'usr_worker_irfan_0000005', 'usr_owner_kiran_00000009', 290000, 45, current_date - 30, 'accepted');

INSERT INTO app.agreements
(agreement_id, offer_id, worker_id, owner_id, status, role_code_snapshot,
 agreed_pay_cents, agreed_hours_pw, pay_frequency, pay_day, start_date,
 accommodation_provided, accommodation_address, worker_signed_at, owner_signed_at)
VALUES
(
 'agr_rajesh_spiceroute_01',
 'off_rajesh_spiceroute_01',
 'usr_worker_rajesh_000001',
 'usr_owner_vikram_0000007',
 'active',
 'tandoor_chef',
 260000,
 45,
 'weekly',
 'friday',
 current_date - 14,
 false,
 NULL,
 now() - INTERVAL '13 days',
 now() - INTERVAL '13 days'
),
(
 'agr_irfan_golconda_00001',
 'off_irfan_golconda_00001',
 'usr_worker_irfan_0000005',
 'usr_owner_kiran_00000009',
 'active',
 'biryani_chef',
 290000,
 45,
 'weekly',
 'friday',
 current_date - 30,
 true,
 '39159 Fremont Blvd Fremont CA',
 now() - INTERVAL '29 days',
 now() - INTERVAL '29 days'
);
INSERT INTO app.pay_cycles (agreement_id, worker_id, owner_id, period_start, period_end, due_date, expected_amount_cents, status, owner_confirmed_at, owner_amount_paid_cents, worker_confirmed_at) VALUES
  ('agr_rajesh_spiceroute_01', 'usr_worker_rajesh_000001', 'usr_owner_vikram_0000007', current_date-14, current_date-8,  current_date-7,  260000, 'worker_confirmed', NULL,  260000, now()-INTERVAL '6 days'),
  ('agr_rajesh_spiceroute_01', 'usr_worker_rajesh_000001', 'usr_owner_vikram_0000007', current_date-7,  current_date-1,  current_date,    260000, 'owner_confirmed', NULL ,  260000, NULL), 
  ('agr_irfan_golconda_00001', 'usr_worker_irfan_0000005', 'usr_owner_kiran_00000009', current_date-30, current_date-24, current_date-23, 290000, 'worker_confirmed', NULL , 290000, now()-INTERVAL '22 days'),
  ('agr_irfan_golconda_00001', 'usr_worker_irfan_0000005', 'usr_owner_kiran_00000009', current_date-7,  current_date-1,  current_date,    290000, 'scheduled',        NULL,                     NULL,   NULL);

INSERT INTO app.ratings (agreement_id, rater_id, rated_id, period_month, rater_type, dim_pay_reliability, dim_communication, dim_overall, dim_reliability, dim_skill_level, dim_punctuality, window_closes_at) VALUES
  ('agr_rajesh_spiceroute_01', 'usr_worker_rajesh_000001', 'usr_owner_vikram_0000007', '2026-02', 'worker', 5, 4, 4, 5, NULL, NULL, now()+INTERVAL '7 days'),
  ('agr_rajesh_spiceroute_01', 'usr_owner_vikram_0000007', 'usr_worker_rajesh_000001', '2026-02', 'owner',  NULL, 4, 4, 5, 5, 4,   now()+INTERVAL '7 days'),
  ('agr_irfan_golconda_00001', 'usr_worker_irfan_0000005', 'usr_owner_kiran_00000009', '2026-01', 'worker', 4, 4, 4, 4, NULL, NULL, now()+INTERVAL '7 days'),
  ('agr_irfan_golconda_00001', 'usr_owner_kiran_00000009', 'usr_worker_irfan_0000005', '2026-01', 'owner',  NULL, 5, 4, 4, 5, 5,   now()+INTERVAL '7 days');

INSERT INTO app.chat_sessions (session_id, user_id, language_code, flow_context, current_step, profile_draft, message_count) VALUES
  ('ses_rajesh_onboard_00001', 'usr_worker_rajesh_000001', 'hi', 'onboarding_worker', 'complete',    '{"role":"tandoor_chef","experience":6}', 12),
  ('ses_lakshmi_onboard_0001', 'usr_worker_lakshmi_00006', 'ml', 'onboarding_worker', 'ask_cuisine', '{"role":"kitchen_helper"}',              3);

COMMIT;
