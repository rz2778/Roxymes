import {
  assertSameOrigin,
  errorResponse,
  requireUser,
} from "../../../lib/auth";
import { binding } from "../../../lib/data";
import { sendDingTalkMessage } from "../../../lib/dingtalk";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request, "change:create");
    const db = binding();
    const payload = await request.json() as {
      styleId?: number;
      reason?: string;
      content?: string;
    };
    if (!payload.styleId || !payload.content?.trim()) {
      return Response.json({ error: "请选择款式并填写变更内容" }, { status: 400 });
    }
    const style = await db.prepare(`SELECT id, style_no, color, version
      FROM styles WHERE id = ? AND org_id = ?`)
      .bind(payload.styleId, user.orgId)
      .first<{ id: number; style_no: string; color: string; version: number }>();
    if (!style) return Response.json({ error: "款式不存在" }, { status: 404 });

    const nextVersion = style.version + 1;
    const message = await sendDingTalkMessage({
      recipient: "样品室主管",
      title: "客户变更待评估",
      body: `${style.style_no} ${style.color} 已更新至 V${nextVersion}，请评估影响。`,
    });
    await db.batch([
      db.prepare("UPDATE styles SET version = ? WHERE id = ? AND org_id = ?")
        .bind(nextVersion, style.id, user.orgId),
      db.prepare(`INSERT INTO change_records
        (org_id, style_id, from_version, to_version, reason, content, applicant, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, '待主管处理')`)
        .bind(
          user.orgId,
          style.id,
          style.version,
          nextVersion,
          payload.reason?.trim() || "客户要求",
          payload.content.trim(),
          user.name,
        ),
      db.prepare(`INSERT INTO notifications
        (org_id, recipient, title, body, channel, status) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(user.orgId, message.recipient, message.title, message.body, message.channel, message.status),
      db.prepare(`INSERT INTO audit_logs
        (org_id, entity_type, entity_id, action, before_value, after_value, actor, actor_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          user.orgId,
          "样品款式",
          style.id,
          "提交客户变更",
          `V${style.version}`,
          `V${nextVersion}`,
          user.name,
          user.id,
        ),
    ]);
    return Response.json({ ok: true, version: nextVersion }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "变更提交失败");
  }
}
