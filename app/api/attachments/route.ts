import {
  assertSameOrigin,
  errorResponse,
  RequestError,
  requireUser,
} from "../../../lib/auth";
import { isSupervisor } from "../../../lib/authorization";
import { binding } from "../../../lib/data";


export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request, "attachment:self");
    const form = await request.formData();
    const file = form.get("file");
    const styleId = Number(form.get("styleId"));
    const version = Number(form.get("version") || 1);
    if (!(file instanceof File) || !styleId) {
      return Response.json({ error: "请选择文件和目标款式" }, { status: 400 });
    }
    const uploadedFile = file;
    if (uploadedFile.size > 15 * 1024 * 1024) {
      return Response.json({ error: "单个附件不能超过 15MB" }, { status: 413 });
    }
    const db = binding();
    const style = await db.prepare("SELECT id, version FROM styles WHERE id = ? AND org_id = ?")
      .bind(styleId, user.orgId)
      .first<{ id: number; version: number }>();
    if (!style) return Response.json({ error: "目标款式不存在" }, { status: 404 });
    if (version !== style.version) {
      return Response.json({ error: "附件版本与当前款式版本不一致" }, { status: 409 });
    }

    if (!isSupervisor(user.role)) {
      const assignment = await db.prepare(`SELECT id FROM process_tasks
        WHERE org_id = ? AND style_id = ?
        AND assignee_user_id = ?
        LIMIT 1`)
        .bind(user.orgId, styleId, user.id).first();
      if (!assignment) {
        throw new RequestError("你只能给自己参与的款式上传附件", 403, "RESOURCE_FORBIDDEN");
      }
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("附件存储尚未配置");
    const safeName = uploadedFile.name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-120) || "attachment";
    const key = `orgs/${user.orgId}/styles/${styleId}/v${version}/${crypto.randomUUID()}-${safeName}`;
    throw new Error("附件存储正在迁移至 Vercel Blob，暂不支持上传");
    await db.prepare(`INSERT INTO attachments
      (org_id, style_id, version, object_key, file_name, content_type, uploaded_by, uploaded_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        user.orgId,
        styleId,
        version,
        key,
        uploadedFile.name,
        uploadedFile.type || "application/octet-stream",
        user.name,
        user.id,
      ).run();
    return Response.json({ ok: true, fileName: uploadedFile.name }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "附件上传失败");
  }
}
