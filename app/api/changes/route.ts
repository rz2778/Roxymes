import { binding, ensureDatabase } from "../../../lib/data";
import { sendDingTalkMessage } from "../../../lib/dingtalk";

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const db = binding();
    const payload = await request.json() as { styleId?: number; reason?: string; content?: string; applicant?: string };
    if (!payload.styleId || !payload.content?.trim()) {
      return Response.json({ error: "请选择款式并填写变更内容" }, { status: 400 });
    }
    const style = await db.prepare("SELECT id, style_no, color, version FROM styles WHERE id = ?")
      .bind(payload.styleId).first<{ id: number; style_no: string; color: string; version: number }>();
    if (!style) return Response.json({ error: "款式不存在" }, { status: 404 });
    const nextVersion = style.version + 1;
    const applicant = payload.applicant?.trim() || "当前跟单员";
    const message = await sendDingTalkMessage({
      recipient: "样品室主管",
      title: "客户变更待评估",
      body: `${style.style_no} ${style.color} 已更新至 V${nextVersion}，请评估影响。`,
    });
    await db.batch([
      db.prepare("UPDATE styles SET version = ? WHERE id = ?").bind(nextVersion, style.id),
      db.prepare(`INSERT INTO change_records
        (style_id, from_version, to_version, reason, content, applicant, status)
        VALUES (?, ?, ?, ?, ?, ?, '待主管处理')`)
        .bind(style.id, style.version, nextVersion, payload.reason?.trim() || "客户要求", payload.content.trim(), applicant),
      db.prepare("INSERT INTO notifications (recipient, title, body, channel, status) VALUES (?, ?, ?, ?, ?)")
        .bind(message.recipient, message.title, message.body, message.channel, message.status),
      db.prepare("INSERT INTO audit_logs (entity_type, entity_id, action, before_value, after_value, actor) VALUES (?, ?, ?, ?, ?, ?)")
        .bind("样品款式", style.id, "提交客户变更", `V${style.version}`, `V${nextVersion}`, applicant),
    ]);
    return Response.json({ ok: true, version: nextVersion }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "变更提交失败" }, { status: 500 });
  }
}
