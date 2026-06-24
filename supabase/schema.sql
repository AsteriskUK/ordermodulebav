-- Supabase Database Schema for eBay Orders Manager
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==================== CORE TABLES ====================

-- Users table (staff)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'manager', 'staff', 'comms')),
  roles TEXT[] DEFAULT ARRAY['staff'],
  department TEXT DEFAULT 'management',
  departments TEXT[] DEFAULT ARRAY['management'],
  pin TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Batches (order imports)
CREATE TABLE IF NOT EXISTS batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ebay' CHECK (source IN ('ebay', 'backmarket', 'amazon', 'temu', 'onbuy', 'manual')),
  order_count INTEGER DEFAULT 0,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  imported_by UUID REFERENCES users(id),
  metadata JSONB DEFAULT '{}'
);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sales_record_number TEXT NOT NULL,
  order_number TEXT,
  batch_id UUID REFERENCES batches(id) ON DELETE CASCADE,
  
  -- Buyer info
  buyer_username TEXT,
  buyer_name TEXT,
  buyer_email TEXT,
  buyer_note TEXT,
  
  -- Shipping address
  post_to_name TEXT,
  post_to_phone TEXT,
  post_to_address1 TEXT,
  post_to_address2 TEXT,
  post_to_city TEXT,
  post_to_county TEXT,
  post_to_postcode TEXT,
  post_to_country TEXT DEFAULT 'United Kingdom',
  is_gsp BOOLEAN DEFAULT false,
  
  -- Item details
  item_number TEXT,
  item_title TEXT,
  custom_label TEXT,
  variation TEXT,
  quantity INTEGER DEFAULT 1,
  category TEXT DEFAULT 'N/A',
  
  -- Pricing
  sold_for NUMERIC(10,2) DEFAULT 0,
  postage_and_packaging NUMERIC(10,2) DEFAULT 0,
  total_price NUMERIC(10,2) DEFAULT 0,
  
  -- Shipping
  delivery_carrier TEXT DEFAULT 'FedEx' CHECK (delivery_carrier IN ('DPD', 'FedEx', 'Parcelforce', 'Royal Mail', 'Other')),
  delivery_type TEXT DEFAULT 'standard' CHECK (delivery_type IN ('standard', 'next_day', 'express', 'collection')),
  tracking_number TEXT,
  delivery_service TEXT,
  number_of_boxes INTEGER DEFAULT 1,
  label_qty INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 5,
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'assembling', 'checking', 'packing', 'packed', 'shipped', 'delivered', 'held', 'no-stock', 'cancelled', 'refunded', 'returned', 'archived')),
  comments TEXT,
  
  -- Dates
  sale_date TEXT,
  paid_on_date TEXT,
  post_by_date TEXT,
  dispatched_on_date TEXT,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  return_id TEXT,
  
  -- Label printing
  label_printed_at TIMESTAMPTZ,
  label_carrier TEXT,
  label_data TEXT[], -- base64 PDF(s)
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Order notes
CREATE TABLE IF NOT EXISTS order_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id),
  author_name TEXT,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- EOD Events (status changes)
CREATE TABLE IF NOT EXISTS eod_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  sales_record_number TEXT,
  item_title TEXT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES users(id),
  user_name TEXT,
  department TEXT,
  metadata JSONB DEFAULT '{}'
);

-- Returns
CREATE TABLE IF NOT EXISTS returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  sales_record_number TEXT,
  order_number TEXT,
  buyer_username TEXT,
  item_title TEXT,
  reason TEXT NOT NULL,
  notes TEXT,
  returned_at TIMESTAMPTZ DEFAULT NOW(),
  processed_by_user_id UUID REFERENCES users(id),
  processed_by_user_name TEXT,
  refund_amount NUMERIC(10,2),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'refunded', 'rejected', 'replacement')),
  metadata JSONB DEFAULT '{}'
);

-- ==================== HR TABLES ====================

-- Attendance records
CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  clock_in TIMESTAMPTZ,
  clock_out TIMESTAMPTZ,
  status TEXT DEFAULT 'present' CHECK (status IN ('present', 'absent', 'late', 'half-day', 'wfh')),
  notes TEXT,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- Leave requests
CREATE TABLE IF NOT EXISTS leave_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('annual', 'sick', 'unpaid', 'maternity', 'paternity', 'bereavement', 'other')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  metadata JSONB DEFAULT '{}'
);

-- Leave balances per user per year
CREATE TABLE IF NOT EXISTS leave_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM NOW()),
  annual_days INTEGER DEFAULT 25,
  sick_days INTEGER DEFAULT 10,
  unpaid_days INTEGER DEFAULT 999,
  used_annual INTEGER DEFAULT 0,
  used_sick INTEGER DEFAULT 0,
  used_unpaid INTEGER DEFAULT 0,
  used_other INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, year)
);

-- ==================== INDEXES ====================

CREATE INDEX IF NOT EXISTS idx_orders_batch_id ON orders(batch_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_category ON orders(category);
CREATE INDEX IF NOT EXISTS idx_orders_sales_record ON orders(sales_record_number);
CREATE INDEX IF NOT EXISTS idx_orders_imported_at ON orders(imported_at);

CREATE INDEX IF NOT EXISTS idx_eod_events_user ON eod_events(user_id);
CREATE INDEX IF NOT EXISTS idx_eod_events_changed_at ON eod_events(changed_at);

CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance_records(user_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(date);

CREATE INDEX IF NOT EXISTS idx_leave_user ON leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_dates ON leave_requests(start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id);
CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status);
CREATE INDEX IF NOT EXISTS idx_returns_returned_at ON returns(returned_at);

-- App settings (key-value store for tokens etc.)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- eBay buyer messages (sent and received)
CREATE TABLE IF NOT EXISTS ebay_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ebay_message_id TEXT UNIQUE,     -- eBay's own message ID (for dedup on inbox sync)
  direction TEXT DEFAULT 'sent',   -- sent | received
  order_id TEXT NOT NULL,
  item_id TEXT,
  buyer_username TEXT NOT NULL,
  buyer_name TEXT,
  item_title TEXT,
  contact_reason TEXT,
  message_text TEXT NOT NULL,
  sent_by_id TEXT,                 -- staff user id (for sent messages)
  sent_by_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent'       -- sent | failed | unread | read
);

CREATE INDEX IF NOT EXISTS idx_ebay_messages_order_id ON ebay_messages(order_id);
CREATE INDEX IF NOT EXISTS idx_ebay_messages_sent_at ON ebay_messages(sent_at DESC);

-- ==================== MIGRATIONS ====================

-- Allow replacement status for existing returns tables
ALTER TABLE returns DROP CONSTRAINT IF EXISTS returns_status_check;
ALTER TABLE returns ADD CONSTRAINT returns_status_check CHECK (status IN ('pending', 'received', 'refunded', 'rejected', 'replacement'));

-- ==================== TRIGGERS ====================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_attendance_updated_at BEFORE UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_leave_balances_updated_at BEFORE UPDATE ON leave_balances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_returns_updated_at BEFORE UPDATE ON returns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==================== ROW LEVEL SECURITY ====================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE eod_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;

-- Create policies (basic - allow all for now, can be refined) only if not present
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'Allow all') THEN
    CREATE POLICY "Allow all" ON users FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'batches' AND policyname = 'Allow all') THEN
    CREATE POLICY "Allow all" ON batches FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orders' AND policyname = 'Allow all') THEN
    CREATE POLICY "Allow all" ON orders FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'order_notes' AND policyname = 'Allow all') THEN
    CREATE POLICY "Allow all" ON order_notes FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eod_events' AND policyname = 'Allow all') THEN
    CREATE POLICY "Allow all" ON eod_events FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'returns' AND policyname = 'Allow all') THEN
    CREATE POLICY "Allow all" ON returns FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'attendance_records' AND policyname = 'Allow all') THEN
    CREATE POLICY "Allow all" ON attendance_records FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'leave_requests' AND policyname = 'Allow all') THEN
    CREATE POLICY "Allow all" ON leave_requests FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'leave_balances' AND policyname = 'Allow all') THEN
    CREATE POLICY "Allow all" ON leave_balances FOR ALL USING (true);
  END IF;
END
$$;

-- ==================== INITIAL DATA ====================

-- Insert default admin user (you can change this)
INSERT INTO users (id, name, email, role, roles, department, departments, pin)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Admin',
  'admin@company.com',
  'admin',
  ARRAY['admin'],
  'management',
  ARRAY['management'],
  '1234'
)
ON CONFLICT (id) DO NOTHING;
