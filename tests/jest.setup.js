const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_PATH = path.join(os.tmpdir(), `rounds-ledger-test-${Date.now()}.db`);

process.env.NODE_ENV = 'test';

beforeAll(() => {
  const { resetDb } = require('../src/db/connection');
  resetDb(TEST_DB_PATH);
});

beforeEach(() => {
  const { getDb } = require('../src/db/connection');
  const db = getDb();
  db.exec(`
    DELETE FROM audit_events;
    DELETE FROM exception_reviews;
    DELETE FROM round_results;
    DELETE FROM rounds;
    DELETE FROM checklist_snapshots;
    DELETE FROM checklists;
    DELETE FROM devices;
  `);
});

afterAll(() => {
  const { closeDb } = require('../src/db/connection');
  closeDb();
  try {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    if (fs.existsSync(TEST_DB_PATH + '-wal')) fs.unlinkSync(TEST_DB_PATH + '-wal');
    if (fs.existsSync(TEST_DB_PATH + '-shm')) fs.unlinkSync(TEST_DB_PATH + '-shm');
  } catch (e) {
    // ignore
  }
});
