# API账户余额看板

一款macOS桌面应用，用于同时查看智谱GLM与DeepSeek两个平台的API账户剩余金额。应用自带后台查询服务，双击即用，不需要安装运行时，也不需要手动打开浏览器。

## 功能

- 两个平台余额并排展示：金额、币种、最近更新时间、余额构成明细、数据来源与本次查询耗时。
- 手动刷新与定时自动刷新（关闭／每1分钟／每5分钟／每15分钟／每30分钟），带倒计时。
- 13类错误分类提示：密钥未配置、密钥无效、余额不足、请求限流、接口变更、网络异常等，每类都给出错误码与处置建议。
- 主窗口与悬浮窗两种形态：悬浮窗无边框半透明，支持拖动、30%至100%透明度调节、置顶开关，尺寸、位置、透明度与置顶状态均会记忆。
- 快捷键：`CommandOrControl+Shift+B`显示或隐藏悬浮窗，`CommandOrControl+Shift+W`唤起主窗口。
- API密钥可直接粘贴，菜单栏提供完整的「编辑」菜单。

## 目录结构

```
server.js                本地服务（零第三方依赖，Node 18+）
public/                  页面：index.html、app.js、styles.css
desktop/                 桌面应用（Electron 45）
  main.js                主进程：本地服务、双窗口、状态记忆、IPC、快捷键、菜单
  preload.js             预加载桥，暴露 window.desktopAPI
  fallback.html          服务未就绪时的降级页
  scripts/               资源同步与图标生成脚本
  build/                 应用图标源（icon.png、icon.icns）
  dist/                  构建产物，不纳入版本库
tools/md2html.py         说明文档渲染脚本
output/                  说明文档与历次修订记录
```

## 开发与构建

依赖安装在本仓库之外进行，构建产物不纳入版本库。

```bash
cd desktop && npm start      # 启动应用开发模式
cd desktop && npm run icon   # 重新生成应用图标
cd desktop && npm run pack   # 生成免安装目录
cd desktop && npm run dist   # 按当前平台打包
```

说明文档的重建流程：修改`output/`下某一轮修订的`stage1/final_draft.md`，运行`python3 tools/md2html.py`生成HTML，再用html-to-doc的`convert_doc.py`转换为docx，输出到`output/00-最终交付/`。

## 隐私与配置

- API密钥只保存在本机的用户配置目录，文件权限仅当前用户可读：macOS为`~/Library/Application Support/API账户余额看板/config.json`。
- 页面只接收脱敏后的密钥尾号，密钥明文不会回传到界面，也不会上传到任何服务器。
- 应用只在本机回环地址上提供服务，同一网络中的其他设备无法访问。
- 可用环境变量`BALANCE_DATA_DIR`把配置放到自定义目录。

## 使用边界

软件只做余额的读取与展示，不提供账号登录、充值、账单明细与历史趋势、余额告警与通知、数据导出、多账户切换，也不修改平台账户设置。查询过程不调用模型推理，不产生token消耗。

智谱官方未提供公开的余额查询接口，应用使用平台控制台所使用的账户接口并做多端点回退；该接口可能随平台改版失效，届时可在设置中填写自定义余额接口地址。
