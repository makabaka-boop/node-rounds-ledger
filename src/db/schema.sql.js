const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_code TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL,
  area TEXT NOT NULL,
  device_type TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  maintenance_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  items_json TEXT NOT NULL,
  cycle_days INTEGER NOT NULL,
  version INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  source_checklist_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (checklist_name, device_type, version)
);

CREATE TABLE IF NOT EXISTS checklist_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_id INTEGER NOT NULL,
  checklist_name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  items_json TEXT NOT NULL,
  cycle_days INTEGER NOT NULL,
  version INTEGER NOT NULL,
  snapshot_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (checklist_id) REFERENCES checklists(id)
);

CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL,
  checklist_id INTEGER NOT NULL,
  checklist_snapshot_id INTEGER NOT NULL,
  planned_start_at TEXT NOT NULL,
  planned_end_at TEXT NOT NULL,
  round_status TEXT NOT NULL DEFAULT 'scheduled',
  owner_name TEXT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  result_value TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS anomaly_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,
  result_id INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending',
  reviewer_name TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
  FOREIGN KEY (result_id) REFERENCES round_results(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  operator_name TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rounds_device_id ON rounds(device_id);
CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(round_status);
CREATE INDEX IF NOT EXISTS idx_rounds_device_status ON rounds(device_id, round_status);
CREATE INDEX IF NOT EXISTS idx_results_round_id ON round_results(round_id);
CREATE INDEX IF NOT EXISTS idx_reviews_round_id ON anomaly_reviews(round_id);
CREATE INDEX IF NOT EXISTS idx_reviews_result_id ON anomaly_reviews(result_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_events(created_at);
`;

module.exports = SCHEMA_SQL;
