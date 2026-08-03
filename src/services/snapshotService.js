class SnapshotService {
  constructor(snapshotRepository) {
    this.snapshotRepository = snapshotRepository;
  }

  createFromChecklist(checklist) {
    return this.snapshotRepository.create({
      checklist_id: checklist.id,
      checklist_name: checklist.checklist_name,
      device_type: checklist.device_type,
      items_json: checklist.items_json,
      cycle_days: checklist.cycle_days,
      version: checklist.version
    });
  }

  parseItems(snapshot) {
    if (!snapshot) return [];
    try {
      const parsed = JSON.parse(snapshot.items_json);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }
}

module.exports = SnapshotService;
