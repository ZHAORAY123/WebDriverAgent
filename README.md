# WebDriverAgent iOS 自动化工程

这是基于 Appium WebDriverAgent 改造的一套 iOS 自动化工程，当前重点服务于真机 App 自动化、用例管理后台、屏幕采集和芒果 TV 业务回归。

项目包含两部分：

- `WebDriverAgent`：运行在 iPhone / iPad / Simulator 上的自动化执行器。
- `demo/appium-smoke`：本地 Appium 用例平台，包含用例管理后台、动作模板、批量回归脚本和真机启动脚本。

## 快速开始

新机器拉下仓库后，在项目根目录执行：

```bash
./Scripts/deploy-appium-smoke.sh
```

这个脚本会自动准备本地运行环境：

- 安装 `demo/appium-smoke/node_modules`
- 创建 `demo/appium-smoke/.appium`
- 安装 Appium `xcuitest` driver
- 创建 `artifacts`、`logs`、`prebuilt-wda`、`case-data/uploads`
- 校验用例动作模板

这些目录都是本机运行产物，不直接提交到 Git。需要时通过脚本一键生成。

兼容旧入口：

```bash
./Scripts/setup-ios-appium-demo.sh
```

## 启动真机用例后台

先确认 iPhone 已连接、解锁、信任本机，并开启 Developer Mode。

查看设备：

```bash
./Scripts/list-ios-real-devices.sh
```

启动后台：

```bash
DEVICE_NAME="iPhone t" \
DEVICE_UDID=00008020-001139E82292002E \
DEVICE_OS=18.7.8 \
XCODE_ORG_ID=H7DVXY862C \
UPDATED_WDA_BUNDLE_ID=com.zhaorui.WebDriverAgentRunner.ios.1 \
./Scripts/run-case-admin-real-device.sh
```

默认地址：

```text
http://127.0.0.1:5177
```

后台支持：

- 用例分组管理
- 可视化用例编辑
- 运行当前、运行选中、运行全部
- 重复执行，最高支持 10000 次
- 暂停当前自动化执行
- 设备画面采集，支持自动刷新和手动刷新
- 用例运行进度、成功率、耗时和历史样本

## 常用脚本

```bash
# 一键部署本地运行环境
./Scripts/deploy-appium-smoke.sh

# 启动真机用例管理后台
./Scripts/run-case-admin-real-device.sh

# 查看真机列表
./Scripts/list-ios-real-devices.sh

# 跑模拟器 smoke 示例
./Scripts/run-ios-appium-smoke.sh

# 跑所有连接真机
./Scripts/run-ios-appium-all-real-devices.sh

# 准备预装 WDA 包
./Scripts/prepare-prebuilt-wda.sh
```

## 用例目录

- 用例库：`demo/appium-smoke/case-data/cases.json`
- 后台页面：`demo/appium-smoke/admin`
- 后台服务：`demo/appium-smoke/admin-server.mjs`
- 用例执行器：`demo/appium-smoke/lib/case-runner.mjs`
- Appium 工具封装：`demo/appium-smoke/lib/appium-ios-helpers.mjs`
- 动作模板校验：`demo/appium-smoke/scripts/validate-action-templates.mjs`

## 运行用例

进入 demo 目录：

```bash
cd demo/appium-smoke
```

查看用例：

```bash
npm run cases:list
```

校验动作模板：

```bash
npm run cases:validate-actions
```

运行单个用例：

```bash
node ./case-runner.mjs --id mgtv-cold-start-ad-skip-repeat
```

重复运行：

```bash
node ./case-runner.mjs --id mgtv-cold-start-ad-skip-repeat --repeat 100
```

## 冷启动广告跳过稳定性用例

核心用例：

```text
mgtv-cold-start-ad-skip-repeat
```

当前流程：

```text
杀 App
等待 5 秒
启动 App
识别并点击开屏广告“跳过”
确认首页或 App 可采集页面
回到后台 0.5 秒
回到前台
马上杀 App
进入下一轮
```

这个用例适合指定 `100`、`1000` 或 `10000` 次进行稳定性回归。

## 不提交的本机目录

以下目录由部署脚本自动生成，不放进 Git：

```text
demo/appium-smoke/node_modules
demo/appium-smoke/.appium
demo/appium-smoke/artifacts
demo/appium-smoke/logs
demo/appium-smoke/prebuilt-wda
DerivedData
```

原因：

- `node_modules` 可以由 `npm ci` 重新安装
- `.appium` 可以由 Appium driver install 重建
- `artifacts` 是截图、源码、报告等运行结果
- `logs` 是本机调试日志
- `prebuilt-wda` 是本机生成或缓存的 WDA 包
- `DerivedData` 是 Xcode 构建缓存

如果新机器缺这些目录，执行：

```bash
./Scripts/deploy-appium-smoke.sh
```

## 真机注意事项

真机运行前请确认：

- 手机已解锁
- 数据线连接稳定
- 已点击信任此电脑
- 已开启 Developer Mode
- Xcode 登录了可用 Apple Developer 账号
- `XCODE_ORG_ID` 和 `UPDATED_WDA_BUNDLE_ID` 配置正确
- 芒果 TV App 已安装，bundle id 默认为 `com.hunantv.imgotv`

默认情况下脚本会尽量复用已有 WDA，不主动卸载重装。

如果确实需要重装 WDA，可以显式设置：

```bash
USE_NEW_WDA=1
```

## 更多说明

详细教程见：

- [demo/appium-smoke/README.zh-CN.md](demo/appium-smoke/README.zh-CN.md)
- [LOCAL_REAL_DEVICE.md](LOCAL_REAL_DEVICE.md)

## License

WebDriverAgent 继承上游 BSD License，详见 [LICENSE](LICENSE)。
