const { createApp } = require('./app');
const { getDb } = require('./db/connection');

const PORT = Number(process.env.PORT || 18102);

getDb(); // 启动时初始化数据库与表结构

createApp().listen(PORT, () => {
  console.log(`rounds-ledger API listening on port ${PORT}`);
});
