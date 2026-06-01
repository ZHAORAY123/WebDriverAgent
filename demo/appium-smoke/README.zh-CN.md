# iOS 自动化实用教程

这份教程是给“把当前 WebDriverAgent 项目搬到另一台 Mac，然后尽快跑起 iOS 自动化”的场景准备的。

目标很简单：

- 新 Mac 上只做最少准备
- 一条命令完成 Appium 环境初始化
- 一条命令启动模拟器、启动 WebDriverAgent、启动 Appium、执行自动化脚本

## 这套方案里每个东西是干什么的

- `WebDriverAgent`：运行在 iOS 模拟器或真机里的自动化执行器
- `Appium`：给测试脚本提供统一入口，再转发给 `WebDriverAgent`
- `smoke-test.mjs`：一个最小可跑示例，默认会打开已安装的 `芒果TV` 并截图
- `cases/mgtv-search-switch-episode.mjs`：芒果TV业务用例，覆盖“搜索 -> 结果页 -> 点播页 -> 切集”
- `case-data/cases.json`：轻量用例库，用 JSON 维护图片、参数和交互动作
- `case-runner.mjs`：通用用例执行器，不需要每个场景都新增脚本
- `admin-server.mjs`：本地用例管理后台，支持图片上传、编辑动作、运行选中用例
- `run-ios-appium-smoke.sh`：一键联调脚本
- `setup-ios-appium-demo.sh`：新机器初始化脚本

执行链路是：

`测试脚本 -> Appium -> WebDriverAgent -> iPhone / Simulator`

## 目录说明

- Demo 目录：[demo/appium-smoke](/Users/ray/Documents/WebDriverAgent/demo/appium-smoke)
- 用例库：[demo/appium-smoke/case-data/cases.json](/Users/ray/Documents/WebDriverAgent/demo/appium-smoke/case-data/cases.json)
- 用例管理后台：[demo/appium-smoke/admin](/Users/ray/Documents/WebDriverAgent/demo/appium-smoke/admin)
- 一键运行脚本：[Scripts/run-ios-appium-smoke.sh](/Users/ray/Documents/WebDriverAgent/Scripts/run-ios-appium-smoke.sh)
- 一键初始化脚本：[Scripts/setup-ios-appium-demo.sh](/Users/ray/Documents/WebDriverAgent/Scripts/setup-ios-appium-demo.sh)
- 真机列表脚本：[Scripts/list-ios-real-devices.sh](/Users/ray/Documents/WebDriverAgent/Scripts/list-ios-real-devices.sh)
- 真机用例后台脚本：[Scripts/run-case-admin-real-device.sh](/Users/ray/Documents/WebDriverAgent/Scripts/run-case-admin-real-device.sh)
- 真机批量脚本：[Scripts/run-ios-appium-all-real-devices.sh](/Users/ray/Documents/WebDriverAgent/Scripts/run-ios-appium-all-real-devices.sh)
- 预装 WDA 处理脚本：[Scripts/prepare-prebuilt-wda.sh](/Users/ray/Documents/WebDriverAgent/Scripts/prepare-prebuilt-wda.sh)

## 新 Mac 需要提前准备什么

至少要有下面这些：

- Xcode
- Xcode Command Line Tools
- Node.js
- npm

建议第一次在新机器上先手动确认：

```bash
xcodebuild -version
xcode-select -p
node -v
npm -v
```

如果 `xcodebuild` 报错，通常先打开一次 Xcode，接受 license，再回来执行命令就好了。

## 推荐迁移方式

最稳的是迁移“源码”，不要依赖旧机器的缓存：

- 复制整个 `WebDriverAgent` 目录到新 Mac
- 不需要保留 `DerivedData`
- 不需要保留 `demo/appium-smoke/node_modules`
- 不需要保留 `demo/appium-smoke/.appium`

这些依赖和缓存都可以在新机器自动重建。

## 第一步：一键部署 Appium 环境

在项目根目录执行：

```bash
./Scripts/deploy-appium-smoke.sh
```

这个脚本会做这些事：

- 检查本机是否有 `xcodebuild`、`xcrun`、`node`、`npm`
- 安装 `demo/appium-smoke` 里的本地 Appium，也就是恢复 `node_modules`
- 安装 Appium 的 `xcuitest` driver
- 创建本机运行目录：`.appium`、`artifacts`、`logs`、`prebuilt-wda`、`case-data/uploads`
- 校验用例动作模板

如果这一步成功，说明新机器已经具备 Appium 侧的运行条件。

兼容旧命令仍然可用：

```bash
./Scripts/setup-ios-appium-demo.sh
```

## 第二步：一键跑通 iOS 自动化

继续在项目根目录执行：

```bash
./Scripts/run-ios-appium-smoke.sh
```

这个脚本会自动完成：

- 选择一个可用的 iPhone Simulator
- 启动模拟器
- 启动或复用 `WebDriverAgent`
- 启动或复用 `Appium`
- 创建 iOS 自动化 session
- 打开 `芒果TV` App
- 获取页面源码
- 截一张图

## 真机怎么跑

如果你想切到真机，推荐直接用 Appium 管理真机上的 WebDriverAgent。

这套真机脚本当前按 `iOS 13+` 设计：

- `iOS 13-16`：使用普通的 prebuilt WDA 包
- `iOS 17+`：自动切到 stripped prebuilt WDA 包，兼容新版 `testmanagerd` 变化

先确认：

- iPhone 已用数据线连接
- 手机已解锁
- 手机上已经点过 `Trust`
- 已开启 `Developer Mode`
- Xcode 已登录正确的 Apple 开发账号
- `./Scripts/list-ios-real-devices.sh` 里这台设备同时能被 Xcode 和 Appium/usbmux 看到

先看当前真机状态：

```bash
./Scripts/list-ios-real-devices.sh
```

然后在项目根目录执行：

```bash
XCODE_ORG_ID=你的TeamID \
UPDATED_WDA_BUNDLE_ID=com.yourname.WebDriverAgentRunner \
./Scripts/run-ios-appium-real-device.sh
```

默认会自动打开 `allowProvisioningUpdates + allowProvisioningDeviceRegistration`，首次接入新真机时会更稳一些。

如果你要指定某台真机，也可以加上：

```bash
DEVICE_NAME="Zhao的iPhone" \
DEVICE_UDID=00008101-000409AC0EF0001E \
XCODE_ORG_ID=你的TeamID \
UPDATED_WDA_BUNDLE_ID=com.yourname.WebDriverAgentRunner \
./Scripts/run-ios-appium-real-device.sh
```

如果你要让当前连接的所有测试机都各跑一遍，可以直接用：

```bash
XCODE_ORG_ID=你的TeamID \
UPDATED_WDA_BUNDLE_ID=com.yourname.WebDriverAgentRunner \
./Scripts/run-ios-appium-all-real-devices.sh
```

如果只想挑几台设备批量跑：

```bash
DEVICE_UDIDS=00008020-000629C601E8003A,00008101-000409AC0EF0001E \
XCODE_ORG_ID=你的TeamID \
UPDATED_WDA_BUNDLE_ID=com.yourname.WebDriverAgentRunner \
./Scripts/run-ios-appium-all-real-devices.sh
```

如果你已经提前在手机上装好了 `WebDriverAgentRunner-Runner.app`，也可以直接走“预装 WDA”模式：

```bash
USE_PREINSTALLED_WDA=1 \
UPDATED_WDA_BUNDLE_ID=com.yourname.WebDriverAgentRunner \
DEVICE_UDID=你的真机UDID \
./Scripts/run-ios-appium-real-device.sh
```

这条模式不会再重新签名和安装 WDA，但前提是：

- 手机上的这个开发者签名已经在系统里点过“信任”
- 这台手机上安装的 bundle id 和 `UPDATED_WDA_BUNDLE_ID` 一致
- App 本身能在手机上被正常启动，不是只显示已安装

默认情况下真机会尽量复用已有 WDA，不主动卸载重装。只有明确需要强制重装 WDA 时，才加：

```bash
USE_NEW_WDA=1
```

如果是真机 iOS 17+/18+，更稳的方式是先生成一个“去掉内置 XCTest 框架”的预装包：

```bash
./Scripts/prepare-prebuilt-wda.sh
```

然后再跑：

```bash
USE_PREINSTALLED_WDA=1 \
UPDATED_WDA_BUNDLE_ID=com.yourname.WebDriverAgentRunner \
DEVICE_UDID=你的真机UDID \
./Scripts/run-ios-appium-real-device.sh
```

如果你不想分两步，其实也可以直接只跑后一条命令。
`run-ios-appium-real-device.sh` 会在预装模式下自动生成默认的预处理包：

`/Users/ray/Documents/WebDriverAgent/demo/appium-smoke/prebuilt-wda/WebDriverAgentRunner-Runner.app`

这条路径会在每次 session 前重新安装这个预处理后的 WDA 包，更适合多台测试机重复部署。

如果你是 `iOS 13-16` 设备，也可以直接用同一条命令。
脚本会自动把预处理产物分成两套目录：

- `demo/appium-smoke/prebuilt-wda/ios13-16`
- `demo/appium-smoke/prebuilt-wda/ios17plus`

这样不同系统版本的测试机可以混用，不会互相覆盖。

这个脚本会自动完成：

- 启动或复用 Appium
- 让 Appium 调用 XCUITest driver
- 由 driver 编译、签名并启动真机上的 WebDriverAgent
- 在真机上打开 `芒果TV` App
- 获取页面源码
- 截图

如果成功，你会看到 `Smoke test passed`。

注意一件很容易误会的事：

- `Build Succeeded` 不等于已经把 WDA 安装并跑在手机上
- `WebDriverAgentRunner` 本质上是 XCTest runner
- 真机自动化要么走 `Appium 创建 session`，要么走 `xcodebuild test`
- 只做普通编译时，经常只会得到产物，不会真正把测试服务跑起来

## 成功后你会看到什么

成功时终端会输出类似结果：

- `WebDriverAgent is ready`
- `Appium is ready`
- `Session created`
- `Smoke test passed`

截图默认会保存在：

- 产物目录：[demo/appium-smoke/artifacts](/Users/ray/Documents/WebDriverAgent/demo/appium-smoke/artifacts)

日志默认会保存在：

- 日志目录：[demo/appium-smoke/logs](/Users/ray/Documents/WebDriverAgent/demo/appium-smoke/logs)

## 最常用的两条命令

初始化新机器：

```bash
./Scripts/setup-ios-appium-demo.sh
```

运行自动化示例：

```bash
./Scripts/run-ios-appium-smoke.sh
```

## 用例管理后台

如果你不想再通过新增 `.mjs` 文件来扩用例，可以启动本地后台：

```bash
cd demo/appium-smoke
npm run cases:admin
```

然后打开：

```text
http://127.0.0.1:5177
```

如果要连接真机并显示设备画面，推荐从项目根目录启动：

```bash
./Scripts/run-case-admin-real-device.sh
```

这个脚本会启动或复用 Appium，并用真机参数启动后台。默认会复用已有 WDA，不主动卸载重装。设备上已经预装好 WDA 时可以加：

```bash
USE_PREINSTALLED_WDA=1 ./Scripts/run-case-admin-real-device.sh
```

只有确实要强制重装 WDA 时才加：

```bash
USE_NEW_WDA=1 ./Scripts/run-case-admin-real-device.sh
```

后台支持：

- 维护用例标题、分组、优先级、标签和描述
- 上传一张参考图片，路径会保存到用例模型里
- 用 JSON 参数维护关键词、期望标题、目标集数等变量
- 通过动作列表组合自定义交互，不需要再写完整脚本
- 运行选中用例并查看日志

当前已经内置这些用例：

- 点播页按钮、滑动、全屏功能回归
- 搜索不同关键词批量回归
- 详情页标题、标签、选集分组校验
- 点击播放并校验播放态
- 首页 Tab、专题页、会员页路径用例

也可以直接命令行运行：

```bash
cd demo/appium-smoke
npm run cases:list
npm run cases:run
node ./case-runner.mjs --id mgtv-playback-state
node ./case-runner.mjs --group 点播页
node ./case-runner.mjs --tag 批量回归
```

常用动作包括：

- `relaunchToHome`：重启 App 并回到首页
- `searchKeyword`：搜索一个关键词
- `searchBatch`：批量搜索关键词
- `openVodDetailFromResults`：从搜索结果进入点播详情
- `clickAnyText` / `clickOptionalTexts`：点击一个或一组文本按钮
- `swipePercent` / `tapPercent`：按屏幕百分比滑动或点击
- `playAndAssert`：点击播放并校验播放态
- `enterFullscreen`：进入全屏并校验全屏后的功能入口
- `assertText` / `assertAllText` / `assertAnyText`：文本断言
- `saveScreenshot` / `saveSource`：保存截图或页面源码

现在默认会按 `bundleId=com.hunantv.imgotv` 直接启动已经安装好的 `芒果TV`，不需要额外设置 `app` 路径。

如果某台设备上暂时没有安装芒果TV，也可以临时覆盖成别的已安装 App：

```bash
APP_BUNDLE_ID=com.apple.Preferences \
APP_NAME=设置 \
./Scripts/run-ios-appium-smoke.sh
```

如果你要直接跑芒果TV业务用例，而不是最小截图冒烟，可以继续沿用同一条一键命令，只是把执行入口换成业务脚本：

模拟器：

```bash
TEST_ENTRY=./cases/mgtv-search-switch-episode.mjs \
KEYWORD="我的人间烟火" \
TARGET_EPISODE=2 \
./Scripts/run-ios-appium-smoke.sh
```

真机：

```bash
USE_PREINSTALLED_WDA=1 \
UPDATED_WDA_BUNDLE_ID=com.yourname.WebDriverAgentRunner \
DEVICE_UDID=你的真机UDID \
TEST_ENTRY=./cases/mgtv-search-switch-episode.mjs \
KEYWORD="我的人间烟火" \
TARGET_EPISODE=2 \
./Scripts/run-ios-appium-real-device.sh
```

这个业务用例当前会执行：

- 启动芒果TV并回到首页
- 尝试关闭首页弹窗
- 点击搜索
- 输入关键词
- 校验结果页
- 进入点播详情页
- 切换到指定集数

## 如何指定模拟器型号

默认会优先找：

- `SIM_NAME=iPhone 17`
- `SIM_OS=26.2`

你也可以临时指定：

```bash
SIM_NAME="iPhone 16 Pro" SIM_OS="18.6" ./Scripts/run-ios-appium-smoke.sh
```

## 如何验证 WebDriverAgent 是否已经就绪

```bash
curl http://127.0.0.1:8100/status
```

只要看到：

- `ready: true`
- `state: "success"`

就说明 WDA 已经可用。

## 如何验证 Appium 是否已经就绪

```bash
curl http://127.0.0.1:4723/status
```

如果能正常返回 JSON，说明 Appium 已经启动。

## 如果要迁移到多台 Mac，推荐这样做

每台新机器只执行两步：

1. 拷贝项目源码到本地
2. 在项目根目录执行：

```bash
./Scripts/setup-ios-appium-demo.sh
./Scripts/run-ios-appium-smoke.sh
```

这样就能做到“每台机器基本两条命令完成部署和验证”。

如果是多台真机环境，推荐改成这三步：

1. 拷贝项目源码到本地
2. 执行 `./Scripts/setup-ios-appium-demo.sh`
3. 执行 `./Scripts/run-ios-appium-all-real-devices.sh`

这样每台新 Mac 上都能直接把当前连着的测试机批量拉起并验活。

## 常见问题

### 1. 运行脚本时提示没有可用模拟器

先打开 Xcode，确认已经安装至少一个 iPhone Simulator runtime。

可以用这条命令查看：

```bash
xcrun simctl list devices available
```

### 2. `xcodebuild` 失败

常见原因：

- 还没打开过 Xcode
- Xcode license 没确认
- Xcode Command Line Tools 没指向正确版本

可以检查：

```bash
xcode-select -p
xcodebuild -version
```

### 3. Appium 起不来

先看日志：

```bash
cat demo/appium-smoke/logs/appium.log
```

### 4. WDA 起不来

先看日志：

```bash
cat demo/appium-smoke/logs/wda.log
```

再重点确认这几件事：

- 设备是不是出现在 `./Scripts/list-ios-real-devices.sh` 的两段输出里
- 目标 UDID 是不是在线，不是 `offline`
- Team ID 对应证书是不是带私钥
- 对应的 `com.xxx.WebDriverAgentRunner.xctrunner` profile 能不能自动生成
- 如果是预装模式，手机里是不是已经对这张开发者证书点过“信任”

### 5. 首次启动模拟器很慢

这是正常现象。首次启动时 iOS Simulator 会做系统迁移，后续会快很多。

## 后续扩展建议

现在这份 `smoke-test.mjs` 是最小演示。后面你可以继续扩成：

- 指定你自己的 App 进行自动化
- 接入 Jest / Mocha / WDIO
- 增加更多页面断言
- 接到 CI
- 扩成真机自动化流程

如果后面你想把它做成“公司里多台 Mac 共用的一键工具”，建议再加一层：

- 一个统一入口脚本
- 一个 `.env` 或机器配置文件
- 统一日志目录和失败截图目录

这样维护起来会更轻松。
