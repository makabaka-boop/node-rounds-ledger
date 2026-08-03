const { createApp } = require('./app');
const { getDb } = require('./db/connection');

const PORT = process.env.PORT || 18102;

const app = createApp();

getDb();

const server = app.listen(PORT, () => {
  console.log(`设备巡检轮次台账服务已启动，监听端口 ${PORT}`);
  console.log(`健康检查: http://localhost:${PORT}/health`);
  console.log(`API 基础路径: http://localhost:${PORT}/api/v1`);
});

process.on('SIGTERM', () => {
  console.log('收到 SIGTERM 信号，正在关闭服务...');
  server.close(() => {
    const { closeDb } = require('./db/connection');
    closeDb();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('收到 SIGINT 信号，正在关闭服务...');
  server.close(() => {
    const { closeDb } = require('./db/connection');
    closeDb();
    process.exit(0);
  });
});

module.exports = { app, server };
