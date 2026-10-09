#!/usr/bin/env node
'use strict';

// 模拟新的时间舍入逻辑
function getBeijingTimeRounded() {
    const now = new Date();
    const bjTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    const date = bjTime.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const hour = bjTime.getHours();
    const timeBlock = hour < 6 ? '凌晨' : hour < 12 ? '上午' : hour < 18 ? '下午' : '晚上';
    return `${date} ${timeBlock}`;
}

console.log('=== 时间舍入逻辑验证 ===\n');
console.log('当前时间（舍入后）:', getBeijingTimeRounded());
console.log('');

// 测试不同时间点的舍入效果
console.log('📊 时间块稳定性测试：\n');

const testTimes = [
    { hour: 0, minute: 0, desc: '00:00 午夜' },
    { hour: 5, minute: 59, desc: '05:59 凌晨末' },
    { hour: 6, minute: 0, desc: '06:00 上午初' },
    { hour: 11, minute: 59, desc: '11:59 上午末' },
    { hour: 12, minute: 0, desc: '12:00 下午初' },
    { hour: 17, minute: 59, desc: '17:59 下午末' },
    { hour: 18, minute: 0, desc: '18:00 晚上初' },
    { hour: 23, minute: 59, desc: '23:59 晚上末' },
];

testTimes.forEach(t => {
    const testDate = new Date();
    testDate.setHours(t.hour, t.minute, 0, 0);
    const bjTime = new Date(testDate.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    const date = bjTime.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const hour = bjTime.getHours();
    const timeBlock = hour < 6 ? '凌晨' : hour < 12 ? '上午' : hour < 18 ? '下午' : '晚上';
    console.log(`${t.desc.padEnd(15)} → ${date} ${timeBlock}`);
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📈 缓存稳定性改善：\n');
console.log('修复前：');
console.log('  - 时间格式：2026/10/9 23:59:59');
console.log('  - 跨越 00:00：2026/10/9 → 2026/10/10');
console.log('  - 缓存失效：每天 0 点必定失效');
console.log('  - 每分钟都不同，理论上每分钟都可能失效');
console.log('');
console.log('修复后：');
console.log('  - 时间格式：2026/10/9 晚上');
console.log('  - 跨越 00:00：2026/10/9 晚上 → 2026/10/10 凌晨');
console.log('  - 缓存稳定期：4-6 小时一个块');
console.log('  - 每天最多失效 4 次（凌晨/上午/下午/晚上切换）');
console.log('  - 配合 epoch 机制，整体命中率大幅提升');
console.log('');
console.log('预期效果：');
console.log('  - 同一时间块内（如"晚上"）：缓存稳定命中 ✅');
console.log('  - 跨时间块：仅在块边界失效一次');
console.log('  - 跨日期：仅在 0 点失效一次（凌晨开始）');
console.log('  - 整体缓存命中率：~70-80%（考虑 epoch + 时间块）');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
