# 自动化执行记忆：git 提交（大模型财务查询）

## 首次执行（2026-11-06）

**结果：成功。** 在 `/Users/tsubasa/WorkBuddy/大模型财务查询` 完成一次提交，
提交主题「feat: 配置目录统一到用户配置目录、应用图标与第5轮文档修订」，
父提交 `ac094fe`。精确哈希请执行 `git log -1`（本文件不写死哈希，避免后续 amend 后失效）。

**规模**：20 个文件变更（+803 / -55，含本自动化记忆文件本身），工作区文件累计约 411 KB；
新增 `desktop/build/icon.icns`、`desktop/build/icon.png`、`desktop/scripts/make-icon.py`、
`output/05-修订-配置目录统一与图标/` 全套产物；仓库已跟踪文件共 57 个。

## 关键踩坑（下次直接复用）

1. **`.git/index.lock` 残留会卡死 `git add`**。上一会话 15:41 的失败提交留下了锁文件，
   报错 `fatal: Unable to create '.git/index.lock': File exists.`。
   处理：确认无 git 进程在跑（`ps aux | grep [g]it`、`lsof .git/index.lock`）后 `rm -f .git/index.lock`。
   本会话一次通过，提交后锁文件未残留。

2. **`.git/objects/` 下的 `tmp_obj_*` 残留**（21 个，含上一会话遗留、本次提交又新生成若干）。
   触发 `git count-objects` 刷 "garbage found" 警告。这是文件代理拦截 git 写临时对象导致的，
   与提交成败无关（对象已正确落盘，`git fsck` 通过）。
   处理：`find .git/objects -name "tmp_obj_*" -type f -delete`，本会话已清零，复查为 0。

3. **沙箱临时文件命名含下划线**。`.gitignore` 原规则只匹配根目录 8 位纯小写字母数字，
   漏掉 `_q4bscxu`、`desktop/lei_bgf9` 这类含下划线的同名文件（内容均为 4 字节 "blat"）。
   已把规则放宽为 `**/[a-z0-9_]×8`，并新增 `__pycache__/`、`desktop/*.pid`。
   放宽前已确认仓库内无任何被跟踪文件/目录的 basename 恰好 8 位 `[a-z0-9_]`，无误伤。

4. **`desktop/build/` 必须入库**。`desktop/package.json` 的 build 段引用了
   `build/icon.icns`（macOS）与 `build/icon.png`（Windows/Linux），不提交则打包会失败；
   图标由 `npm run icon`（`scripts/make-icon.py`）生成，但产物需随仓库保存。

5. **敏感面核验通过**：`data/`、`desktop/dist/`、`desktop/node_modules/` 均被忽略且未跟踪；
   索引与 `git ls-files` 中 `data/config.json`、`.packtest`、`.tmp`、`.build-*`、`*.pid`、
   `*.pyc`、`__pycache__` 全部为 0 命中；待提交文件按 sk-/api_key 模式扫描无密钥命中。

## 遗留

- 本仓库此前仅 1 次提交（`ac094fe`），尚未配置远程仓库；本次提交**未推送**。
- `git fsck` 报 5 个 dangling blob（上一会话失败操作的无引用对象），不影响仓库可用性，
  可用 `git gc --prune=now` 清理。
