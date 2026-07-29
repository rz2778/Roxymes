"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type AppRole = "member" | "supervisor" | "admin";
type AuthUser = {
  id: number;
  orgId: number;
  corpId: string;
  dingtalkUserId: string;
  name: string;
  avatar: string | null;
  role: AppRole;
};
type Order = {
  id: number; order_no: string; customer: string; merchandiser: string;
  due_date: string; priority: string; sample_type: string; status: string;
  style_count: number; completed_styles: number;
};
type Style = {
  id: number; order_id: number; style_no: string; color: string; size?: string;
  quantity: number; version: number; main_image: string; status: string; current_process: string;
};
type Task = {
  id: number; style_id: number; process: string; assignee: string; status: string;
  assignee_user_id?: number | null;
  row_version: number; order_no: string; style_no: string; color: string; customer: string;
  due_date: string; priority: string; main_image: string; exception_note?: string;
};
type Change = {
  id: number; style_id: number; style_no: string; color: string; order_no: string;
  from_version: number; to_version: number; reason: string; content: string;
  applicant: string; status: string; created_at: string;
};
type Audit = {
  id: number; entity_type: string; action: string; before_value?: string;
  after_value?: string; actor: string; created_at: string;
};
type Notice = { id: number; title: string; body: string; status: string; created_at: string };
type Attachment = { id: number; style_id: number; version: number; file_name: string; created_at: string };
type OrgMember = {
  id: number;
  name: string;
  avatar: string | null;
  role: AppRole;
  dingtalk_user_id: string;
};
type DashboardData = {
  viewer?: AuthUser;
  orders: Order[]; styles: Style[]; tasks: Task[]; changes: Change[];
  notifications: Notice[]; audits: Audit[]; attachments: Attachment[]; members: OrgMember[];
};

type DingTalkClient = {
  ready(callback: () => void): void;
  error(callback: (error: unknown) => void): void;
  env?: { platform?: string };
  runtime: {
    permission: {
      requestAuthCode(options: {
        corpId: string;
        onSuccess(result: { code: string }): void;
        onFail(error: unknown): void;
      }): void;
    };
  };
  biz?: {
    navigation?: {
      setTitle(options: { title: string }): void;
    };
  };
};

declare global {
  interface Window {
    dd?: DingTalkClient;
  }
}

const emptyData: DashboardData = {
  orders: [], styles: [], tasks: [], changes: [], notifications: [], audits: [], attachments: [], members: [],
};

const nav = [
  { key: "overview", label: "工作总览", short: "概" },
  { key: "orders", label: "样品单", short: "单" },
  { key: "tasks", label: "我的任务", short: "任" },
  { key: "changes", label: "变更追溯", short: "变" },
];
const navKeys = new Set(nav.map((item) => item.key));

const processNames = ["备料", "开版", "切割", "加工", "针车", "成型"];
const DINGTALK_SCRIPT_ID = "dingtalk-jsapi";
const DINGTALK_SCRIPT_URL = "https://g.alicdn.com/dingding/dingtalk-jsapi/3.1.0/dingtalk.open.js";

async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const method = (init?.method || "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  if (method !== "GET" && method !== "HEAD") {
    headers.set("x-sampleflow-request", "1");
  }
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event("sampleflow:unauthorized"));
  }
  return response;
}

function isDingTalkClient() {
  return typeof navigator !== "undefined" && /DingTalk|AliApp\(DingTalk/i.test(navigator.userAgent);
}

async function loadDingTalkClient(): Promise<DingTalkClient> {
  if (window.dd) return window.dd;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const existing = document.getElementById(DINGTALK_SCRIPT_ID) as HTMLScriptElement | null;
    // A failed or timed-out element will never fire load again. Replace it on every retry.
    existing?.remove();
    const script = document.createElement("script");
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.removeEventListener("load", loaded);
      script.removeEventListener("error", failed);
      if (error) {
        script.remove();
        reject(error);
      }
      else resolve();
    };
    const loaded = () => finish();
    const failed = () => finish(new Error("钉钉组件加载失败"));
    const timer = window.setTimeout(
      () => finish(new Error("钉钉组件加载超时，请检查网络后重试")),
      10_000,
    );
    script.addEventListener("load", loaded);
    script.addEventListener("error", failed);
    script.id = DINGTALK_SCRIPT_ID;
    script.src = DINGTALK_SCRIPT_URL;
    script.async = true;
    document.head.appendChild(script);
  });
  if (!window.dd) throw new Error("当前环境未提供钉钉客户端能力");
  return window.dd;
}

async function requestDingTalkCode(client: DingTalkClient, corpId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(
      () => fail(new Error("钉钉授权响应超时，请重新打开应用")),
      10_000,
    );
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(dingTalkErrorMessage(error)));
    };
    client.error(fail);
    client.ready(() => {
      client.biz?.navigation?.setTitle({ title: "SampleFlow 样品室" });
      client.runtime.permission.requestAuthCode({
        corpId,
        onSuccess: ({ code }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(code);
        },
        onFail: fail,
      });
    });
  });
}

function dingTalkErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as { errorMessage?: string; errmsg?: string; message?: string };
    return value.errorMessage || value.errmsg || value.message || "钉钉免登授权失败";
  }
  return "钉钉免登授权失败";
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function statusClass(status: string) {
  if (["异常", "逾期"].includes(status)) return "danger";
  if (["进行中", "生产中"].includes(status)) return "active";
  if (["已完成"].includes(status)) return "done";
  if (["暂停", "待主管处理"].includes(status)) return "warn";
  return "neutral";
}

export default function MesApp() {
  const [data, setData] = useState<DashboardData>(emptyData);
  const [viewer, setViewer] = useState<AuthUser | null>(null);
  const [authState, setAuthState] = useState<"checking" | "ready" | "error">("checking");
  const [authError, setAuthError] = useState("");
  const [active, setActive] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [taskFilter, setTaskFilter] = useState("全部");
  const [orderModal, setOrderModal] = useState(false);
  const [changeModal, setChangeModal] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<Style | null>(null);
  const [acting, setActing] = useState<number | null>(null);

  const authenticate = useCallback(async () => {
    setAuthState("checking");
    setLoading(true);
    setAuthError("");
    try {
      const currentResponse = await fetch("/api/auth/me", { cache: "no-store" });
      if (currentResponse.ok) {
        const current = await currentResponse.json() as { user: AuthUser };
        setViewer(current.user);
        setAuthState("ready");
        return;
      }
      if (currentResponse.status !== 401) {
        const current = await currentResponse.json() as { error?: string };
        throw new Error(current.error || "无法读取登录状态");
      }
      if (!isDingTalkClient()) {
        throw new Error("请从钉钉工作台打开 SampleFlow 样品室");
      }

      const configResponse = await fetch("/api/auth/config", { cache: "no-store" });
      const config = await configResponse.json() as { corpId?: string; error?: string };
      if (!configResponse.ok || !config.corpId) {
        throw new Error(config.error || "钉钉应用尚未完成配置");
      }
      const client = await loadDingTalkClient();
      const code = await requestDingTalkCode(client, config.corpId);
      const loginResponse = await apiFetch("/api/auth/dingtalk", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sampleflow-request": "1",
        },
        body: JSON.stringify({ code }),
      });
      const login = await loginResponse.json() as { user?: AuthUser; error?: string };
      if (!loginResponse.ok || !login.user) {
        throw new Error(login.error || "钉钉免登失败");
      }
      setViewer(login.user);
      setAuthState("ready");
    } catch (error) {
      setViewer(null);
      setAuthState("error");
      setAuthError(error instanceof Error ? error.message : "钉钉免登失败");
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch("/api/dashboard", { cache: "no-store" });
      const result = await response.json() as DashboardData & { error?: string };
      if (!response.ok) throw new Error(result.error || "加载失败");
      setData(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void authenticate(); }, 0);
    return () => window.clearTimeout(timer);
  }, [authenticate]);
  useEffect(() => {
    const reauthenticate = () => {
      setViewer(null);
      void authenticate();
    };
    window.addEventListener("sampleflow:unauthorized", reauthenticate);
    return () => window.removeEventListener("sampleflow:unauthorized", reauthenticate);
  }, [authenticate]);
  useEffect(() => {
    if (authState !== "ready" || !viewer) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [authState, load, viewer]);
  useEffect(() => {
    const syncNavigation = () => {
      const key = window.location.hash.replace(/^#\/?/u, "");
      setActive(navKeys.has(key) ? key : "overview");
      setOrderModal(false);
      setChangeModal(false);
      setSelectedStyle(null);
    };
    syncNavigation();
    window.addEventListener("hashchange", syncNavigation);
    return () => window.removeEventListener("hashchange", syncNavigation);
  }, []);

  const navigateTo = useCallback((key: string) => {
    if (!navKeys.has(key)) return;
    const nextHash = `#/${key}`;
    if (window.location.hash === nextHash) setActive(key);
    else window.location.hash = nextHash;
  }, []);

  const openTasks = useMemo(
    () => data.tasks.filter((task) => ["待开始", "进行中", "暂停", "异常"].includes(task.status)),
    [data.tasks],
  );
  const actionableTasks = useMemo(
    () => openTasks.filter((task) => {
      if (!viewer || viewer.role !== "member") return true;
      return task.assignee_user_id != null && task.assignee_user_id === viewer.id;
    }),
    [openTasks, viewer],
  );
  const visibleTasks = useMemo(() => actionableTasks.filter((task) => {
    if (taskFilter !== "全部" && task.status !== taskFilter && !(taskFilter === "加急" && task.priority === "紧急")) return false;
    const term = search.trim().toLowerCase();
    return !term || `${task.order_no}${task.style_no}${task.color}${task.assignee}`.toLowerCase().includes(term);
  }), [actionableTasks, search, taskFilter]);
  const riskCount = data.tasks.filter((task) => ["异常", "暂停"].includes(task.status)).length;
  const completion = data.tasks.length
    ? Math.round(data.tasks.filter((task) => task.status === "已完成").length / data.tasks.length * 100)
    : 0;

  async function taskAction(task: Task, action: string, reason?: string) {
    setActing(task.id);
    setMessage("");
    try {
      const response = await apiFetch(`/api/tasks/${task.id}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          reason,
          rowVersion: task.row_version,
          idempotencyKey: `${task.id}-${action}-${crypto.randomUUID()}`,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "操作失败");
      setMessage(action === "complete" ? "工序已完成，后续任务已自动检查" : "任务状态已更新");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setActing(null);
    }
  }

  async function assignTask(task: Task, userId: number) {
    setActing(task.id);
    setMessage("");
    try {
      const response = await apiFetch(`/api/tasks/${task.id}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId,
          rowVersion: task.row_version,
        }),
      });
      const result = await response.json() as { error?: string; assignee?: { name: string } };
      if (!response.ok) throw new Error(result.error || "任务分配失败");
      setMessage(`任务已分配给 ${result.assignee?.name || "所选成员"}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "任务分配失败");
    } finally {
      setActing(null);
    }
  }

  function styleTasks(styleId: number) {
    return data.tasks.filter((task) => task.style_id === styleId);
  }

  if (authState !== "ready" || !viewer) {
    return (
      <AuthGate
        state={authState}
        message={authError}
        retry={() => { void authenticate(); }}
      />
    );
  }

  const canManage = viewer.role === "supervisor" || viewer.role === "admin";
  const roleName = viewer.role === "admin" ? "管理员" : viewer.role === "supervisor" ? "主管" : "成员";
  const initials = viewer.name.slice(0, 1);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">样</div>
          <div><strong>样品流</strong><span>SampleFlow</span></div>
        </div>
        <nav>
          {nav.map((item) => (
            <button key={item.key} className={active === item.key ? "nav-item selected" : "nav-item"} onClick={() => navigateTo(item.key)}>
              <span className="nav-icon">{item.short}</span>{item.label}
              {item.key === "tasks" && actionableTasks.length > 0 && <b>{actionableTasks.length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="sync-dot" />钉钉组织已连接
          <small>{viewer.name} · {roleName}</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">样品室 · 今日工作台</p>
            <h1>{nav.find((item) => item.key === active)?.label}</h1>
          </div>
          <div className="top-actions">
            <label className="search">
              <span>⌕</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索单号、款号或人员" />
            </label>
            <button className="notice-button" aria-label="消息中心" onClick={() => navigateTo("changes")}>
              通知 <b>{data.notifications.filter((notice) => notice.status !== "已处理").length}</b>
            </button>
            <div className="viewer-chip" title={`${viewer.name} · ${roleName}`}>
              {viewer.avatar
                ? <>
                  {/* DingTalk avatar URLs are dynamic and cannot be preconfigured for image optimization. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="avatar" src={viewer.avatar} alt="" referrerPolicy="no-referrer" />
                </>
                : <div className="avatar">{initials}</div>}
              <span>{viewer.name}<small>{roleName}</small></span>
            </div>
          </div>
        </header>

        {message && <button className="toast" onClick={() => setMessage("")}>{message}<span>×</span></button>}

        <div className="content">
          {loading ? <Loading /> : (
            <>
              {active === "overview" && (
                <Overview
                  data={data}
                  completion={completion}
                  riskCount={riskCount}
                  openTasks={actionableTasks}
                  onCreate={() => setOrderModal(true)}
                  canManage={canManage}
                  viewerName={viewer.name}
                  members={data.members}
                  canAssign={canManage}
                  onAssign={assignTask}
                  onTaskAction={taskAction}
                  acting={acting}
                  onOpenStyle={(style) => setSelectedStyle(style)}
                />
              )}
              {active === "orders" && (
                <Orders data={data} search={search} canManage={canManage} onCreate={() => setOrderModal(true)} onOpenStyle={setSelectedStyle} />
              )}
              {active === "tasks" && (
                <Tasks
                  tasks={visibleTasks}
                  members={data.members}
                  canAssign={canManage}
                  filter={taskFilter}
                  setFilter={setTaskFilter}
                  action={taskAction}
                  assign={assignTask}
                  acting={acting}
                />
              )}
              {active === "changes" && (
                <Changes data={data} canManage={canManage} onCreate={() => setChangeModal(true)} />
              )}
            </>
          )}
        </div>
      </section>

      <div className="mobile-nav">
        {nav.map((item) => (
          <button key={item.key} className={active === item.key ? "selected" : ""} onClick={() => navigateTo(item.key)}>
            <span>{item.short}</span>{item.label.replace("工作", "").replace("我的", "").replace("追溯", "")}
          </button>
        ))}
      </div>

      {orderModal && canManage && <OrderModal viewerName={viewer.name} close={() => setOrderModal(false)} done={async (text) => { setMessage(text); setOrderModal(false); await load(); }} />}
      {changeModal && canManage && <ChangeModal viewerName={viewer.name} styles={data.styles} close={() => setChangeModal(false)} done={async (text) => { setMessage(text); setChangeModal(false); await load(); }} />}
      {selectedStyle && (
        <StyleDrawer
          style={selectedStyle}
          tasks={styleTasks(selectedStyle.id)}
          attachments={data.attachments.filter((item) => item.style_id === selectedStyle.id)}
          close={() => setSelectedStyle(null)}
          uploaded={async () => { setMessage("附件已绑定到当前款式版本"); await load(); }}
        />
      )}
    </main>
  );
}

function AuthGate({
  state,
  message,
  retry,
}: {
  state: "checking" | "ready" | "error";
  message: string;
  retry: () => void;
}) {
  return (
    <main className="auth-gate">
      <section className="auth-card">
        <div className="auth-logo">样</div>
        <span className="section-tag">SampleFlow</span>
        <h1>{state === "checking" ? "正在连接钉钉组织" : "暂时无法进入样品室"}</h1>
        <p>
          {state === "checking"
            ? "正在确认你的组织成员身份和工作权限…"
            : message || "请从钉钉工作台重新打开应用。"}
        </p>
        {state === "checking"
          ? <div className="auth-progress"><i /></div>
          : <button className="primary" onClick={retry}>重新验证</button>}
        <small>企业内部应用 · 登录状态由钉钉组织统一管理</small>
      </section>
    </main>
  );
}

function Loading() {
  return <div className="loading-grid">{[1, 2, 3, 4, 5, 6].map((item) => <div className="loading-card" key={item} />)}</div>;
}

function Overview({
  data, completion, riskCount, openTasks, onCreate, canManage, viewerName,
  members, canAssign, onAssign, onTaskAction, acting, onOpenStyle,
}: {
  data: DashboardData; completion: number; riskCount: number; openTasks: Task[];
  onCreate: () => void; canManage: boolean; viewerName: string;
  members: OrgMember[]; canAssign: boolean; onAssign: (task: Task, userId: number) => void;
  onTaskAction: (task: Task, action: string, reason?: string) => void;
  acting: number | null; onOpenStyle: (style: Style) => void;
}) {
  const statusCards = [
    { label: "在制样品单", value: data.orders.filter((order) => order.status !== "已完成").length, note: "全部进入系统", tone: "ink" },
    { label: "我的待办", value: openTasks.length, note: `${openTasks.filter((task) => task.priority === "紧急").length} 个加急`, tone: "blue" },
    { label: "暂停 / 异常", value: riskCount, note: "需要现场关注", tone: "orange" },
    { label: "工序完成率", value: `${completion}%`, note: "按全部任务统计", tone: "green" },
  ];
  const currentTasks = openTasks.slice(0, 4);
  return (
    <>
      <section className="hero-strip">
        <div>
          <span className="hero-kicker">7 月 28 日 · 周二</span>
          <h2>你好，{viewerName}</h2>
          <p>今天有 <strong>{openTasks.length}</strong> 个在办任务，<strong>{riskCount}</strong> 个风险项需要关注。</p>
        </div>
        {canManage && <button className="primary" onClick={onCreate}><span>＋</span> 新建样品单</button>}
      </section>

      <section className="metric-grid">
        {statusCards.map((card) => (
          <article className={`metric-card ${card.tone}`} key={card.label}>
            <span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <div className="panel task-panel">
          <div className="panel-title">
            <div><span className="section-tag">现场执行</span><h3>当前任务</h3></div>
            <button className="text-button">查看全部 →</button>
          </div>
          <div className="task-list">
            {currentTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                members={members}
                canAssign={canAssign}
                action={onTaskAction}
                assign={onAssign}
                acting={acting}
              />
            ))}
          </div>
        </div>
        <div className="panel process-panel">
          <div className="panel-title">
            <div><span className="section-tag">实时流转</span><h3>工序负荷</h3></div>
            <span className="live"><i />实时</span>
          </div>
          <div className="load-list">
            {processNames.map((name) => {
              const tasks = data.tasks.filter((task) => task.process === name && task.status !== "已完成");
              const active = tasks.filter((task) => task.status === "进行中").length;
              const percent = Math.min(100, 20 + tasks.length * 14);
              return (
                <div className="load-row" key={name}>
                  <div><strong>{name}</strong><span>{tasks.length} 项待办 · {active} 项进行中</span></div>
                  <div className="load-bar"><i style={{ width: `${percent}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="panel order-preview">
        <div className="panel-title">
          <div><span className="section-tag">交期优先</span><h3>样品单进度</h3></div>
          <span className="muted">备料 / 开版并行，完成后自动汇入切割</span>
        </div>
        <div className="style-grid">
          {data.styles.slice(0, 4).map((style) => {
            const order = data.orders.find((item) => item.id === style.order_id);
            return <StyleCard key={style.id} style={style} order={order} onClick={() => onOpenStyle(style)} />;
          })}
        </div>
      </section>
    </>
  );
}

function TaskRow({ task, members, canAssign, action, assign, acting }: {
  task: Task;
  members: OrgMember[];
  canAssign: boolean;
  action: (task: Task, action: string, reason?: string) => void;
  assign: (task: Task, userId: number) => void;
  acting: number | null;
}) {
  const disabled = acting === task.id;
  return (
    <article className="task-row">
      <div className={`sample-thumb ${task.main_image}`}><span>{task.style_no.slice(-3)}</span></div>
      <div className="task-main">
        <div className="task-title">
          <strong>{task.style_no} · {task.color}</strong>
          {task.priority === "紧急" && <span className="priority">加急</span>}
          <span className={`status ${statusClass(task.status)}`}>{task.status}</span>
        </div>
        <p>{task.order_no} · {task.customer} · {task.process} / {task.assignee}</p>
      </div>
      <div className="deadline"><span>交期</span><strong>{dateLabel(task.due_date)}</strong></div>
      <div className="task-actions">
        {canAssign && (
          <label className="assign-control">
            <span>分配给</span>
            <select
              aria-label={`将 ${task.style_no} ${task.process} 分配给`}
              value={task.assignee_user_id ?? ""}
              disabled={disabled || members.length === 0}
              onChange={(event) => {
                const userId = Number(event.target.value);
                if (userId) assign(task, userId);
              }}
            >
              <option value="" disabled>{members.length ? "选择组织成员" : "暂无可分配成员"}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} · {member.role === "admin" ? "管理员" : member.role === "supervisor" ? "主管" : "成员"}
                </option>
              ))}
            </select>
          </label>
        )}
        {task.status === "待开始" && <button disabled={disabled} className="small primary" onClick={() => action(task, "start")}>开始</button>}
        {task.status === "进行中" && <>
          <button disabled={disabled} className="small secondary" onClick={() => action(task, "pause", "等待现场确认")}>暂停</button>
          <button disabled={disabled} className="small primary" onClick={() => action(task, "complete")}>完成</button>
        </>}
        {["暂停", "异常"].includes(task.status) && <button disabled={disabled} className="small primary" onClick={() => action(task, "resume")}>恢复</button>}
      </div>
    </article>
  );
}

function StyleCard({ style, order, onClick }: { style: Style; order?: Order; onClick: () => void }) {
  const tasksDone = style.status === "已完成";
  return (
    <button className="style-card" onClick={onClick}>
      <div className={`style-image ${style.main_image}`}><span>{style.style_no}</span><em>效果图</em></div>
      <div className="style-info">
        <div><strong>{style.style_no}</strong><span className={`status ${statusClass(style.status)}`}>{style.status}</span></div>
        <p>{style.color} · {style.size || "通码"} · {style.quantity} 双</p>
        <div className="style-meta"><span>V{style.version}</span><span>{order?.order_no}</span><span>{order ? dateLabel(order.due_date) : ""}</span></div>
        <div className="progress-line"><i style={{ width: tasksDone ? "100%" : `${Math.max(16, (processNames.indexOf(style.current_process) + 1) * 17)}%` }} /></div>
        <small>当前：{style.current_process}</small>
      </div>
    </button>
  );
}

function Orders({ data, search, canManage, onCreate, onOpenStyle }: {
  data: DashboardData;
  search: string;
  canManage: boolean;
  onCreate: () => void;
  onOpenStyle: (style: Style) => void;
}) {
  const orders = data.orders.filter((order) => !search || `${order.order_no}${order.customer}${order.merchandiser}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <section className="panel page-panel">
      <div className="page-head">
        <div><span className="section-tag">全流程主数据</span><h2>样品单与款式</h2><p>按交期排序，款式是最小流转单位。</p></div>
        {canManage && <button className="primary" onClick={onCreate}>＋ 新建样品单</button>}
      </div>
      <div className="order-table">
        <div className="order-table-head"><span>样品单 / 客户</span><span>跟单员</span><span>交期</span><span>款式进度</span><span>状态</span></div>
        {orders.map((order) => (
          <div className="order-block" key={order.id}>
            <div className="order-row">
              <div><strong>{order.order_no}</strong><small>{order.customer} · {order.sample_type}</small></div>
              <span>{order.merchandiser}</span>
              <span>{dateLabel(order.due_date)} {order.priority === "紧急" && <b className="priority">加急</b>}</span>
              <span>{order.completed_styles || 0} / {order.style_count}</span>
              <span><i className={`status ${statusClass(order.status)}`}>{order.status}</i></span>
            </div>
            <div className="order-styles">
              {data.styles.filter((style) => style.order_id === order.id).map((style) => (
                <button key={style.id} onClick={() => onOpenStyle(style)}>
                  <i className={`mini-swatch ${style.main_image}`} />
                  <span><strong>{style.style_no} · {style.color}</strong><small>V{style.version} · 当前 {style.current_process}</small></span>
                  <b>查看流程 →</b>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Tasks({ tasks, members, canAssign, filter, setFilter, action, assign, acting }: {
  tasks: Task[]; filter: string; setFilter: (value: string) => void;
  members: OrgMember[]; canAssign: boolean;
  action: (task: Task, action: string, reason?: string) => void;
  assign: (task: Task, userId: number) => void;
  acting: number | null;
}) {
  return (
    <section className="panel page-panel">
      <div className="page-head">
        <div><span className="section-tag">手机端同款操作</span><h2>我的工序任务</h2><p>正常任务只需“开始、完成”两次点击。</p></div>
      </div>
      <div className="filter-tabs">
        {["全部", "待开始", "进行中", "暂停", "异常", "加急"].map((item) => (
          <button key={item} className={filter === item ? "selected" : ""} onClick={() => setFilter(item)}>{item}</button>
        ))}
      </div>
      {canAssign && (
        <p className="assignment-hint">
          {members.length
            ? "分配列表仅包含已打开过本应用的组织成员；找不到成员时，请先让对方从钉钉工作台进入一次。"
            : "暂无可分配成员，请先让组织成员从钉钉工作台进入一次应用。"}
        </p>
      )}
      <div className="task-list roomy">
        {tasks.length ? tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            members={members}
            canAssign={canAssign}
            action={action}
            assign={assign}
            acting={acting}
          />
        )) : <Empty text="当前筛选下没有任务" />}
      </div>
    </section>
  );
}

function Changes({ data, canManage, onCreate }: { data: DashboardData; canManage: boolean; onCreate: () => void }) {
  return (
    <section className="change-layout">
      <div className="panel page-panel">
        <div className="page-head">
          <div><span className="section-tag">版本不可覆盖</span><h2>客户变更</h2><p>变更独立留痕，旧版本永久保留。</p></div>
          {canManage && <button className="primary" onClick={onCreate}>＋ 提交变更</button>}
        </div>
        <div className="change-list">
          {data.changes.map((change) => (
            <article key={change.id}>
              <div className="timeline-dot" />
              <div className="change-body">
                <div><strong>{change.style_no} · {change.color}</strong><span className={`status ${statusClass(change.status)}`}>{change.status}</span></div>
                <p>{change.content}</p>
                <small>{change.order_no} · {change.reason} · {change.applicant} · V{change.from_version} → V{change.to_version}</small>
              </div>
            </article>
          ))}
        </div>
      </div>
      <aside className="panel audit-panel">
        <div className="panel-title"><div><span className="section-tag">不可篡改</span><h3>最近审计</h3></div></div>
        <div className="audit-list">
          {data.audits.map((audit) => (
            <div key={audit.id}><i /><p><strong>{audit.actor}</strong> {audit.action}<span>{audit.entity_type} · {audit.before_value ? `${audit.before_value} → ` : ""}{audit.after_value}</span></p></div>
          ))}
        </div>
        <div className="notification-box">
          <strong>{data.notifications.filter((item) => item.status !== "已处理").length} 条待处理通知</strong>
          <span>钉钉发送失败时仍保留系统内待办</span>
        </div>
      </aside>
    </section>
  );
}

function OrderModal({ viewerName, close, done }: { viewerName: string; close: () => void; done: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError("");
    const body = Object.fromEntries(new FormData(event.currentTarget));
    const response = await apiFetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, quantity: Number(body.quantity) }) });
    const result = await response.json() as { error?: string; orderNo?: string };
    if (!response.ok) { setError(result.error || "创建失败"); setSaving(false); return; }
    done(`${result.orderNo} 已创建并生成固定工序任务`);
  }
  return (
    <Modal title="新建样品单" subtitle="MVP 将完成审单校验并直接按固定模板排单" close={close}>
      <form className="form-grid" onSubmit={submit}>
        <label><span>客户名称 *</span><input name="customer" required placeholder="例如：Morrow Studio" /></label>
        <label><span>创建人</span><input value={viewerName} readOnly /></label>
        <label><span>要求完成日期 *</span><input name="dueDate" type="date" required defaultValue="2026-08-05" /></label>
        <label><span>优先级</span><select name="priority"><option>普通</option><option>紧急</option></select></label>
        <div className="form-divider"><span>款式信息</span></div>
        <label><span>款号 *</span><input name="styleNo" required placeholder="例如：SL-086" /></label>
        <label><span>颜色 *</span><input name="color" required placeholder="例如：象牙白" /></label>
        <label><span>尺码</span><input name="size" placeholder="例如：39" /></label>
        <label><span>数量</span><input name="quantity" type="number" min="1" defaultValue="1" /></label>
        <label className="upload-placeholder full"><span>主效果图 *</span><div><b>效果图将在创建后绑定到款式 V1</b><small>可在款式详情上传 JPG、PNG 或 PDF</small></div></label>
        {error && <p className="form-error full">{error}</p>}
        <div className="modal-actions full"><button type="button" className="secondary" onClick={close}>取消</button><button className="primary" disabled={saving}>{saving ? "创建中…" : "创建并排单"}</button></div>
      </form>
    </Modal>
  );
}

function ChangeModal({ viewerName, styles, close, done }: { viewerName: string; styles: Style[]; close: () => void; done: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError("");
    const body = Object.fromEntries(new FormData(event.currentTarget));
    const response = await apiFetch("/api/changes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, styleId: Number(body.styleId) }),
    });
    const result = await response.json() as { error?: string; version?: number };
    if (!response.ok) { setError(result.error || "提交失败"); setSaving(false); return; }
    done(`客户变更已提交，款式升级至 V${result.version}`);
  }
  return (
    <Modal title="提交客户变更" subtitle="旧版本不会被覆盖，主管将收到系统内待处理通知" close={close}>
      <form className="form-grid one" onSubmit={submit}>
        <label><span>变更款式 *</span><select name="styleId" required>{styles.map((style) => <option key={style.id} value={style.id}>{style.style_no} · {style.color} · V{style.version}</option>)}</select></label>
        <label><span>变更原因</span><select name="reason"><option>客户要求</option><option>内部纠错</option><option>材料替代</option><option>其他</option></select></label>
        <label><span>变更内容 *</span><textarea name="content" required rows={5} placeholder="请清楚描述原要求与新要求…" /></label>
        <label><span>申请人</span><input value={viewerName} readOnly /></label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={close}>取消</button><button className="primary" disabled={saving}>{saving ? "提交中…" : "提交变更"}</button></div>
      </form>
    </Modal>
  );
}

function StyleDrawer({ style, tasks, attachments, close, uploaded }: {
  style: Style; tasks: Task[]; attachments: Attachment[]; close: () => void; uploaded: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file); form.append("styleId", String(style.id)); form.append("version", String(style.version));
    const response = await apiFetch("/api/attachments", { method: "POST", body: form });
    setUploading(false);
    if (response.ok) await uploaded();
  }
  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <aside className="drawer">
        <button className="close" onClick={close}>×</button>
        <div className={`drawer-image ${style.main_image}`}><span>{style.style_no}</span><small>主效果图 · V{style.version}</small></div>
        <div className="drawer-head"><div><span className="section-tag">款式详情</span><h2>{style.style_no} · {style.color}</h2></div><i className={`status ${statusClass(style.status)}`}>{style.status}</i></div>
        <div className="kv-grid"><span>尺码<strong>{style.size || "通码"}</strong></span><span>数量<strong>{style.quantity} 双</strong></span><span>版本<strong>V{style.version}</strong></span><span>当前工序<strong>{style.current_process}</strong></span></div>
        <h3 className="drawer-title">工序时间线</h3>
        <div className="process-flow">
          {tasks.map((task) => <div key={task.id} className={task.status === "已完成" ? "complete" : task.status === "进行中" ? "current" : task.status === "异常" ? "error" : ""}><i>{task.status === "已完成" ? "✓" : processNames.indexOf(task.process) + 1}</i><p><strong>{task.process}</strong><span>{task.assignee} · {task.status}</span></p></div>)}
        </div>
        <div className="attachment-head"><h3>版本附件</h3><label className="upload-button">{uploading ? "上传中…" : "＋ 上传附件"}<input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={upload} disabled={uploading} /></label></div>
        <div className="attachment-list">
          {attachments.length ? attachments.map((item) => <div key={item.id}><i>文</i><p><strong>{item.file_name}</strong><span>绑定 V{item.version} · {dateLabel(item.created_at)}</span></p></div>) : <Empty text="当前版本暂无附件" />}
        </div>
      </aside>
    </div>
  );
}

function Modal({ title, subtitle, close, children }: { title: string; subtitle: string; close: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="modal"><button className="close" onClick={close}>×</button><header><h2>{title}</h2><p>{subtitle}</p></header>{children}</section></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty"><i>○</i><span>{text}</span></div>;
}
