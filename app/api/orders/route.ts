import { binding, ensureDatabase } from "../../../lib/data";

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
    await ensureDatabase();
    const db = binding();
    const payload = await request.json() as {
      customer?: string; merchandiser?: string; dueDate?: string; priority?: string;
      styleNo?: string; color?: string; size?: string; quantity?: number;
    };
    if (!payload.customer?.trim() || !payload.dueDate || !payload.styleNo?.trim() || !payload.color?.trim()) {
      return Response.json({ error: "客户、交期、款号和颜色为必填项" }, { status: 400 });
    }
    const orderNo = `YP-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${Math.floor(100 + Math.random() * 900)}`;
    const orderResult = await db.prepare(`INSERT INTO sample_orders
      (order_no, customer, merchandiser, due_date, priority, sample_type, status)
      VALUES (?, ?, ?, ?, ?, '开发样', '生产中')`)
      .bind(orderNo, payload.customer.trim(), payload.merchandiser?.trim() || "当前跟单员", payload.dueDate, payload.priority || "普通").run();
    const orderId = Number(orderResult.meta.last_row_id);
    const styleResult = await db.prepare(`INSERT INTO styles
      (order_id, style_no, color, size, quantity, version, main_image, status, current_process)
      VALUES (?, ?, ?, ?, ?, 1, 'mint', '生产中', '备料/开版')`)
      .bind(orderId, payload.styleNo.trim(), payload.color.trim(), payload.size?.trim() || null, payload.quantity || 1).run();
    const styleId = Number(styleResult.meta.last_row_id);
    await db.batch(processes.map((item) =>
      db.prepare("INSERT INTO process_tasks (style_id, process, sequence, assignee, status, planned_start, planned_end) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(styleId, ...item, new Date().toISOString(), payload.dueDate)
    ));
    await db.batch([
      db.prepare("INSERT INTO notifications (recipient, title, body, channel, status) VALUES (?, ?, ?, ?, ?)").bind("周师傅", "新的备料任务", `${orderNo} ${payload.styleNo} ${payload.color}`, "系统内（钉钉待联调）", "待处理"),
      db.prepare("INSERT INTO notifications (recipient, title, body, channel, status) VALUES (?, ?, ?, ?, ?)").bind("李师傅", "新的开版任务", `${orderNo} ${payload.styleNo} ${payload.color}`, "系统内（钉钉待联调）", "待处理"),
      db.prepare("INSERT INTO audit_logs (entity_type, entity_id, action, after_value, actor) VALUES (?, ?, ?, ?, ?)").bind("样品单", orderId, "创建并排单", orderNo, payload.merchandiser?.trim() || "当前跟单员"),
    ]);
    return Response.json({ ok: true, orderNo }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "样品单创建失败" }, { status: 500 });
  }
}
