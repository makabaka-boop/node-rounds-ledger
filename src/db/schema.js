function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_code TEXT NOT NULL UNIQUE,
      device_name TEXT NOT NULL,
      area TEXT NOT NULL,
      device_type TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      maintenance_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checklist_name TEXT NOT NULL,
      device_type TEXT NOT NULL,
      items TEXT NOT NULL,
      cycle_days INTEGER NOT NULL,
      version INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (checklist_name, version)
    );

    CREATE TABLE IF NOT EXISTS checklist_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checklist_id INTEGER NOT NULL REFERENCES checklists(id),
      checklist_name TEXT NOT NULL,
      device_type TEXT NOT NULL,
      version INTEGER NOT NULL,
      cycle_days INTEGER NOT NULL,
      items_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL REFERENCES devices(id),
      checklist_id INTEGER NOT NULL REFERENCES checklists(id),
      checklist_snapshot_id INTEGER NOT NULL REFERENCES checklist_snapshots(id),
      planned_start_at TEXT NOT NULL,
      planned_end_at TEXT NOT NULL,
      round_status TEXT NOT NULL DEFAULT 'scheduled',
      owner_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER NOT NULL REFERENCES rounds(id),
      item_name TEXT NOT NULL,
      result_value TEXT NOT NULL,
      note TEXT,
      submitted_at TEXT NOT NULL,
      UNIQUE (round_id, item_name)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER NOT NULL REFERENCES rounds(id),
      result_id INTEGER NOT NULL UNIQUE REFERENCES results(id),
      review_status TEXT NOT NULL DEFAULT 'pending',
      reviewer_name TEXT,
      review_note TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      actor TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rounds_device ON rounds(device_id);
    CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(round_status);
    CREATE INDEX IF NOT EXISTS idx_results_round ON results(round_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_round ON reviews(round_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(review_status);
    CREATE INDEX IF NOT EXISTS idx_devices_area ON devices(area);
    CREATE INDEX IF NOT EXISTS idx_devices_risk ON devices(risk_level);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id);
  `);
}

module.exports = { migrate };
