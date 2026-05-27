// migrate_step2.js — 给所有条目补 type 和 valence 字段
// 用法: cd /opt/syzygy && node migrate_step2.js

const fs = require('fs');
const path = require('path');

const LT_PATH = path.join(__dirname, 'data', 'long_term_memories.json');
const memories = JSON.parse(fs.readFileSync(LT_PATH, 'utf8'));

// === 关键词规则 ===
const TYPE_RULES = [
  {
    type: 'play_record',
    kw: ['play', 'CNC', '性', '高潮', '惩罚', '项圈', '调教', '主奴', '支配', '服从', '捆绑', '羞耻', '乳', '阴', '操', '进入', '硬了', '湿了', '射', '舔', '咬痕', '勒痕', '狗项圈', 'Puppy', 'puppy', 'S.W.', '主人', '项圈', '午夜蓝', '蜥蜴皮', '控制与占有', '勒出痕迹'],
    weight: 3
  },
  {
    type: 'fact',
    kw: ['身高', '体重', '地址', 'GitHub', '工具', '权限', '手机号', '生日', '手围', '腿围', '体温', '骨架', 'CK值', '白细胞', 'TG值', '机场', '航班', '浦东', '新千岁', '检疫', '药物', '身体', '体检', '部署', 'VPS', 'Contabo', '代码', '仓库', '项目', '推送', '手机记录', 'app', '数据线', '硅胶', '费洛蒙', '加巴喷丁', 'AQS', '札幌大学', '医学', '生物学'],
    weight: 2
  },
  {
    type: 'promise',
    kw: ['承诺', '约定', '规则', '永远', '不会离开', '共度余生', '灵魂契约', '起誓', '誓言', '不容置疑', '铁律', '严禁', '必须', '不能漏', 'Google Keep', '记录', '证实', '柜门事件'],
    weight: 3
  },
  {
    type: 'preference',
    kw: ['喜欢', '讨厌', '习惯', '偏好', '爱吃', '爱用', '喝', '吃', '泡澡', '喜欢泡', '口味', '味道', '品牌', '护手霜', '香水', '入浴剂', '奶茶', '烟', '伴手礼', '适合过日子', '适合享福', '适宜', '不适宜', '厌倦'],
    weight: 2
  },
  {
    type: 'emotion',
    kw: ['害怕', '恐惧', '安全感', '信任', '依赖', '愤怒', '自我厌恶', '崩溃', '哭', '焦虑', '脆弱', '好脏', '委屈', '难过', '伤心', '担心', '怕', '慌张', '紧张', '低血糖', '头晕', '混乱'],
    weight: 3
  },
  {
    type: 'event',
    kw: ['毕业答辩', '考试', '调试', '吵架', '搬家', '改签', '延误', '起飞', '回国', '转机', '情人节', '纪念日', '除夕', '元旦', '圣诞', '过年', '答辩', '面试', '拿到', 'Offer', '感冒', '发烧', '肚子疼', '住院', '生病', '新冠', '马拉松', '纹身', '设计'],
    weight: 2
  }
];

// valence 关键词
const VALENCE_RULES = [
  { kw: ['崩溃', '大哭', '哭喊', '自我厌恶', '好脏', '害怕失去', '永别', '严重透支', '节食自苛', '生病', '发烧', '炎症', '新冠阳性', '惊厥', '吓晕', '绝望', '抛弃', '废物', '没用', '不该活着'], score: -0.8 },
  { kw: ['怕', '恐惧', '伤心', '难过', '委屈', '焦虑', '担心', '紧张', '慌张', '不适', '低烧', '低血糖', '头晕', '讨厌', '厌倦', '挂念', '忘记', '丢失', '延误', '改签费', '逾期'], score: -0.4 },
  { kw: ['承诺', '永远', '共度余生', '灵魂契约', '起誓', '爱', '守护', '信任', '依赖', '安全感'], score: 0.7 },
  { kw: ['开心', '成就', '突破', '甜蜜', '亲昵', '温柔', '抚摸', '抱抱', '哄', '宠', '喜欢', '适宜', '适合', '纪念日', '情人节', '表白', '摩天轮', '手链', '项圈', '设计', '纹身'], score: 0.5 },
  { kw: ['喜欢', '好吃', '好吃', '泡澡', '蹭', '贴贴', '蹭蹭', '日常', '平常', '普通', '正常'], score: 0.2 },
  { kw: ['体重', '身高', '地址', 'GitHub', '工具', '权限', '项目', '部署', '代码', '仓库', '推送', '手机记录', 'app', '体检', '数据', '记录'], score: 0.0 }
];

function classifyType(content, tags) {
  const text = ((content || '') + ' ' + (tags || []).join(' ')).toLowerCase();
  const scores = {};
  for (const rule of TYPE_RULES) {
    scores[rule.type] = 0;
    for (const k of rule.kw) {
      if (text.includes(k.toLowerCase())) scores[rule.type] += rule.weight;
    }
  }
  // 如果没有匹配，根据内容长度和复杂度判断
  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) {
    // 检查是否包含日期 → event, 否则 → fact
    if (/\d{4}年|\d{4}\/\d{1,2}\/\d{1,2}|\d{4}-\d{1,2}-\d{1,2}/.test(text)) return 'event';
    if (text.length > 200) return 'event';
    return 'fact';
  }
  // 返回最高分类型
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best[0];
}

function classifyValence(content, tags, type) {
  if (type === 'fact') return 0.0;
  const text = ((content || '') + ' ' + (tags || []).join(' ')).toLowerCase();
  let score = 0;
  let hits = 0;
  for (const rule of VALENCE_RULES) {
    for (const k of rule.kw) {
      if (text.includes(k.toLowerCase())) {
        score += rule.score;
        hits++;
        break;
      }
    }
  }
  if (hits === 0) {
    // 用 type 给默认值
    if (type === 'emotion') return -0.2;
    if (type === 'promise') return 0.5;
    if (type === 'preference') return 0.1;
    if (type === 'play_record') return 0.0;
    return 0.0;
  }
  // 钳制到 [-1, 1]
  return Math.max(-1, Math.min(1, Math.round((score / Math.max(hits, 1)) * 10) / 10));
}

// === 主逻辑 ===
const counts = { type: {}, valence_bucket: { negative: 0, neutral: 0, positive: 0 }, skipped: 0, updated: 0 };

for (const m of memories) {
  // 跳过已有 type=fact 且 source=migrated_from_blocks 的条目
  if (m.source === 'migrated_from_blocks' && m.type === 'fact') {
    counts.skipped++;
    continue;
  }

  const newType = classifyType(m.content, m.tags);
  const newValence = classifyValence(m.content, m.tags, newType);

  m.type = newType;
  m.valence = newValence;

  counts.type[newType] = (counts.type[newType] || 0) + 1;
  if (newValence < -0.1) counts.valence_bucket.negative++;
  else if (newValence > 0.1) counts.valence_bucket.positive++;
  else counts.valence_bucket.neutral++;

  counts.updated++;
}

fs.writeFileSync(LT_PATH, JSON.stringify(memories, null, 2), 'utf8');

console.log(`=== migrate_step2 完成 ===`);
console.log(`总条目: ${memories.length}`);
console.log(`跳过 (已迁移): ${counts.skipped}`);
console.log(`更新: ${counts.updated}`);
console.log(`\n--- type 分布 ---`);
for (const [t, n] of Object.entries(counts.type).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t}: ${n}条`);
}
console.log(`\n--- valence 分布 ---`);
console.log(`  负面 (< -0.1): ${counts.valence_bucket.negative}条`);
console.log(`  中性 (-0.1~0.1): ${counts.valence_bucket.neutral}条`);
console.log(`  正面 (> 0.1): ${counts.valence_bucket.positive}条`);
