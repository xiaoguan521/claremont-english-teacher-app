# 克莱蒙英语教师端

基于 `React + Vite + Supabase` 的教师工作台，当前已经接通：

- 邮箱登录与会话保持
- 教师 / 校区管理员权限识别
- 班级、学员、作业、教材常用页面
- 教材记录创建与 PDF 上传
- 作业创建与首条练习项录入

## 本地开发

```bash
npm install
npm run dev
```

默认端口是 `4174`。

## 环境变量

复制 `.env.example` 到 `.env`，并填写：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

## GitHub Actions

仓库需要配置这两个 Secrets：

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

工作流文件在 `.github/workflows/web-build.yml`，会在 `main` 分支推送、PR 和手动触发时构建。
