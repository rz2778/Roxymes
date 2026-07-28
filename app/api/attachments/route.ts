import { env } from "cloudflare:workers";
import { binding, ensureDatabase } from "../../../lib/data";

type StorageEnv = { ATTACHMENTS: R2Bucket };

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const form = await request.formData();
    const file = form.get("file");
    const styleId = Number(form.get("styleId"));
    const version = Number(form.get("version") || 1);
    if (!(file instanceof File) || !styleId) {
      return Response.json({ error: "请选择文件和目标款式" }, { status: 400 });
    }
    if (file.size > 15 * 1024 * 1024) {
      return Response.json({ error: "单个附件不能超过 15MB" }, { status: 413 });
    }
    const bucket = (env as unknown as StorageEnv).ATTACHMENTS;
    if (!bucket) throw new Error("附件存储尚未绑定");
    const key = `styles/${styleId}/v${version}/${crypto.randomUUID()}-${file.name}`;
    await bucket.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
    await binding().prepare(`INSERT INTO attachments
      (style_id, version, object_key, file_name, content_type, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(styleId, version, key, file.name, file.type || "application/octet-stream", "当前用户").run();
    return Response.json({ ok: true, fileName: file.name }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "附件上传失败" }, { status: 500 });
  }
}
