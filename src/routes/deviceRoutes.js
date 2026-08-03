const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');

function createDeviceRouter(container) {
  const router = express.Router();
  const deviceService = container.services.deviceService;

  router.post('/', asyncHandler(async (req, res) => {
    const device = deviceService.create(req.body || {}, req.body && req.body.operator_name);
    res.status(201).json(device);
  }));

  router.get('/', asyncHandler(async (req, res) => {
    const devices = deviceService.list(req.query || {});
    res.status(200).json({ items: devices, total: devices.length });
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const device = deviceService.getById(Number(req.params.id));
    res.status(200).json(device);
  }));

  router.post('/:id/disable', asyncHandler(async (req, res) => {
    const device = deviceService.disable(Number(req.params.id), req.body && req.body.operator_name);
    res.status(200).json(device);
  }));

  return router;
}

module.exports = createDeviceRouter;
