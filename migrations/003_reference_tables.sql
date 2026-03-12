-- =============================================================================
-- Migration: 003_reference_tables.sql
-- Description: Reference / lookup tables — role codes, cuisine codes
-- Author: RasoiLink Engineering
-- Created: 2026-03-10
-- Dependencies: 001, 002
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- ref.role_codes
-- Standardized job role identifiers with multilingual display labels.
-- Referenced by worker_profiles.role_code and listings.role_code.
-- ---------------------------------------------------------------------------

CREATE TABLE ref.role_codes (
  code         VARCHAR(40)  NOT NULL PRIMARY KEY,
  display_en   VARCHAR(80)  NOT NULL,
  display_hi   VARCHAR(80),   -- Hindi
  display_te   VARCHAR(80),   -- Telugu
  display_pa   VARCHAR(80),   -- Punjabi
  display_gu   VARCHAR(80),   -- Gujarati
  display_ta   VARCHAR(80),   -- Tamil
  category     VARCHAR(20)  NOT NULL CHECK (category IN ('kitchen','front_of_house','management','support')),
  sort_order   SMALLINT     NOT NULL DEFAULT 99,
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE ref.role_codes IS
  'Standardized job role codes with multilingual labels. '
  'Referenced by worker_profiles and listings. Do not delete active codes.';

CREATE INDEX idx_rc_category ON ref.role_codes(category) WHERE is_active = true;
CREATE INDEX idx_rc_sort     ON ref.role_codes(sort_order);


-- ---------------------------------------------------------------------------
-- ref.cuisine_codes
-- Standardized cuisine type identifiers used in profiles and listings.
-- ---------------------------------------------------------------------------

CREATE TABLE ref.cuisine_codes (
  code         VARCHAR(40)  NOT NULL PRIMARY KEY,
  display_en   VARCHAR(80)  NOT NULL,
  display_hi   VARCHAR(80),
  region       VARCHAR(40),   -- e.g. 'North Indian', 'South Indian', 'Pan-Indian'
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE ref.cuisine_codes IS
  'Standardized cuisine type codes. Used in worker specializations and listing requirements.';


-- ---------------------------------------------------------------------------
-- SEED: role codes
-- ---------------------------------------------------------------------------

INSERT INTO ref.role_codes (code, display_en, display_hi, category, sort_order) VALUES
  ('head_chef',         'Head Chef / Executive Chef',   'हेड शेफ / एग्जीक्यूटिव शेफ',  'kitchen',        1),
  ('sous_chef',         'Sous Chef',                    'सू शेफ',                         'kitchen',        2),
  ('tandoor_chef',      'Tandoor Chef',                 'तंदूर शेफ',                      'kitchen',        3),
  ('curry_chef',        'Curry Chef',                   'करी शेफ',                        'kitchen',        4),
  ('biryani_chef',      'Biryani Specialist',           'बिरयानी शेफ',                    'kitchen',        5),
  ('pastry_mithai',     'Pastry / Mithai Chef',         'मिठाई शेफ',                      'kitchen',        6),
  ('line_cook',         'Line Cook',                    'लाइन कुक',                        'kitchen',        7),
  ('prep_cook',         'Prep Cook',                    'प्रेप कुक',                       'kitchen',        8),
  ('kitchen_helper',    'Kitchen Helper',               'रसोई सहायक',                     'kitchen',        9),
  ('dishwasher',        'Dishwasher',                   'बर्तन साफ करने वाला',            'support',       10),
  ('server',            'Server / Waiter',              'वेटर',                           'front_of_house', 11),
  ('host',              'Host / Hostess',               'होस्ट',                          'front_of_house', 12),
  ('cashier',           'Cashier / Front Desk',         'कैशियर',                         'front_of_house', 13),
  ('delivery_driver',   'Delivery Driver',              'डिलीवरी ड्राइवर',                'support',       14),
  ('manager',           'Restaurant Manager',           'रेस्तरां मैनेजर',                'management',    15),
  ('assistant_manager', 'Assistant Manager',            'असिस्टेंट मैनेजर',              'management',    16),
  ('owner_operator',    'Owner / Operator',             'मालिक / ऑपरेटर',                'management',    17);


-- ---------------------------------------------------------------------------
-- SEED: cuisine codes
-- ---------------------------------------------------------------------------

INSERT INTO ref.cuisine_codes (code, display_en, display_hi, region) VALUES
  ('north_indian',    'North Indian',              'उत्तर भारतीय',    'North Indian'),
  ('south_indian',    'South Indian',              'दक्षिण भारतीय',   'South Indian'),
  ('tandoor',         'Tandoor Specialization',    'तंदूर विशेषज्ञता', 'North Indian'),
  ('biryani',         'Biryani',                   'बिरयानी',          'Pan-Indian'),
  ('mughlai',         'Mughlai',                   'मुगलई',            'North Indian'),
  ('punjabi',         'Punjabi',                   'पंजाबी',           'North Indian'),
  ('gujarati',        'Gujarati',                  'गुजराती',          'West Indian'),
  ('rajasthani',      'Rajasthani',                'राजस्थानी',        'North Indian'),
  ('bengali',         'Bengali',                   'बंगाली',           'East Indian'),
  ('hyderabadi',      'Hyderabadi',                'हैदराबादी',        'South Indian'),
  ('chettinad',       'Chettinad',                 'चेट्टिनाड',       'South Indian'),
  ('kerala',          'Kerala / Malabar',          'केरल',             'South Indian'),
  ('street_food',     'Street Food / Chaat',       'स्ट्रीट फूड',     'Pan-Indian'),
  ('mithai',          'Mithai / Indian Sweets',    'मिठाई',            'Pan-Indian'),
  ('indo_chinese',    'Indo-Chinese',              'इंडो-चाइनीज',     'Fusion'),
  ('fusion_modern',   'Modern Indian / Fusion',    'फ्यूजन',           'Fusion'),
  ('jain',            'Jain Cuisine',              'जैन भोजन',         'Specialty'),
  ('halal',           'Halal Certified',           'हलाल',             'Specialty'),
  ('vegan_indian',    'Vegan Indian',              'वीगन भारतीय',     'Specialty');


-- ---------------------------------------------------------------------------
-- RECORD THIS MIGRATION
-- ---------------------------------------------------------------------------

INSERT INTO public.schema_migrations (version) VALUES ('003') ON CONFLICT DO NOTHING;

COMMIT;
