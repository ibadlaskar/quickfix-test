-- QuickFix Barak schema v1 (idempotent: safe to run more than once)
CREATE SEQUENCE IF NOT EXISTS technician_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS booking_code_seq START 1;

CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL, name text NOT NULL,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('owner','admin')),
  password_hash text NOT NULL, is_active boolean NOT NULL DEFAULT true,
  failed_attempts int NOT NULL DEFAULT 0, locked_until timestamptz, last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY, admin_id uuid REFERENCES admin_users(id),
  action text NOT NULL, entity_type text, entity_id text, reason text, details jsonb, ip text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_logs(entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS service_categories (
  id serial PRIMARY KEY, name text UNIQUE NOT NULL, description text,
  inspection_fee numeric(10,2) CHECK (inspection_fee >= 0),
  is_active boolean NOT NULL DEFAULT true, sort_order int NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS technicians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tech_code text UNIQUE NOT NULL,
  full_name text NOT NULL, mobile text UNIQUE NOT NULL, alt_mobile text, email text, photo_url text,
  address text NOT NULL, locality text NOT NULL, pin_code text NOT NULL CHECK (pin_code ~ '^[0-9]{6}$'),
  emergency_name text, emergency_mobile text,
  experience_years int CHECK (experience_years BETWEEN 0 AND 60), experience_notes text,
  qualifications text, tools text, own_transport boolean NOT NULL DEFAULT false,
  working_hours text, availability text CHECK (availability IN ('full_time','part_time','weekend')),
  service_localities text, max_distance_km int CHECK (max_distance_km >= 0), assessment_notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','inactive','suspended')),
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','under_review','verified','rejected')),
  created_by uuid REFERENCES admin_users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS tech_status_idx ON technicians(status, verification_status);
CREATE INDEX IF NOT EXISTS tech_name_idx ON technicians(lower(full_name));

CREATE TABLE IF NOT EXISTS technician_skills (
  technician_id uuid NOT NULL REFERENCES technicians(id) ON DELETE RESTRICT,
  category_id int NOT NULL REFERENCES service_categories(id),
  approved boolean NOT NULL DEFAULT true, approved_by uuid REFERENCES admin_users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (technician_id, category_id));

CREATE TABLE IF NOT EXISTS technician_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id uuid NOT NULL REFERENCES technicians(id) ON DELETE RESTRICT,
  doc_type text NOT NULL, storage_key text NOT NULL, uploaded_by uuid REFERENCES admin_users(id),
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS technician_verifications (
  technician_id uuid PRIMARY KEY REFERENCES technicians(id) ON DELETE RESTRICT,
  mobile_verified boolean NOT NULL DEFAULT false, identity_checked boolean NOT NULL DEFAULT false,
  address_checked boolean NOT NULL DEFAULT false, skills_assessed boolean NOT NULL DEFAULT false,
  qualifications_reviewed boolean NOT NULL DEFAULT false,
  verified_at timestamptz, verified_by uuid REFERENCES admin_users(id),
  notes text, rejection_reason text, updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS technician_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id uuid NOT NULL REFERENCES technicians(id) ON DELETE RESTRICT,
  version text NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now(),
  commission_basis text NOT NULL CHECK (commission_basis IN ('labour_only','labour_and_parts','fixed_per_job','custom')),
  commission_rate numeric(5,2) NOT NULL CHECK (commission_rate BETWEEN 0 AND 100),
  settlement_schedule text NOT NULL CHECK (settlement_schedule IN ('daily','weekly','fortnightly')),
  recorded_by uuid REFERENCES admin_users(id));

CREATE TABLE IF NOT EXISTS technician_notes (
  id bigserial PRIMARY KEY, technician_id uuid NOT NULL REFERENCES technicians(id) ON DELETE RESTRICT,
  admin_id uuid REFERENCES admin_users(id), note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, mobile text UNIQUE NOT NULL,
  email text, address text, locality text, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL CHECK (role IN ('customer','technician')), mobile text, firebase_uid text UNIQUE,
  customer_id uuid REFERENCES customers(id), technician_id uuid REFERENCES technicians(id),
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  password_hash text, failed_attempts int NOT NULL DEFAULT 0, locked_until timestamptz, last_login_at timestamptz, must_change_password boolean NOT NULL DEFAULT false);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code text UNIQUE NOT NULL DEFAULT ('QF-' || lpad(nextval('booking_code_seq')::text, 5, '0')),
  customer_id uuid NOT NULL REFERENCES customers(id), category_id int NOT NULL REFERENCES service_categories(id),
  address text NOT NULL, locality text, preferred_at timestamptz,
  inspection_fee numeric(10,2) NOT NULL DEFAULT 0, diagnosis text,
  work_status text NOT NULL DEFAULT 'requested' CHECK (work_status IN ('requested','confirmed','assigned','en_route','arrived','diagnosing','quote_pending','quote_accepted','quote_rejected','in_progress','completed','cancelled','disputed')),
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid','refunded')),
  settlement_status text NOT NULL DEFAULT 'not_due' CHECK (settlement_status IN ('not_due','due','settled')),
  complaint_status text NOT NULL DEFAULT 'none', cancel_reason text, completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS booking_status_idx ON bookings(work_status, created_at DESC);

CREATE TABLE IF NOT EXISTS booking_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id), technician_id uuid NOT NULL REFERENCES technicians(id),
  assigned_by uuid REFERENCES admin_users(id), reason text, is_current boolean NOT NULL DEFAULT true,
  assigned_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS one_current_assignment ON booking_assignments(booking_id) WHERE is_current;

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL REFERENCES bookings(id),
  version int NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','superseded')),
  approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (booking_id, version));
CREATE TABLE IF NOT EXISTS quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid NOT NULL REFERENCES quotes(id),
  kind text NOT NULL CHECK (kind IN ('labour','parts','travel','other')), description text NOT NULL,
  qty numeric(8,2) NOT NULL DEFAULT 1 CHECK (qty > 0), unit_price numeric(10,2) NOT NULL CHECK (unit_price >= 0));

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL REFERENCES bookings(id),
  technician_id uuid NOT NULL REFERENCES technicians(id), receipt_no text UNIQUE NOT NULL,
  labour_amount numeric(10,2) NOT NULL DEFAULT 0, parts_amount numeric(10,2) NOT NULL DEFAULT 0,
  discount numeric(10,2) NOT NULL DEFAULT 0, amount_collected numeric(10,2) NOT NULL CHECK (amount_collected >= 0),
  method text NOT NULL CHECK (method IN ('cash','upi','bank','other')), paid_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES admin_users(id));
CREATE TABLE IF NOT EXISTS payment_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid NOT NULL REFERENCES payments(id),
  kind text NOT NULL CHECK (kind IN ('refund','adjustment')), amount numeric(10,2) NOT NULL,
  reason text NOT NULL, created_by uuid REFERENCES admin_users(id), created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS technician_commission_ledger (
  id bigserial PRIMARY KEY, technician_id uuid NOT NULL REFERENCES technicians(id),
  payment_id uuid REFERENCES payments(id), booking_id uuid REFERENCES bookings(id),
  entry_type text NOT NULL CHECK (entry_type IN ('commission','adjustment','refund_reversal')),
  basis_amount numeric(10,2), rate numeric(5,2), commission_amount numeric(10,2) NOT NULL,
  technician_share numeric(10,2), parts_reimbursable numeric(10,2) NOT NULL DEFAULT 0, note text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ledger_tech_idx ON technician_commission_ledger(technician_id, created_at DESC);

CREATE TABLE IF NOT EXISTS technician_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), technician_id uuid NOT NULL REFERENCES technicians(id),
  period_from date, period_to date, due_date date NOT NULL,
  total_collected numeric(10,2) NOT NULL DEFAULT 0, commission_due numeric(10,2) NOT NULL DEFAULT 0,
  adjustments numeric(10,2) NOT NULL DEFAULT 0, amount_settled numeric(10,2) NOT NULL DEFAULT 0,
  method text, reference text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','verified','rejected')),
  verified_by uuid REFERENCES admin_users(id), verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS settlement_items (
  settlement_id uuid NOT NULL REFERENCES technician_settlements(id),
  ledger_id bigint NOT NULL REFERENCES technician_commission_ledger(id), amount numeric(10,2) NOT NULL,
  PRIMARY KEY (settlement_id, ledger_id));

CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid NOT NULL REFERENCES bookings(id),
  technician_id uuid NOT NULL REFERENCES technicians(id), rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid REFERENCES bookings(id),
  technician_id uuid REFERENCES technicians(id), description text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','dismissed')),
  resolution text, resolved_by uuid REFERENCES admin_users(id), created_at timestamptz NOT NULL DEFAULT now());

-- Completed money records and the audit log cannot be silently changed or deleted.
CREATE OR REPLACE FUNCTION qfb_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% records cannot be changed or deleted. Add an adjustment instead.', TG_TABLE_NAME; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS payments_immutable ON payments;
CREATE TRIGGER payments_immutable BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION qfb_immutable();
DROP TRIGGER IF EXISTS adjustments_immutable ON payment_adjustments;
CREATE TRIGGER adjustments_immutable BEFORE UPDATE OR DELETE ON payment_adjustments FOR EACH ROW EXECUTE FUNCTION qfb_immutable();
DROP TRIGGER IF EXISTS audit_immutable ON audit_logs;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION qfb_immutable();

-- ===== Stage 2 additions (idempotent) =====
CREATE TABLE IF NOT EXISTS app_meta (key text PRIMARY KEY, value text NOT NULL);
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS login_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT true;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS failed_attempts int NOT NULL DEFAULT 0;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS problem text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'whatsapp';
CREATE INDEX IF NOT EXISTS booking_assign_tech_idx ON booking_assignments(technician_id) WHERE is_current;

-- Service list v2 (runs once). Renames old names, adds new ones, retires the rest (nothing is deleted).
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'categories_v2') THEN
  UPDATE service_categories SET name = 'Electrical Works, Estimating & Costing' WHERE name = 'Electrical work' AND NOT EXISTS (SELECT 1 FROM service_categories WHERE name = 'Electrical Works, Estimating & Costing');
  UPDATE service_categories SET name = 'AC Servicing' WHERE name = 'AC repair and installation' AND NOT EXISTS (SELECT 1 FROM service_categories WHERE name = 'AC Servicing');
  UPDATE service_categories SET name = 'Water Tank Cleaning' WHERE name = 'Water tank cleaning' AND NOT EXISTS (SELECT 1 FROM service_categories WHERE name = 'Water Tank Cleaning');
  INSERT INTO service_categories (name, sort_order) VALUES
   ('Electrical Works, Estimating & Costing',1),('Plumbing',2),('Home Cleaning',3),('Water Tank Cleaning',4),('AC Servicing',5),('Metal Fabrication, Estimating & Costing',6)
  ON CONFLICT (name) DO NOTHING;
  UPDATE service_categories SET
   sort_order = CASE name WHEN 'Electrical Works, Estimating & Costing' THEN 1 WHEN 'Plumbing' THEN 2 WHEN 'Home Cleaning' THEN 3 WHEN 'Water Tank Cleaning' THEN 4 WHEN 'AC Servicing' THEN 5 WHEN 'Metal Fabrication, Estimating & Costing' THEN 6 ELSE 100 + sort_order END,
   is_active = name IN ('Electrical Works, Estimating & Costing','Plumbing','Home Cleaning','Water Tank Cleaning','AC Servicing','Metal Fabrication, Estimating & Costing');
  INSERT INTO app_meta (key, value) VALUES ('categories_v2', 'done');
 END IF;
END $$;

-- ===== Stage 3 additions (idempotent) =====
CREATE SEQUENCE IF NOT EXISTS receipt_seq START 1;
ALTER TABLE technician_agreements DROP CONSTRAINT IF EXISTS technician_agreements_commission_rate_check;
ALTER TABLE technician_agreements DROP CONSTRAINT IF EXISTS qfb_rate_range;
ALTER TABLE technician_agreements ALTER COLUMN commission_rate TYPE numeric(10,2);
ALTER TABLE technician_agreements ADD CONSTRAINT qfb_rate_range CHECK (commission_rate >= 0 AND commission_rate <= 100000);
ALTER TABLE technician_commission_ledger ALTER COLUMN rate TYPE numeric(10,2);
ALTER TABLE technician_settlements ADD COLUMN IF NOT EXISTS submitted_amount numeric(10,2);
ALTER TABLE technician_settlements ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE technician_settlements ADD COLUMN IF NOT EXISTS reject_reason text;
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS pos int NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS settlement_item_once ON settlement_items(ledger_id);
CREATE INDEX IF NOT EXISTS payments_paid_idx ON payments(paid_at);
CREATE INDEX IF NOT EXISTS payments_booking_idx ON payments(booking_id);
CREATE INDEX IF NOT EXISTS ledger_booking_idx ON technician_commission_ledger(booking_id);

-- Lock the tables away from Supabase's public Data API (anon/authenticated keys).
-- The server connects with the database owner role, which is unaffected.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
  END IF;
END $$;

-- ===== Customer web app additions (Stage 4; backward-compatible) =====
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS users_customer_idx ON users(customer_id) WHERE role='customer';
CREATE INDEX IF NOT EXISTS bookings_customer_created_idx ON bookings(customer_id, created_at DESC);
