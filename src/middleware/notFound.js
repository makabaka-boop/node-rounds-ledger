function notFoundHandler(req, res) {
  res.status(404).json({
    error_code: 'not_found',
    message: `接口不存在: ${req.method} ${req.path}`,
    details: {},
  });
}

module.exports = { notFoundHandler };
