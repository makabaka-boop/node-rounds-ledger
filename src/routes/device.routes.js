const express = require('express');
const { deviceService } = require('../services');

const router = express.Router();

router.post('/', (req, res, next) => {
  try {
    const operator = req.headers['x-operator'] || '';
    const device = deviceService.create(req.body, operator);
    res.status(201).json(device);
  } catch (err) {
    next(err);
  }
});

router.get('/', (req, res, next) => {
  try {
    const filters = {};
    if (req.query.enabled !== undefined) {
      filters.enabled = req.query.enabled === 'true';
    }
    if (req.query.area) filters.area = req.query.area;
    if (req.query.device_type) filters.device_type = req.query.device_type;
    if (req.query.risk_level) filters.risk_level = req.query.risk_level;

    const devices = deviceService.list(filters);
    res.json(devices);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const device = deviceService.getById(req.params.id);
    res.json(device);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', (req, res, next) => {
  try {
    const operator = req.headers['x-operator'] || '';
    const device = deviceService.update(req.params.id, req.body, operator);
    res.json(device);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/deactivate', (req, res, next) => {
  try {
    const operator = req.headers['x-operator'] || '';
    const device = deviceService.deactivate(req.params.id, operator);
    res.json(device);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
