import {
  assertSameOrigin,
  errorResponse,
  requireUser,
} from "../../../lib/auth";
import { binding } from "../../../lib/data";

const processes = [
  ["备料", 1, "周师傅", "待开始"],
  ["开版", 1, "李师傅", "待开始"],
  ["切割", 2, "王师傅", "等待前置工序"],
  ["加工", 3, "赵师傅", "等待前置工序"],
  ["针车", 4, "孙师傅", "等待前置工序"],
  ["成型", 5, "钱师傅", "等待前置工序"],
] as const;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request, "order:create");
    const db = binding();
    const payload = await request.json() as {
      customer?: string;
      dueDate?: string;
      priority?: string;
      styleNo?: string;
      color?: string;
      size?: string;
      quantity?: number;
    };
    if (!payload.customer?.trim() || !payload.dueDate || !payload.styleNo?.trim() || !payload.color?.trim()) {
      return Response.json({ error: "客户、交期、款号和颜色为必填项" }, { status: 400 });
    }
    const orderNo = `YP-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const orderResult = await db.prepare(`INSERT INTO sample_orders
      (org_id, order_no, customer, merchandiser, due_date, priority, sample_type, status)
      VALUES (?, ?, ?, ?, ?, ?, '开发样', '生产中')`)
      .bind(
        user.orgId,
        orderNo,
        payload.customer.trim(),
        user.name,
        payload.dueDate,
        payload.priority || "普通",
      ).run();
    const orderId = Number(orderResult.meta.last_row_id);
    const styleResult = await db.prepare(`INSERT INTO styles
      (org_id, order_id, style_no, color, size, quantity, version, main_image, status, current_process)
      VALUES (?, ?, ?, ?, ?, ?, 1, 'mint', '生产中', '备料/开版')`)
      .bind(
        user.orgId,
        orderId,
        payload.styleNo.trim(),
        payload.color.trim(),
        payload.size?.trim() || null,
        payload.quantity || 1,
      ).run();
    const styleId = Number(styleResult.meta.last_row_id);
    await db.batch(processes.map((item) =>
      db.prepare(`INSERT INTO process_tasks
        (org_id, style_id, process, sequence, assignee, status, planned_start, planned_end)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(user.orgId, styleId, ...item, new Date().toISOString(), payload.dueDate)
    ));
    await db.batch([
      db.prepare(`INSERT INTO notifications
        (org_id, recipient, title, body, channel, status) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(user.orgId, "周师傅", "新的备料任务", `${orderNo} ${payload.styleNo} ${payload.color}`, "系统内", "待处理"),
      db.prepare(`INSERT INTO notifications
        (org_id, recipient, title, body, channel, status) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(user.orgId, "李师傅", "新的开版任务", `${orderNo} ${payload.styleNo} ${payload.color}`, "系统内", "待处理"),
      db.prepare(`INSERT INTO audit_logs
        (org_id, entity_type, entity_id, action, after_value, actor, actor_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(user.orgId, "样品单", orderId, "创建并排单", orderNo, user.name, user.id),
    ]);
    return Response.json({ ok: true, orderNo }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "样品单创建失败");
  }
}
