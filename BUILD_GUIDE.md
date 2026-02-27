# 使用 GitHub Actions 构建 Windows 安装包

## 步骤

### 1. 创建 GitHub 仓库
将代码上传到 GitHub 仓库（如果还没有的话）

### 2. 启用 GitHub Actions
1. 打开你的 GitHub 仓库
2. 进入 **Actions** 页面
3. 可能会提示让你创建一个 workflow，直接点击 "set up a workflow yourself" 或者忽略

### 3. 推送代码触发构建
```bash
git add .
git commit -m "Add build workflow"
git push origin main
```

### 4. 查看构建结果
1. 进入仓库的 **Actions** 页面
2. 可以看到 "Build" workflow 正在运行
3. 构建完成后，点击该 workflow
4. 找到 "Artifacts" 部分，下载 Windows 构建产物

### 5. 下载安装包
构建完成后会生成：
- Mac: `BinanceFollower-1.0.0.dmg`
- Windows: `BinanceFollower-1.0.0.exe` (NSIS 安装包)

## 注意事项

- 首次构建可能需要几分钟时间
- Windows 构建产物下载后是 zip 格式，解压即可得到安装包
- 构建产物保留 5 天，记得及时下载
