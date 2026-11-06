# API账户余额看板-续接说明

记录时间：2026年11月6日（本次为11月4日桌面化改造之后的续做）。本文件用于工作中断或跨日续接时快速恢复上下文。

## 一、项目位置与交付物

- 项目根目录：`/Users/tsubasa/WorkBuddy/大模型财务查询/`
- 三种使用形态：浏览器访问（本地服务＋网页）、桌面应用主窗口、桌面应用悬浮窗。三者共用同一份配置与同一套页面。
- 使用说明文档：`output/00-最终交付/API账户余额看板使用说明.docx`（20915字节，已含桌面应用、悬浮窗、配置目录与迁移说明）。
- 文档修订轮次：`01-使用说明文档`、`02-修订-支持Python运行`、`03-修订-端口占用自动处理`、`04-修订-桌面应用形态`、`05-修订-配置目录统一与图标`。
- 构建依赖：`node_modules`位于`/Users/tsubasa/.workbuddy/cache/api-balance-build/node_modules`（electron 45.2.2、electron-builder 26.18.0），项目内不保留依赖目录。

## 二、本轮（11月6日）完成事项

1. 修复配置目录不一致（核心缺陷）。此前文档称「桌面应用与浏览器形态共用同一份配置」，实际并非如此：桌面应用把配置写入Electron的userData目录，浏览器形态写在项目`data`目录，两边各存一份。现改为按平台约定统一：macOS为`~/Library/Application Support/API账户余额看板`、Windows为`%APPDATA%\API账户余额看板`、Linux为`~/.config/API账户余额看板`，该目录恰好与Electron的userData一致，因此三种形态真正共用一份`config.json`。改动文件：`server.js`、`server.py`、`desktop/main.js`（去掉dataDir覆盖）。
2. 旧配置自动迁移。新目录没有配置而旧目录（程序目录`data/config.json`）存在时，启动时自动复制一份过去，旧文件保留不删除；可用环境变量`BALANCE_DATA_DIR`指定自定义目录。
3. 应用图标。新增`desktop/scripts/make-icon.py`，纯标准库按SDF绘制1024×1024图标（近黑圆角方块＋白色上升折线＋绿色端点），用sips与iconutil合成icns；`desktop/package.json`接入`build.mac.icon`（icns）与`build.win`、`build.linux.icon`（png），新增`npm run icon`脚本。
4. 文档第5轮修订（`output/05-修订-配置目录统一与图标`）：8处修改，并同步`public/index.html`页脚的密钥保存位置口径。

## 三、验证结论

- 语法：`server.js`与`server.py`编译通过。
- 迁移：Node后端启动后，旧目录配置被复制到`~/Library/Application Support/API账户余额看板/config.json`并成功读到；Python后端读到同一份配置且未重复迁移；旧文件保留未删除。
- 打包场景：模拟打包环境（server.js置于无`data`子目录的`Resources`下）启动正常，读到约定目录配置且无迁移提示，确认打包后逻辑正确。
- 页面与文档：页面页脚口径已同步；docx关键词全命中、斜体0、文字颜色仅000000、表格4张、中西文间空格自检0命中。

## 四、遗留问题与已知限制

1. macOS安装包未做代码签名与公证，首次打开需右键选择「打开」，或执行`xattr -dr com.apple.quarantine "/Applications/API账户余额看板.app"`。
2. Intel版安装包尚未生成，需要执行`electron-builder --mac dmg --x64`。
3. 在WorkBuddy沙箱进程内运行electron-builder会静默失败（解压electron阶段进程被文件代理终止，日志无报错），需在独立会话中执行；同样，Electron桌面应用在沙箱内启动会因无法删除userData下的`SingletonLock`而退出，这两条均为宿主环境限制，用户本机双击运行不受影响。
4. 沙箱内`mkdir`、`tee`、`tail`等命令被代理包装后无法创建临时文件，执行构建类命令时改用`python3 -c`建目录、直接重定向写日志，并显式设置`TMPDIR`到工作区内。
5. 悬浮窗透明度依赖系统窗口合成能力，Linux下不可用，滑块会自动禁用。
6. macOS全局快捷键需在系统设置→隐私与安全性→辅助功能中授权，否则失效并在主窗口页脚提示。
7. 桌面端本地服务在8787至8806之间顺延，全部被占用时弹窗报错并退出。

## 五、下一步可直接继续的事项

1. 确认`desktop/dist/`下的arm64安装包已由独立会话重建完成（含新图标与新配置逻辑）；如需Intel版，再执行`electron-builder --mac dmg --x64`。
2. 配置签名与公证：需Apple开发者证书，在`build.mac.identity`填证书名并补充notarization配置。
3. 构建Windows与Linux包：需在对应系统或用GitHub Actions完成（`--win`依赖Wine环境）。
4. 若继续修改软件：先改`server.js`与`public/`，再按`NN-修订-<改了什么>`新建修订轮目录，复用`working/tools/md2html.py`与html-to-doc的`convert_doc.py`重建说明文档，保持文档与实现一致。
5. 若新增功能并接入桌面端：主进程能力通过`desktop/preload.js`暴露，页面用`window.desktopAPI`判断桌面环境。

## 六、常用命令

- 浏览器形态：双击`start.command`；或`python3 server.py`、`node server.js`。
- 桌面开发：`cd desktop && npm start`（自动同步资源并启动）、`npm run pack`（免安装目录）、`npm run dist`（按当前平台打包）、`npm run icon`（重绘图标）。
- 构建目录：先把`desktop/`、`server.js`、`public/`同步到`/Users/tsubasa/.workbuddy/cache/api-balance-build/`，再执行`node scripts/sync-resources.js`，然后在该目录运行`./node_modules/.bin/electron-builder`。
- 文档重建：在修订轮目录运行`python3 working/tools/md2html.py`，再用html-to-doc的`convert_doc.py`覆盖`output/00-最终交付/`中的docx。
