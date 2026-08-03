const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  device_code TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL,
  area TEXT NOT NULL,
  device_type TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  maintenance_note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checklists (
  id TEXT PRIMARY KEY,
  checklist_name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]',
  cycle_days INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checklist_snapshots (
  id TEXT PRIMARY KEY,
  checklist_id TEXT NOT NULL,
  checklist_name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]',
  cycle_days INTEGER NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (checklist_id) REFERENCES checklists(id)
);

CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  checklist_id TEXT NOT NULL,
  checklist_snapshot_id TEXT NOT NULL,
  planned_start_at TEXT NOT NULL,
  planned_end_at TEXT,
  round_status TEXT NOT NULL DEFAULT 'scheduled',
  owner_name TEXT NOT NULL,
  started_at TEXT,
  submitted_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (device_id) REFERENCES devices(id),
  FOREIGN KEY (checklist_id) REFERENCES checklists(id),
  FOREIGN KEY (checklist_snapshot_id) REFERENCES checklist_snapshots(id)
);

CREATE TABLE IF NOT EXISTS round_results (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  result_value TEXT NOT NULL,
  note TEXT DEFAULT '',
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS exception_reviews (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  result_id TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending',
  reviewer_name TEXT DEFAULT '',
  review_note TEXT DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
  FOREIGN KEY (result_id) REFERENCES round_results(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  operator_name TEXT DEFAULT '',
  event_data TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rounds_device_id ON rounds(device_id);
CREATE INDEX IF NOT EXISTS idx_rounds_round_status ON rounds(round_status);
CREATE INDEX IF NOT EXISTS idx_rounds_planned_start ON rounds(planned_start_at);
CREATE INDEX IF NOT EXISTS idx_round_results_round_id ON round_results(round_id);
CREATE INDEX IF NOT EXISTS idx_round_results_result_value ON round_results(result_value);
CREATE INDEX IF NOT EXISTS idx_exception_reviews_round_id ON exception_reviews(round_id);
CREATE INDEX IF NOT EXISTS idx_exception_reviews_result_id ON exception_reviews(result_id);
CREATE INDEX IF NOT EXISTS idx_exception_reviews_review_status ON exception_reviews(review_status);
CREATE INDEX IF NOT EXISTS idx_devices_area ON devices(area);
CREATE INDEX IF NOT EXISTS idx_devices_risk_level ON devices(risk_level);
CREATE INDEX IF NOT EXISTS idx_devices_device_type ON devices(device_type);
CREATE INDEX IF NOT EXISTS idx_checklists_device_type ON checklists(device_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);
`;

module.exports = { SCHEMA_SQL };
