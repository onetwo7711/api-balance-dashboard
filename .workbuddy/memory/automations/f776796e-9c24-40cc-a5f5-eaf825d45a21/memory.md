# 自动化执行记忆 — T1 Electron 重新打包

## 用途
任务：把 `/Users/tsubasa/WorkBuddy/大模型财务查询` 的 Electron 桌面应用重新打包，
并用 ditto 覆盖到项目交付目录 `desktop/dist/`。
完整报告写入 `/Users/tsubasa/.workbuddy/cache/api-balance-build/task1.log`（KEY=VALUE 格式，追加模式）。

## 首次执行记录（2026-11-04 20:13 CST）
- 结果：**成功**（T1_STATUS=成功，T1_PACK_ERROR=none）
- 构建目录：`/Users/tsubasa/.workbuddy/cache/api-balance-build/desktop`
  （node_modules/electron 45.2.2 与 electron-builder 26.18.0 已就位，**无需重装**）
- 产物：`desktop/dist/mac-arm64/API账户余额看板.app` → ditto 覆盖至
  `/Users/tsubasa/WorkBuddy/大模型财务查询/desktop/dist/API账户余额看板.app`（258M）
- 校验方式：md5 逐文件比对交付包与源项目（app.asar 内 main.js、Resources 内 server.js、public/{app.js,index.html,styles.css}）全部一致

## 可复用经验（下次直接照做）
1. **node 路径**：PATH 里的 node 已指向 `/Users/tsubasa/.workbuddy/binaries/node/versions/22.22.2-6/bin/node`（v22.22.2），无需显式指定。
2. **不要用 rm -rf 删旧产物**：`dist/mac-arm64` 用 `mv dist/mac-arm64 dist/mac-arm64-old-<YYYYmmdd-HHMMSS>` 改名保留。
3. **ditto 覆盖前先 diff 文件清单**（`diff <(cd OLD && find . -type f|sort) <(cd NEW && find . -type f|sort)`）。
   本次新旧 .app 文件树完全一致、无差异文件，故 ditto 合并覆盖不会残留旧文件；
   若日后有 `<` 独有行（仅旧包存在），必须先 `mv` 旧包再 ditto，否则会留下过期文件。
4. **`--dir` 不生成 dmg**：只产出未打包的 .app 目录。项目 `desktop/dist/` 里的
   `API账户余额看板-1.0.0-arm64.dmg`（115M / 120845729B）仍是 19:10 旧产物，**未包含本次 float-bar 修正**。
   如需新 dmg，要额外跑 `npx electron-builder --mac dmg`（或去掉 --dir）。
5. **find -path 大小写敏感**：`-path "*resources*"` 匹配不到 `Contents/Resources/`（大写 R），
   校验时用 `ls Contents/Resources` 或 `-path "*Resources*"`。
6. **打包很快**（约 3 秒，electron 已缓存下载）；主要耗时在 ditto 复制 258M。
7. **源文件保护**：全程只从项目源读、往构建目录写，项目源文件时间戳保持 20:04 及更早，未被改动。

## 已知遗留
- `desktop/dist/` 中的 .dmg 仍为上一轮旧版，若需分发需重新生成。
- 构建缓存目录 `desktop/dist/` 内累积了多个 `mac-arm64.old.*` / `mac-arm64-old-*` 目录（各约 258M），
  占空间但可回溯；清理需走废纸篓，不可 rm -rf。
