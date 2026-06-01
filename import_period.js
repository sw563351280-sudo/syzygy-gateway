// 导入生理期历史数据到 data/period_data.json
// 用法: node import_period.js
// 安全: 覆盖写入（一次性脚本，跑完即删）

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const PERIOD_FILE = path.join(DATA_DIR, 'period_data.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const raw = {
  "records": [
    { "start_date": "2026-01-10", "end_date": "2026-01-14", "cycle_days": 28 },
    { "start_date": "2026-02-07", "end_date": "2026-02-11", "cycle_days": 27 },
    { "start_date": "2026-03-06", "end_date": "2026-03-10", "cycle_days": 29 },
    { "start_date": "2026-04-04", "end_date": "2026-04-08", "cycle_days": 31 },
    { "start_date": "2026-05-05", "end_date": "2026-05-09", "cycle_days": 28 }
  ],
  "current": { "start_date": "2026-06-02", "end_date": null }
};

// 转换字段名
const records = raw.records.map(r => {
    const start = new Date(r.start_date + 'T00:00:00+08:00');
    const end = new Date(r.end_date + 'T00:00:00+08:00');
    const duration = Math.round((end - start) / 86400000) + 1;
    return {
        start: r.start_date,
        end: r.end_date,
        duration,
        cycle: r.cycle_days
    };
});

const data = {
    records,
    current: raw.current.start_date ? {
        start: raw.current.start_date,
        end: raw.current.end_date || null
    } : null
};

fs.writeFileSync(PERIOD_FILE, JSON.stringify(data, null, 2), 'utf8');
console.log('✅ 已导入 ' + records.length + ' 条历史记录');
if (data.current) console.log('🩸 当前经期: ' + data.current.start + ' → 进行中');

// 显示生成的数据
console.log('\n写入内容:');
console.log(JSON.stringify(data, null, 2));
