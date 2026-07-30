# 协议证据文档 — SOSEXY BLE 设备

> 最后更新: 2026-07-30
> 来源: GATT 枚举(阶段 3A) + 教程 PDF「啵啵贝接入claude教程（速通手把手版）」

---

## 1. 已确认的 GATT 结构（GATT_CONFIRMED）

来源：阶段 3A WinRT 原生 GATT 枚举

| 层级 | UUID | Handle | Properties |
|------|------|--------|------------|
| Service | `0000ee01-0000-1000-8000-00805f9b34fb` | 8 | VENDOR |
| Characteristic | `0000ee02-0000-1000-8000-00805f9b34fb` | 9 | NOTIFY |
| Descriptor | `00002902-0000-1000-8000-00805f9b34fb` | 11 | CCCD |
| Characteristic | `0000ee03-0000-1000-8000-00805f9b34fb` | 12 | WRITE |

GATT 结构与教程完全吻合。

---

## 2. 教程协议规则（TUTORIAL_CONFIRMED）

来源：教程 PDF 源码

### 2.1 Payload 结构 (12 字节)

| Offset | 教程值 | 含义 | 证据等级 |
|--------|--------|------|----------|
| 0 | `random.randint(0, 255)` | nonce / 随机字节 | TUTORIAL_CONFIRMED |
| 1 | `0x01` | 固定 | TUTORIAL_CONFIRMED |
| 2 | `0x00` | 固定 | TUTORIAL_CONFIRMED |
| 3 | `0x02` | 固定 | TUTORIAL_CONFIRMED |
| 4 | `0x00` | 固定 | TUTORIAL_CONFIRMED |
| 5 | `func_id` | 命令类型 | TUTORIAL_CONFIRMED |
| 6 | `0x11` | 固定 | TUTORIAL_CONFIRMED |
| 7 | `intensity` | 强度 (0–100) | TUTORIAL_CONFIRMED |
| 8 | `0x00` | 固定 | TUTORIAL_CONFIRMED |
| 9 | `tail[0]` | 命令尾缀 byte 0 | TUTORIAL_CONFIRMED |
| 10 | `tail[1]` | 命令尾缀 byte 1 | TUTORIAL_CONFIRMED |
| 11 | `tail[2]` | 命令尾缀 byte 2 | TUTORIAL_CONFIRMED |

### 2.2 命令表

| 命令 | func_id (offset 5) | tail[0:3] (offset 9–11) | intensity 范围 |
|------|--------------------|-------------------------|----------------|
| 震动 (vibration) | `0x01` | `[0x02, 0x11, 0x01]` | 0–100 |
| 吮吸 (suction) | `0x07` | `[0x08, 0x11, 0x04]` | 0–100 |

### 2.3 停止命令

按顺序发送两帧：
1. 吮吸 `intensity=0`（nonce 可独立）
2. 震动 `intensity=0`（nonce 可独立）

### 2.4 写入端点

```
0000ee03-0000-1000-8000-00805f9b34fb
```

使用 write with response。

---

## 3. Golden Fixtures（TUTORIAL_CONFIRMED）

### 3.1 吮吸 (nonce=0xAA, intensity=1)

```
AA 01 00 02 00 07 11 01 00 08 11 04
```

### 3.2 震动 (nonce=0xAA, intensity=1)

```
AA 01 00 02 00 01 11 01 00 02 11 01
```

### 3.3 吮吸停止 (nonce=0xAA, intensity=0)

```
AA 01 00 02 00 07 11 00 00 08 11 04
```

### 3.4 震动停止 (nonce=0xAA, intensity=0)

```
AA 01 00 02 00 01 11 00 00 02 11 01
```

---

## 4. 尚未确认的内容（UNKNOWN）

以下虽可能由教程暗示，但未经设备实际验证：

| 项目 | 状态 | 说明 |
|------|------|------|
| offset 0 是否参与校验 | UNKNOWN | 教程不生成校验字节 |
| offset 0 是否必须每次变化 | UNKNOWN | 教程使用 random，设备可能接受重复 nonce |
| 设备是否接受重复 nonce | UNKNOWN | 尚需实际测试 |
| EE02 是否会返回业务确认 | UNKNOWN | 通知端点存在，但未订阅过 |
| ATT Write Response 是否代表动作执行 | UNKNOWN | BLE 协议层 ACK ≠ 业务层 ACK |
| AE01/AE02 的用途 | UNKNOWN | 存在但不在教程中 |
| 震动和吮吸能否同时执行 | UNKNOWN | 教程未说明 |
| intensity=0 是否等价于从当前位置停止 | UNKNOWN | 教程为两命令分别发 intensity=0 |

---

## 5. 证据等级说明

| 等级 | 含义 |
|------|------|
| GATT_CONFIRMED | 本机 WinRT 枚举直接确认 |
| TUTORIAL_CONFIRMED | PDF 源码明确给出 |
| DEVICE_OBSERVED | 未来实际设备测试确认 |
| UNKNOWN | 无任何证据 |

---

## 6. 后续验证顺序

1. 订阅 EE02 通知
2. 用 nonce=0xAA, intensity=1 发吮吸到 EE03
3. 观察 EE02 是否有通知返回
4. 如成功，测试震动
5. 测试停止
6. 测试重复 nonce
7. 确认通知格式

---

## 7. 关键约定（重申）

- **EE03** 是写入端点
- **EE02** 是通知端点
- **ATT Write Response** ≠ 设备已执行动作
- **协议目前是 TUTORIAL_CONFIRMED**，不是 DEVICE_OBSERVED
- **AE01/AE02** 的用途仍然未知
