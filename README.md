# 林青交易看板

这是一个可本地运行、也可直接部署到云端的轻量交易看板。

现在项目已经支持两种用法：

- 本地模式：只在当前电脑浏览器里保存
- 云端共享模式：部署到常在线平台后，手机和电脑访问同一个网址，并同步同一份数据

## 这次改完后，能解决什么

如果你把它部署到 Railway 这类常在线平台：

- 电脑关机后，手机仍然能打开
- 手机改的数据会保存在云端
- 电脑下次再打开同一个网址，也会看到同一份数据

## 本地启动

如果你只是本机临时使用：

```powershell
.\start-server.ps1
```

或者：

```powershell
python server.py --host 0.0.0.0 --port 8000
```

打开：

```text
http://127.0.0.1:8000
```

## 推荐部署方案：Railway

这是当前最适合这个项目的部署方式，因为它能把前端页面和 Python 同步服务一起跑起来，并且支持给 `state.json` 挂持久化存储。

### 1. 推到 GitHub

把当前项目代码推到你的 GitHub 仓库。

### 2. 在 Railway 新建项目

- 登录 Railway
- 选择 `New Project`
- 选择 `Deploy from GitHub repo`
- 选中这个仓库

仓库根目录已经带了 `Dockerfile`，Railway 会直接按容器方式部署。

### 3. 给服务挂一个 Volume

这是最关键的一步。没有 Volume，云端重启后共享数据可能丢。

在 Railway 里：

- 给这个服务添加一个 Volume
- 挂载路径填：`/app/data`

代码会自动把共享数据写到这个目录下的 `state.json`。

### 4. 可选：加访问密码

如果你不想让任何拿到链接的人都能打开，给服务环境变量加上：

```text
BOARD_USERNAME=linqing
BOARD_PASSWORD=换成你自己的强密码
```

### 5. 打开服务域名

部署完成后，Railway 会给你一个公开域名。以后你手机和电脑都访问这个域名。

## 第一次把旧数据迁到云端

这一点很重要。

如果你之前的数据只存在本地浏览器里，那么第一次部署上云后，建议这样做：

1. 先在你原来那台有数据的设备上打开旧页面
2. 点击“导出 JSON”
3. 打开新的云端网址
4. 点击“导入 JSON”

这样可以把你原来本地的数据完整迁到云端共享存储。

补充说明：

- 现在前端已经做了保护
- 如果云端还是空的，而当前设备也没有本地旧数据，它不会立刻把默认演示数据自动写成共享数据

## 云端运行时的持久化规则

后端会按下面顺序选择共享数据文件位置：

1. `BOARD_STATE_FILE`
2. `BOARD_DATA_DIR/state.json`
3. `RAILWAY_VOLUME_MOUNT_PATH/state.json`
4. `RENDER_DISK_MOUNT_PATH/state.json`
5. 项目根目录下的 `state.json`

也就是说，在 Railway 上只要 Volume 挂好了，通常不需要再额外改路径。

## 项目文件

- `index.html`：页面结构
- `style.css`：页面样式
- `script.js`：前端逻辑和自动同步
- `data.js`：默认初始数据
- `server.py`：共享状态服务
- `start-server.ps1`：本地一键启动
- `Dockerfile`：云端容器部署文件
- `.dockerignore`：部署时忽略本地无关文件

## 注意

- GitHub Pages 只适合静态展示，不适合这次这种“可修改并自动同步”的需求
- 真正让“电脑关机也能用”的关键不是 GitHub，而是把 `server.py` 部署到一台一直在线的机器上
