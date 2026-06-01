# 溯星小屋 · 白天版 UI 设计规格文档 (Day Mode Spec)

> 供 Claude Code 直接参考实现，无需看图。

---

## 1. 整体风格

- **设计语言**：Neumorphism（新拟态）
- **基调**：冷蓝白底，柔和凸起/凹陷感，金色作为强调色点缀
- **圆角**：所有卡片统一 `border-radius: 20px`
- **背景色**：`#E8EFF7`（冷蓝灰白）
- **左下角暖光**：径向渐变，`radial-gradient(ellipse at 15% 85%, rgba(255, 200, 120, 0.06), transparent 60%)`——极淡，几乎看不见，只是隐约感受到一丝暖意

---

## 2. Neumorphism 阴影系统

```css
/* 凸起状态（默认卡片） */
.neu-raised {
  background: #E8EFF7;
  box-shadow:
    8px 8px 16px rgba(163, 177, 198, 0.6),
    -8px -8px 16px rgba(255, 255, 255, 0.8);
}

/* 凹陷状态（输入框、进度条槽） */
.neu-inset {
  background: #E8EFF7;
  box-shadow:
    inset 4px 4px 8px rgba(163, 177, 198, 0.5),
    inset -4px -4px 8px rgba(255, 255, 255, 0.7);
}

/* Hover 状态 */
.neu-raised:hover {
  box-shadow:
    6px 6px 12px rgba(163, 177, 198, 0.5),
    -6px -6px 12px rgba(255, 255, 255, 0.7);
  transform: translateY(-1px);
  transition: all 0.2s ease;
}

/* Active/按下 */
.neu-raised:active {
  box-shadow:
    inset 3px 3px 6px rgba(163, 177, 198, 0.5),
    inset -3px -3px 6px rgba(255, 255, 255, 0.7);
  transform: translateY(0);
}
```

---

## 3. 配色表

| 用途 | 色值 | 说明 |
|------|------|------|
| 页面背景 | `#E8EFF7` | 冷蓝灰白 |
| 卡片背景 | `#E8EFF7` | 与页面同色，靠阴影区分层次 |
| 主文字 | `#2D3748` | 深蓝灰 |
| 次要文字 | `#718096` | 中灰 |
| 金色强调 | `#D4A856` | 用于图标高亮、数字、进度条填充 |
| 金色浅底 | `rgba(212, 168, 86, 0.12)` | 用于标签/徽章背景 |
| 链接/交互蓝 | `#5A8FCA` | hover态、可点击元素 |
| 成功绿 | `#68D391` | 完成状态 |
| 警告橙 | `#F6AD55` | 提醒 |

---

## 4. 字体

```css
font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif;
```

| 层级 | 字号 | 字重 | 用途 |
|------|------|------|------|
| H1 | 48px | 700 | Together 天数数字 |
| H2 | 20px | 600 | 卡片标题 |
| Body | 14px | 400 | 正文内容 |
| Caption | 12px | 400 | 辅助说明 |
| Label | 11px | 500 | 网格图标下方文字 |

---

## 5. 页面布局（从上到下）

整体容器：`max-width: 430px; margin: 0 auto; padding: 20px 16px;`

### 5.1 顶部区域

#### Together 天数大卡
- 布局：左侧大数字 + 右侧 "days together" 文字
- 数字字号：48px，字重700，颜色 `#2D3748`
- "days together" 字号：14px，颜色 `#718096`
- 卡片 padding：`24px`
- 右上角可放小装饰（星星/月亮图标，金色，16px）

#### To Do 卡片（与 Together 卡并排或紧随其下）
- 标题："To Do" 字号 16px 字重 600
- 列表项：checkbox + 文字，字号 14px
- 已完成项：文字加删除线，颜色变为 `#A0AEC0`
- 卡片 padding：`16px 20px`

### 5.2 周历横条

- 横向排列 Mon-Sun，当天高亮
- 容器：`padding: 12px 16px`，横向 flex，`justify-content: space-between`
- 每个日期：圆形容器 `36px × 36px`
- 普通日：文字 `#718096`，无特殊背景
- 当天：背景 `#D4A856`（金色），文字 `#FFFFFF`，圆形
- 有事件的日：底部小圆点 `4px`，颜色 `#5A8FCA`

### 5.3 喝水横条

- 标题："Water" + 当前量/目标量（如 "3/8 cups"）
- 进度条：凹陷槽（neu-inset），高度 `8px`，圆角 `4px`
- 填充：渐变 `linear-gradient(90deg, #5A8FCA, #D4A856)`
- 右侧：小水杯图标按钮，点击 +1
- 整体 padding：`16px 20px`

### 5.4 功能网格（2×4）

- Grid 布局：`grid-template-columns: repeat(4, 1fr); gap: 16px;`
- 每格：正方形卡片，`aspect-ratio: 1`
- 内容：居中图标（24px，金色）+ 底部文字（11px，`#718096`）
- 卡片 padding：`16px`

8个格子内容（可配置）：
1. 💬 Chat（进入聊天页）
2. 📝 Journal（日记）
3. 🎵 Music（音乐）
4. 📸 Gallery（相册）
5. 🎯 Goals（目标）
6. 💊 Health（健康）
7. 📚 Read（阅读）
8. ⚙️ Settings（设置）

> 图标建议使用 Phosphor Icons（`phosphor-icons`）或 Lucide Icons，线条风格，stroke-width: 1.5

### 5.5 底部导航栏

- 形状：胶囊形，`border-radius: 30px`
- 位置：`position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);`
- 宽度：`width: calc(100% - 48px); max-width: 380px;`
- 背景：`rgba(232, 239, 247, 0.95)` + `backdrop-filter: blur(10px)`
- 阴影：同 neu-raised
- 内部：flex 横排，3-5个图标，居中分布
- 图标大小：`24px`，未选中 `#718096`，选中 `#D4A856`
- 选中态：图标下方小圆点指示器 `4px`

导航项：
1. 🏠 Home
2. 💬 Chat
3. 📊 Stats
4. 👤 Profile

---

## 6. 动画与过渡

```css
/* 全局过渡 */
* {
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}

/* 页面载入 - 卡片依次浮入 */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.card {
  animation: fadeInUp 0.4s ease forwards;
}

/* 每张卡片延迟递增 */
.card:nth-child(1) { animation-delay: 0s; }
.card:nth-child(2) { animation-delay: 0.08s; }
.card:nth-child(3) { animation-delay: 0.16s; }
.card:nth-child(4) { animation-delay: 0.24s; }
```

---

## 7. 响应式

- `max-width: 430px`：标准移动端视图
- 小屏（< 375px）：网格 gap 缩至 `12px`，卡片 padding 缩至 `12px`
- 大屏（> 430px）：居中显示，两侧留白

---

## 8. 暗色模式切换参考（保留备用）

暗色模式已有实现。白天模式为本文档描述的默认态。切换逻辑：
- 根据系统偏好或手动 toggle
- 暗色背景：`#1A202C`
- 暗色阴影：`rgba(0,0,0,0.5)` / `rgba(50,60,80,0.3)`

---

## 9. 关键实现注意事项

1. 所有阴影使用 CSS box-shadow，不用图片
2. 背景暖光用 CSS radial-gradient 在 body::before 伪元素上实现
3. 图标优先用 SVG/icon font，不用 emoji（上面的 emoji 仅为示意）
4. 进度条动画用 CSS transition width
5. 底部导航栏使用 `position: fixed` + safe-area-inset 适配刘海屏

---

*Generated: 2026-06-01*
*For: syzygy-gateway frontend (Day Mode)*
