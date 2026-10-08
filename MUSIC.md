# 一起听歌

音乐功能直接接入现有 Node/Express 网关和主页面，不需要另建 Python 服务。入口是页面右下角的「♫ 一起听」。

## 两种模式

- **小屋播放器**：搜索、歌词、音质回退、进度和音量、顺序/单曲/随机、持久队列、临时插播后返回原队列、歌单导入及刷新、收藏到自己的网易云歌单。
- **网易云一起听**：陪伴账号接受指定 UID 最近 5 分钟内的邀请、心跳保活、同步歌曲及暂停、断线重试、显式结束房间。音频在网易云 App 播放，小屋不重复发声。
- **共同能力**：统一会话与事件记录、共听小结、聊天当前音乐上下文、AI 播放卡、今日私选、反馈与缓存。

房间模式的 AI 点歌提供候选建议，不控制网易云 App 切歌；也不发送原生房间聊天气泡。AI 获得的是歌曲和状态元数据，不是音频感知。自动发起聊天不是本次实现的一部分；下一轮聊天及现有共享上下文链路会读取最新状态。

## 启动

使用 Node 20/22/24 LTS。根项目现有的 Puppeteer 21 在 Node 26 下存在第三方模块兼容问题，浏览器回归使用 Node 24。

1. 安装并运行独立音乐 API：

   ```powershell
   cd tools/music-api
   npm ci --ignore-scripts --no-audit --no-fund
   npm start
   ```

   已锁定 `@neteasecloudmusicapienhanced/api@4.40.1`。服务仅监听 `127.0.0.1:3001`，`NCM_SERVICE_PORT` 可改端口。启动器为网络初始化设 10 秒超时，关闭启动时的 npm 版本查询。匿名初始化数据位于 `data/music-api/`；不进入 Git。

2. 在另一个终端启动网关，沿用已有的 `SITE_PASSWORD` 和 `SESSION_SECRET`：

   ```powershell
   $env:NCM_API_BASE = 'http://127.0.0.1:3001'
   npm start
   ```

3. 登录小屋，打开音乐面板 →「账号」。分别扫码登录自己的网易云账号和一个独立的陪伴账号。两个身份互不替代；账号 Cookie 只在服务端以 AES-GCM 加密保存。
4. 小屋播放器可直接搜歌或导入歌单。在网易云模式填写**你的 UID**，点击「开始等待邀请」，再用自己的网易云 App 邀请陪伴账号。退出按钮会调用结束房间接口，结束双方这场房间会话。

可选 `NCM_COOKIE` 和 `NCM_COMPANION_COOKIE` 仅用于没有已保存凭证时的首次初始化。后续退出登录不会从环境变量自动复活凭证；推荐始终使用扫码界面。

Linux/systemd 模板在 `tools/music-api/`。手动安装时，将模板中的 `User=syzygy`、Node 路径与工作目录改成实际部署值，并让服务用户能写 `data/music-api/`。网关的 systemd drop-in 示例是 `gateway-music.conf.example`。

现有 `main` 自动部署流程会调用 `tools/music-api/deploy.sh`：安装锁定依赖、用 systemd 动态非特权用户运行音乐 API、将其状态保存在 `/var/lib/syzygy-music-api/`，检查本机端口就绪后重启网关。无需把音乐账号凭证写进 GitHub Secrets；发布后在页面扫码即可。

## 今日私选与 AI

私选从最近共听、导入歌单及反馈提取有限查询，先排除已知歌曲并验证完整音源，再排序。默认每天缓存一张；「换一批」才刷新；没有新候选时返回最近非空卡片并说明。最终每位歌手最多两首，同名同歌手变体折叠。无模型配置时使用确定性的品味排序。

可选环境变量开启模型排序：

```text
MUSIC_LLM_URL=https://your-provider/v1/chat/completions
MUSIC_LLM_MODEL=your-model
MUSIC_LLM_KEY=server-side-secret
```

模型仅收到紧凑候选和歌手偏好；只接受候选中的 ID，超时/无效输出回退。不会发送 Cookie、音频 URL、完整音乐库或聊天记录。

聊天注册了 `music_search_and_play` 和 `music_current_session`，启用后始终提供给现有网关工具循环，包括无音乐关键词和「好」「你选」等短回复。模型可以按语境主动送歌，不强制每轮调用；用户拒绝听歌时应尊重拒绝。工具开关关闭后仍不会提供。成功、歧义、失败分别返回 `ready / needs_choice / error`。播放卡仅说明准备好，点击并收到浏览器实际播放事件后才记为共听，不能只凭文字声称已播放。流式和标准非流式聊天均携带可渲染的音乐工具结果；面板也保留最近的点歌候选。独立 Codex Bridge 任务不使用这套网关工具循环，因此不会自动获得这两个工具。

## 状态与数据

所有时间戳统一为 Unix 毫秒；歌曲时长为毫秒，播放器快照的 `currentTime` 为秒。

- `data/music/library.json`：会话、队列快照、最多 500 条事件、1000 条反馈、30 天卡片、8 个小结。
- `data/music/credentials.enc`：两个账号的加密登录态，密钥派生自 `SESSION_SECRET`。更换密钥前应退出账号；不匹配时不会覆盖原文件。
- `data/music/library.lock`：写事务期间的排他锁。异常断电遗留锁时，先停止网关、确认没有写进程，再移除这个锁文件；不要删除音乐库。

整个读改写过程同步并持有文件锁，临时文件原子替换。损坏库不会被空库覆盖。远端短歌单与本地按 ID 合并，只由明确的移除操作删除本地歌单。

**网关部署仍要求一个 Node 进程**：文件锁保护写入，但房间轮询器、二维码挑战和 CSRF token 位于进程内；多 worker/多实例需要共享协调服务后才能启用。

本地页面通过服务器 owner/epoch、BroadcastChannel 和 storage 接管协调播放。主页面内部切换保留同一个 audio；独立标签页接管时旧页静音。远端模式变化通过 5 秒轮询同步。页面关闭会发送终止事件；崩溃或失联后，45 秒活跃租约过期。刷新恢复歌曲与队列，但不自动发声。

小屋播放器使用原生 audio 输出，不经过 Web Audio，以避免 iPhone 后台挂起 AudioContext 后进度继续但无声。音频元素独立于可收起面板，锁屏播放/暂停使用 Media Session 控制。iPhone 音量请使用设备音量键。暂停会取消尚未完成的播放操作；状态轮询暂时失败不会打断音频，确认其他页面或网易云房间接管后才停止本页播放。

音频与封面使用固定歌曲 ID 的代理路由：逐跳域名和 IP 校验、连接固定已验证地址、转发 Range/206/Content-Range、关闭上游连接。浏览器不接触临时音源 URL。代理允许网易云音乐 CDN，不是通用 URL 抓取接口。

## 验证

```text
npm test
node scripts/music-browser-smoke.js
node scripts/music-live-probe.js
```

- 单元/API 测试使用隔离临时目录和假上游，不触碰现有用户数据。
- 浏览器脚本使用合成音频和测试歌曲，覆盖原生输出、后台标签与收起面板、系统播放/暂停、加载中取消播放、快速暂停/恢复、状态轮询断网、歌词、歌单、切歌、跨标签接管、刷新、房间模式、手机布局和卡片转义；截图在工作区 `tmp/music-qa/`。桌面 Chromium 验证不能替代 iPhone 实机的后台音频验收。
- 实网探测短暂启动只监听本机的兼容服务，匿名检查搜索、详情、歌词、完整音源、Range 代理及二维码生成。退出时关闭测试服务；不会扫描二维码、登录账号、加入房间或打印 Cookie/媒体 URL。
- 真实双账号房间加入、会员音源和移动端后台播放仍须用实际账号/设备验收。

## 参考

- 房间邀请结构和端点参考：[ncm-listen-together](https://github.com/wuxiandudang-hash/ncm-listen-together)（MIT，兔兔 & Alex）。适配器在本项目重新实现，增加生命周期隔离、失败状态和真实退出。
- 兼容服务：[NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)，固定版本随独立服务的 package-lock 管理。
- 功能与状态设计参考用户提供的 Cove 共听架构指南，按本项目 Node 技术栈实现。
