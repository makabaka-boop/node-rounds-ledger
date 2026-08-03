const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');

function createRoundRouter(container) {
  const router = express.Router();
  const roundService = container.services.roundService;

  router.post('/generate', asyncHandler(async (req, res) => {
    const round = roundService.generate(req.body || {}, req.body && req.body.operator_name);
    res.status(201).json(round);
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const round = roundService.getDetail(Number(req.params.id));
    res.status(200).json(round);
  }));

  router.post('/:id/start', asyncHandler(async (req, res) => {
    const round = roundService.start(Number(req.params.id), req.body || {}, req.body && req.body.operator_name);
    res.status(200).json(round);
  }));

  router.post('/:id/submit-results', asyncHandler(async (req, res) => {
    const round = roundService.submitResults(Number(req.params.id), req.body || {}, req.body && req.body.operator_name);
    res.status(200).json(round);
  }));

  router.post('/:id/close', asyncHandler(async (req, res) => {
    const round = roundService.close(Number(req.params.id), req.body && req.body.operator_name);
    res.status(200).json(round);
  }));

  router.get('/device/:device_id/latest', asyncHandler(async (req, res) => {
    const round = roundService.getLatestForDevice(Number(req.params.device_id));
    if (!round) {
      return res.status(200).json(null);
    }
    res.status(200).json(round);
  }));

  router.get('/area/:area/unclosed', asyncHandler(async (req, res) => {
    const rounds = roundService.findUnclosedByArea(req.params.area);
    res.status(200).json({ items: rounds, total: rounds.length });
  }));

  return router;
}

module.exports = createRoundRouter;
