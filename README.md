# 欧皇战队积分赛

这是一个适合 GitHub Pages 发布的单页版群内足球游戏积分联赛管理网页。

## 现在主要看这些文件

- `index.html`：网页入口，GitHub Pages 会直接打开它。
- `style.css`：电竞深色 UI 样式。
- `main.js`：所有页面、积分规则、Meta、战报、周结算、自动分组逻辑。
- `supabase-config.js`：数据源配置。默认是本地测试；填入 Supabase 后变成公开共享数据。
- `supabase-config.example.js`：Supabase 配置模板。
- `supabase-setup.sql`：Supabase 建表脚本。

旧的 `client/`、`server/` 是之前完整前后端版本，暂时保留作参考；公开发布优先用根目录这套静态版。

## 本地测试

直接打开：

```text
index.html
```

或用任意本地静态服务器打开本目录。未配置 Supabase 时，数据会存在当前浏览器的 `localStorage` 里，只适合自己测试。

默认后台密码：

```text
admin
```

## 发布成公开网址

推荐方式：

1. 把本目录上传到 GitHub 仓库。
2. 仓库设置里开启 GitHub Pages。
3. Source 选择 `main` 分支和 `/root`。
4. GitHub 会生成公开网址。

## 让群友共享同一份数据

1. 注册并创建 Supabase 项目。
2. 打开 Supabase 的 SQL Editor。
3. 执行 `supabase-setup.sql`。
4. 在 Supabase 项目设置里找到：
   - Project URL
   - anon public key
5. 修改 `supabase-config.js`：

```js
window.OH_LEAGUE_SUPABASE = {
  url: "https://你的项目.supabase.co",
  anonKey: "你的 anon public key",
  rowId: "main",
  adminPassword: "改成你自己的后台密码"
};
```

6. 提交到 GitHub。

配置完成后，所有人打开同一个 GitHub Pages 链接，看到的就是同一份排行榜和战报数据。

## 权限说明

这版追求简单方便：后台靠网页密码隐藏，Supabase 表允许公开读写同一份联赛 JSON 数据。对群内信任场景够用，也最接近“一个 HTML 网页直接分享”的体验。

如果以后要做强权限，比如防止别人绕过网页直接改数据库，就需要升级到 Supabase Edge Function 或完整后端。

## 功能入口

- 首页：当前 Meta、甲组排行榜、规则简介、荣誉榜。
- 排行榜：全体积分榜，支持按组别筛选。
- 提交战报：玩家免登录录入比分、胜平负、Meta 队套使用者。
- 后台：添加玩家、删除玩家、手动积分修正、修改 Meta、模拟周结算、强制重新分组、删除比赛、异常对刷查看。

## 已实现规则

- 胜 +3，平 +1，负 +0。
- 本周 Meta 队套：胜/平额外加分，负不加分。
- 支持平局额外积分、队套奖励倍率、连胜奖励倍率、特定组别加成。
- 同两名玩家每周最多 2 场有效比赛。
- 跨组比赛自动无效。
- 三连胜 +1、五连胜 +2、十连胜 +3，每周每种奖励只触发一次。
- 每周至少 5 场有效比赛，少一场扣 1 分。
- 强制周结算后按总积分自动分组：前 10 甲组、11-20 乙组、以此类推。
- 第一位达到 300 分自动进入总冠军荣誉榜。
