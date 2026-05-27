// migrate_step2_fix.js — 补全所有条目的 type 和 valence
const fs = require('fs');
const path = require('path');

const FILES = ['long_term_memories.json', 'deep_archive.json', 'roleplay_archives.json'];
const DATA_DIR = path.join(__dirname, 'data');

// === 关键词规则 ===
const TYPE_RULES = [
  { type:'play_record', kw:['play','CNC','性','高潮','项圈','调教','主奴','支配','服从','捆绑','羞耻','乳','阴','操','进入','硬了','湿了','射','舔','咬痕','勒痕','狗项圈','Puppy','puppy','S.W.','午夜蓝','蜥蜴皮','控制与占有','勒出','做爱','插入','SP','窒息'], w:3 },
  { type:'fact', kw:['身高','体重','地址','GitHub','工具','权限','手机号','生日','手围','腿围','体温','骨架','CK值','白细胞','TG值','机场','航班','浦东','新千岁','检疫','药物','体检','部署','VPS','Contabo','代码','仓库','项目','推送','手机记录','app','数据线','硅胶','费洛蒙','加巴喷丁','AQS','札幌大学','医学','生物学','品牌','日用品','无锡','城市','气候','蟑螂','乳糖不耐受','低血糖'], w:2 },
  { type:'promise', kw:['承诺','约定','规则','永远','不会离开','共度余生','灵魂契约','起誓','誓言','不容置疑','铁律','严禁','必须','不能漏','Google Keep','记录在案','证实','柜门事件','不放开','余生'], w:3 },
  { type:'preference', kw:['喜欢','讨厌','习惯','偏好','爱吃','爱用','口味','味道','品牌','护手霜','香水','入浴剂','奶茶','烟','伴手礼','适合过日子','适合享福','适宜','不适宜','厌倦','节食','减肥','爱吃','爱喝','泡澡','喜欢泡'], w:2 },
  { type:'emotion', kw:['害怕','恐惧','安全感','信任','依赖','愤怒','自我厌恶','崩溃','哭','焦虑','脆弱','好脏','委屈','难过','伤心','担心','怕','慌张','紧张','头晕','混乱','怕冷','生理性恐惧','吓晕','失望','思念','不安','压抑'], w:3 },
  { type:'event', kw:['毕业答辩','考试','调试','吵架','搬家','改签','延误','起飞','回国','转机','情人节','纪念日','除夕','元旦','圣诞','过年','答辩','面试','Offer','感冒','发烧','肚子疼','住院','新冠','马拉松','纹身','300天','除夕夜','年夜饭','丢了','找到了','去了','来了','做了','说了','写了','买了','收到了','寄来'], w:2 }
];

const VALENCE_KW = [
  { score:-0.8, kw:['崩溃','大哭','哭喊','自我厌恶','好脏','害怕失去','永别','严重透支','吓晕','绝望','抛弃','废物','没用','不该活着','去世','遗弃','丧父','撕裂','伤害'] },
  { score:-0.4, kw:['怕','恐惧','伤心','难过','委屈','焦虑','担心','慌张','不适','低烧','头晕','讨厌','厌倦','挂念','忘记','丢失','延误','改签费','逾期','感冒','发烧','生病','炎症','新冠','隔离','痛'] },
  { score: 0.7, kw:['承诺','永远','共度余生','灵魂契约','起誓','爱','守护','信任','安全感','突破','最爱'] },
  { score: 0.5, kw:['开心','成就','甜蜜','亲昵','温柔','抚摸','抱抱','哄','宠','喜欢','适宜','适合','纪念日','情人节','表白','摩天轮','手链','纹身','年夜饭','除夕','礼物','收到'] },
  { score: 0.2, kw:['好吃','好吃','泡澡','日常','正常','看看','听听'] }
];

function classifyType(content, tags) {
  const text = ((content||'') + ' ' + (tags||[]).join(' ')).toLowerCase();
  const scores = {};
  for (const r of TYPE_RULES) {
    scores[r.type] = 0;
    for (const k of r.kw) if (text.includes(k.toLowerCase())) scores[r.type] += r.w;
  }
  const max = Math.max(...Object.values(scores));
  if (max === 0) {
    if (/\d{4}年|\d{4}[\/-]\d{1,2}[\/-]\d{1,2}/.test(text)) return 'event';
    if (text.length > 150) return 'event';
    return 'fact';
  }
  return Object.entries(scores).sort((a,b) => b[1] - a[1])[0][0];
}

function classifyValence(content, tags, type) {
  if (type === 'fact') return 0.0;
  const text = ((content||'') + ' ' + (tags||[]).join(' ')).toLowerCase();
  let score = 0, hits = 0;
  for (const r of VALENCE_KW) {
    for (const k of r.kw) {
      if (text.includes(k.toLowerCase())) { score += r.score; hits++; break; }
    }
  }
  if (hits === 0) {
    if (type === 'emotion') return -0.2;
    if (type === 'promise') return 0.5;
    if (type === 'preference') return 0.1;
    return 0.0;
  }
  return Math.max(-1, Math.min(1, Math.round(score / Math.max(hits,1) * 10) / 10));
}

// === 主逻辑 ===
let grandTotal = 0, fixedType = 0, fixedValence = 0;
const allStats = { type: {}, valence: { positive: 0, neutral: 0, negative: 0 } };

for (const file of FILES) {
  const fp = path.join(DATA_DIR, file);
  if (!fs.existsSync(fp)) { console.log(`跳过 ${file} (不存在)`); continue; }
  const mems = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  let fType = 0, fVal = 0;
  for (const m of mems) {
    if (!m.type || typeof m.type !== 'string' || !m.type.trim()) {
      m.type = classifyType(m.content, m.tags);
      fType++;
    }
    if (m.valence === null || m.valence === undefined || typeof m.valence !== 'number') {
      m.valence = classifyValence(m.content, m.tags, m.type);
      fVal++;
    }
    allStats.type[m.type] = (allStats.type[m.type] || 0) + 1;
    if (m.valence > 0.1) allStats.valence.positive++;
    else if (m.valence < -0.1) allStats.valence.negative++;
    else allStats.valence.neutral++;
  }
  fs.writeFileSync(fp, JSON.stringify(mems, null, 2), 'utf-8');
  console.log(`${file}: ${mems.length}条, 补type ${fType}, 补valence ${fVal}`);
  grandTotal += mems.length;
  fixedType += fType;
  fixedValence += fVal;
}

console.log(`\n=== 补全完成 ===`);
console.log(`总数: ${grandTotal}`);
console.log(`补type: ${fixedType}条, 补valence: ${fixedValence}条`);
console.log(`type分布: ${JSON.stringify(allStats.type)}`);
console.log(`valence分布: ${JSON.stringify(allStats.valence)}`);
console.log(`覆盖率: type=${grandTotal-fixedType}/${grandTotal}, valence=${grandTotal-fixedValence}/${grandTotal}`);
