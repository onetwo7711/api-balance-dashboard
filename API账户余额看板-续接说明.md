# API账户余额看板-续接说明

记录时间：2026年11月4日晚。本文件用于工作中断或跨日续接时快速恢复上下文。

## 一、项目位置与交付物

- 项目根目录：`/Users/tsubasa/WorkBuddy/大模型财务查询/`
- 软件有三种使用形态：浏览器访问（本地服务＋网页）、桌面应用主窗口、桌面应用悬浮窗。
- 桌面安装包（目录`desktop/dist/`）：
  - `API账户余额看板-1.0.0-arm64.dmg`，115M，20时57分构建，含最新悬浮窗排版修正。
  - `API账户余额看板.app`，258M，19时53分构建。
  - `BUILD_REPORT.md`，20K，完整构建与验证记录。
- 使用说明文档：`output/00-最终交付/API账户余额看板使用说明.docx`，20456字节，已含桌面应用与悬浮窗两节。
- 文档修订轮次：`output/01-使用说明文档`、`02-修订-支持Python运行`、`03-修订-端口占用自动处理`、`04-修订-桌面应用形态`。

## 二、已完成事项

1. 余额看板本体：`public/`下的响应式页面，Node版`server.js`与Python版`server.py`两套等价后端，智谱GLM与DeepSeek双平台并发查询、定时与手动刷新、13类错误分类提示。
2. 启动脚本`start.command`：自动优先系统Python、其次PATH中的python3、最后Node.js；端口被占用时识别自身实例并只开浏览器，被其他程序占用时自动换端口。
3. Python标准库后端`server.py`，使无Node环境的机器可直接运行。
4. Electron桌面化（`desktop/`）：`main.js`主进程（自带本地服务、主窗口、悬浮窗、窗口状态记忆、IPC、快捷键、应用菜单）、`preload.js`（contextBridge暴露`window.desktopAPI`）、`fallback.html`（服务未就绪降级页）、`scripts/sync-resources.js`（打包前同步服务端与页面资源）、`package.json`（mac dmg+zip、win nsis、linux AppImage配置）。
5. 悬浮窗形态：标题条拖动、透明度30%至100%、置顶开关、尺寸与位置记忆、快捷键`CommandOrControl+Shift+B`切换悬浮窗与`CommandOrControl+Shift+W`唤起主窗口。
6. 说明文档四轮修订与成品重建。

## 三、当前状态（均已实测通过）

- 桌面应用启动验证：进程存活、8787端口监听、首页返回200且含标题、`/api/config`与`/api/balance`正常、未配置密钥时返回`NOT_CONFIGURED`符合预期。
- 悬浮窗目视核验：标题不折行、刷新与置顶与主窗口按钮横排、透明度滑块完整、两张卡片正常。
- 文档校验：含“桌面应用形态”“悬浮窗形态”“透明度滑块可在30%至100%之间调节”，斜体标记0，文字颜色仅000000，表格4张，中西文间空格自检0命中。
- npm缓存已清理（78M降至236K），后续会话的沙箱通道应恢复正常。

## 四、遗留问题与已知限制

1. dmg仅为Apple芯片版，Intel Mac需另行构建。
2. macOS未签名未公证，首次打开需右键选择“打开”，或执行`xattr -dr com.apple.quarantine "/Applications/API账户余额看板.app"`。
3. 应用图标仍是Electron默认图标，未提供`build/icon.icns`。
4. 悬浮窗透明度依赖系统窗口合成能力，Linux下不可用，滑块会自动禁用。
5. macOS全局快捷键需在系统设置→隐私与安全性→辅助功能中授权，否则失效并在主窗口页脚提示。
6. 桌面端本地服务在8787至8806之间顺延，全部被占用时弹窗报错并退出。
7. 本次会话因npm缓存文件过多导致沙箱profile超出65535字节上限，Bash通道全面失效；缓存已清理，`node_modules`已移至`/Users/tsubasa/.workbuddy/cache/api-balance-build/`，项目内已无`node_modules`，若要在项目内开发需重新安装或做软链。
8. 打包需固定electron版本（已改为45.2.2并补`build.electronVersion`）；在宿主命令行内启动Electron需先`unset ELECTRON_RUN_AS_NODE`。

## 五、明天可直接继续的事项

1. 构建Intel版安装包：在构建目录执行`npx electron-builder --mac dmg --x64`，产物同样复制回`desktop/dist/`。
2. 替换应用图标：放入`desktop/build/icon.icns`后重新打包。
3. 配置签名与公证：需Apple开发者证书，在`build.mac.identity`填证书名并补充notarization配置。
4. 构建Windows与Linux包：需在对应系统或用GitHub Actions完成（`--win`依赖Wine环境）。
5. 若继续修改软件：先改`server.js`与`public/`，再按`NN-修订-<改了什么>`新建修订轮目录，复用`working/tools/md2html.py`与转换脚本重建说明文档，保持文档与实现一致。
6. 若新增功能并接入桌面端：主进程能力通过`desktop/preload.js`暴露给页面，`public/app.js`中用`window.desktopAPI`判断桌面环境。

## 六、常用命令

- 浏览器形态：双击`start.command`；或`python3 server.py`、`node server.js`。
- 桌面开发：`cd desktop && npm start`（自动同步资源并启动）、`npm run pack`（免安装目录）、`npm run dist`（按当前平台打包）。
- 文档重建：在修订轮目录运行`python3 working/tools/md2html.py`，再用html-to-doc的`convert_doc.py`覆盖`output/00-最终交付/`中的docx。
