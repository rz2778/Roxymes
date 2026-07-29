export function getDb() {
  throw new Error("数据库适配器尚未配置。Vercel 部署请先连接 Neon Postgres。");
}
