# 克莱蒙英语教师端

面向教师和平板工作台场景的 Web 应用，基于 `React + Vite + Supabase` 构建。

## 当前范围

- 邮箱登录与会话保持
- 教师 / 校区管理员权限识别
- 班级、学员、作业、教材常用页面
- 教材记录创建与 PDF 上传
- 作业创建与首条练习项录入
- GitHub Actions Web 构建

## 技术栈

- `React`
- `Vite`
- `React Router`
- `Supabase`

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

生产环境可参考：

- `.env.production.example`

## GitHub Actions

工作流文件：

- `.github/workflows/web-build.yml`

仓库需要配置：

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

## 部署

国内服务器 + `Nginx Proxy Manager` 部署步骤见：

- [docs/nginx-proxy-manager-deploy.md](/Volumes/移动磁盘/peixun%20/teacher_app/docs/nginx-proxy-manager-deploy.md)

## 相关仓库

- 学生端：[claremont-english-student-app](https://github.com/xiaoguan521/claremont-english-student-app)
- 教师端：[claremont-english-teacher-app](https://github.com/xiaoguan521/claremont-english-teacher-app)
- 管理端：[claremont-english-management-app](https://github.com/xiaoguan521/claremont-english-management-app)
