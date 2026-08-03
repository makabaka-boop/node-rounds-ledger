const express = require('express');
const { checklistService } = require('../services');

const router = express.Router();

router.post('/', (req, res, next) => {
  try {
    const operator = req.headers['x-operator'] || '';
    const checklist = checklistService.create(req.body, operator);
    res.status(201).json(checklist);
  } catch (err) {
    next(err);
  }
});

router.get('/', (req, res, next) => {
  try {
    const filters = {};
    if (req.query.device_type) filters.device_type = req.query.device_type;
    if (req.query.enabled !== undefined) {
      filters.enabled = req.query.enabled === 'true';
    }
    const checklists = checklistService.list(filters);
    res.json(checklists);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const checklist = checklistService.getById(req.params.id);
    res.json(checklist);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', (req, res, next) => {
  try {
    const operator = req.headers['x-operator'] || '';
    const checklist = checklistService.update(req.params.id, req.body, operator);
    res.json(checklist);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/copy-version', (req, res, next) => {
  try {
    const operator = req.headers['x-operator'] || '';
    const newChecklist = checklistService.copyVersion(
      req.params.id,
      req.body.items,
      operator
    );
    res.status(201).json(newChecklist);
  } catch (err) {
    next(err);
  }
});

router.get('/snapshots/:snapshotId', (req, res, next) => {
  try {
    const snapshot = checklistService.getSnapshotById(req.params.snapshotId);
    res.json(snapshot);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
