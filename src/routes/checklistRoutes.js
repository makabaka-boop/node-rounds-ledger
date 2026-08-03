const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');

function createChecklistRouter(container) {
  const router = express.Router();
  const checklistService = container.services.checklistService;

  router.post('/', asyncHandler(async (req, res) => {
    const checklist = checklistService.create(req.body || {}, req.body && req.body.operator_name);
    res.status(201).json(checklist);
  }));

  router.get('/', asyncHandler(async (req, res) => {
    const checklists = checklistService.list(req.query || {});
    res.status(200).json({ items: checklists, total: checklists.length });
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const checklist = checklistService.getById(Number(req.params.id));
    res.status(200).json(checklist);
  }));

  router.post('/:id/copy-version', asyncHandler(async (req, res) => {
    const checklist = checklistService.copyVersion(
      Number(req.params.id),
      req.body || {},
      req.body && req.body.operator_name
    );
    res.status(201).json(checklist);
  }));

  router.post('/:id/disable', asyncHandler(async (req, res) => {
    const checklist = checklistService.disable(Number(req.params.id), req.body && req.body.operator_name);
    res.status(200).json(checklist);
  }));

  return router;
}

module.exports = createChecklistRouter;
