import { binding, ensureDatabase } from "../../../../../lib/data";
import { ALLOWED_ACTIONS, canActivateCutting, nextStatus } from "../../../../../lib/domain";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabase();
    const db = binding();
    const { id } = await context.params;
    const taskId = Number(id);
    const payload = await request.json() as {
      action?: string;
      reason?: string;
      actor?: string;
      idempotencyKey?: string;
      rowVersion?: number;
    };
    const action = payload.action ?? "";
    const actor = payload.actor?.trim() || "当前用户";
    const idempotencyKey = payload.idempotencyKey?.trim();
    if (!idempotencyKey) return Response.json({ error: "缺少幂等键" }, { status: 400 });

    const duplicate = await db.prepare("SELECT id FROM audit_logs WHERE idempotency_key = ?").bind(idempotencyKey).first();
    if (duplicate) return Response.json({ ok: true, duplicate: true });

    const task = await db.prepare("SELECT * FROM process_tasks WHERE id = ?").bind(taskId).first<{
      id: number; style_id: number; process: string; status: string; row_version: number; assignee: string;
    }>();
    if (!task) return Response.json({ error: "任务不存在" }, { status: 404 });
    if (!ALLOWED_ACTIONS[action]?.includes(task.status as never)) {
      return Response.json({ error: `当前状态“${task.status}”不能执行该操作` }, { status: 409 });
    }
    if (payload.rowVersion && payload.rowVersion !== task.row_version) {
      return Response.json({ error: "任务已被其他人更新，请刷新后重试" }, { status: 409 });
    }

    const target = nextStatus(action);
    const now = new Date().toISOString();
    const startTime = action === "start" ? now : null;
    const endTime = action === "complete" ? now : null;
    const result = await db.prepare(`UPDATE process_tasks SET status = ?,
      actual_start = COALESCE(?, actual_start),
      actual_end = COALESCE(?, actual_end),
      pause_reason = CASE WHEN ? = 'pause' THEN ? WHEN ? = 'resume' THEN NULL ELSE pause_reason END,
      exception_note = CASE WHEN ? = 'exception' THEN ? ELSE exception_note END,
      row_version = row_version + 1
      WHERE id = ? AND row_version = ?`)
      .bind(target, startTime, endTime, action, payload.reason ?? null, action, action, payload.reason ?? null, taskId, task.row_version)
      .run();
    if ((result.meta.changes ?? 0) !== 1) {
      return Response.json({ error: "任务状态发生冲突，请刷新后重试" }, { status: 409 });
    }
    await db.prepare(`INSERT INTO audit_logs
      (entity_type, entity_id, action, before_value, after_value, actor, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind("工序任务", taskId, action, task.status, target, actor, idempotencyKey).run();

    if (action === "complete") {
      const siblingRows = await db.prepare("SELECT id, process, status, sequence, assignee FROM process_tasks WHERE style_id = ? ORDER BY sequence, id")
        .bind(task.style_id).all<{ id: number; process: string; status: string; sequence: number; assignee: string }>();
      if ((task.process === "备料" || task.process === "开版") && canActivateCutting(siblingRows.results)) {
        await db.prepare("UPDATE process_tasks SET status = '待开始', row_version = row_version + 1 WHERE style_id = ? AND process = '切割' AND status = '等待前置工序'")
          .bind(task.style_id).run();
      } else if (!["备料", "开版", "成型"].includes(task.process)) {
        const nextSequence = task.process === "切割" ? 3 : task.process === "加工" ? 4 : 5;
        const next = siblingRows.results.find((row) => row.sequence === nextSequence);
        if (next) await db.prepare("UPDATE process_tasks SET status = '待开始', row_version = row_version + 1 WHERE id = ? AND status = '等待前置工序'").bind(next.id).run();
      }

      if (task.process === "成型") {
        await db.prepare("UPDATE styles SET status = '已完成', current_process = '已完成' WHERE id = ?").bind(task.style_id).run();
        const styleRow = await db.prepare("SELECT order_id FROM styles WHERE id = ?").bind(task.style_id).first<{ order_id: number }>();
        if (styleRow) {
          const incomplete = await db.prepare("SELECT COUNT(*) AS count FROM styles WHERE order_id = ? AND status != '已完成'")
            .bind(styleRow.order_id).first<{ count: number }>();
          if ((incomplete?.count ?? 1) === 0) {
            await db.prepare("UPDATE sample_orders SET status = '已完成' WHERE id = ?").bind(styleRow.order_id).run();
          }
        }
      } else {
        const current = task.process === "备料" || task.process === "开版" ? "备料/开版" :
          task.process === "切割" ? "加工" : task.process === "加工" ? "针车" : "成型";
        await db.prepare("UPDATE styles SET current_process = ? WHERE id = ?").bind(current, task.style_id).run();
      }
    }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "任务操作失败" }, { status: 500 });
  }
}
