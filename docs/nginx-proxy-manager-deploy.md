# 教师端部署清单

本文档用于把教师端部署到国内服务器，并通过 `Nginx Proxy Manager` 暴露为正式域名。

推荐域名：

- `teacher.201807.xyz`

## 一、准备文件

在服务器上准备一个独立目录，例如：

```bash
mkdir -p /data/www/claremont-teacher
```

把教师端代码拉到服务器后，在项目目录执行：

```bash
npm install
cp .env.production.example .env.production
npm run build
```

构建完成后，会得到：

- `dist/`

建议把 `dist` 内容同步到：

```bash
/data/www/claremont-teacher/dist
```

## 二、生产环境变量

编辑：

- `.env.production`

当前可直接填写：

```env
VITE_SUPABASE_URL=https://ckgiwlblwkzenkxkbujx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_HQKz2j-33HdUcO6s5IrFoQ_rYgZeRCK
```

然后重新执行：

```bash
npm run build
```

## 三、Nginx Proxy Manager 配置

### 方案 A：有独立静态站点服务

如果你已经有一个本地 Nginx 在提供：

- `http://127.0.0.1:8084`

并且这个 Nginx 的根目录指向：

- `/data/www/claremont-teacher/dist`

那么在 `Nginx Proxy Manager` 里新建一个 `Proxy Host`：

- Domain Names: `teacher.201807.xyz`
- Scheme: `http`
- Forward Hostname / IP: `127.0.0.1`
- Forward Port: `8084`

SSL：

- 开启 `Block Common Exploits`
- 开启 `Websockets Support`
- 开启 `Force SSL`

### 方案 B：直接用 NPM 托管静态目录

如果你是在宿主机自己维护 Nginx，也可以给教师端单独配一个 server：

```nginx
server {
    listen 8084;
    server_name _;

    root /data/www/claremont-teacher/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

然后再由 `Nginx Proxy Manager` 反代到 `127.0.0.1:8084`。

仓库里也已经放好了可直接改路径使用的示例文件：

- [deploy/nginx/teacher.201807.xyz.conf.example](/Volumes/移动磁盘/peixun%20/teacher_app/deploy/nginx/teacher.201807.xyz.conf.example)

## 四、部署后检查

访问：

- `https://teacher.201807.xyz`

重点验证：

1. 登录页能正常打开
2. 教师账号 `teacher@claremont.local / Gwj@5952` 能登录
3. 作业中心能读取作业
4. 教材资源能上传 PDF
5. 点评队列能读取提交记录

## 五、更新流程

后续更新教师端时：

```bash
git pull
npm install
npm run build
```

如果静态目录已直接指向最新 `dist`，通常不需要改 NPM 配置。
