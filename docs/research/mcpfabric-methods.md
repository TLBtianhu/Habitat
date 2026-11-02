# mcpfabric 当前可用接口（2026-11-01 实测）

桥地址：`http://127.0.0.1:25600/rpc`（25599 被占用后改到 25600）

已验证：

- `session.info`：返回 `worldId / player / dimension`
- `screen.get`：返回 `inWorld / screen / paused`
- `player.getState`：坐标、视角、血量、饥饿、空气、维度、游戏模式
- `vision.describeScene`：眼睛位置、朝向、命中方块、实体列表（稀疏观测）
- `chat.send`：`{ message }`
- `control.lookAt`：`{ x, y, z }`
- `session.worlds`

从 mod jar 字符串中发现的接口：

- `control.look / control.setInput / control.stop / control.jumpOnce`
- `inventory.selectHotbar / inventory.swapSlots / inventory.dropSlot`
- `player.getInventory / player.getEquipment / player.getStatusEffects`
- `world.getBlock / world.getBlocks / world.findBlocks / world.raycast`
- `vision.screenshot`（本次返回 screenshot_failed，像素仍走 Xvfb）

**原生 MC 客户端已经进入世界，且 obs 与动作链路可用。**
