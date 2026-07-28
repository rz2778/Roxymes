export const PROCESSES = ["备料", "开版", "切割", "加工", "针车", "成型"] as const;

export type TaskStatus =
  | "等待前置工序"
  | "待开始"
  | "进行中"
  | "暂停"
  | "异常"
  | "已完成"
  | "无需"
  | "取消";

export const ALLOWED_ACTIONS: Record<string, TaskStatus[]> = {
  start: ["待开始"],
  complete: ["进行中"],
  pause: ["进行中"],
  resume: ["暂停", "异常"],
  exception: ["待开始", "进行中", "暂停"],
};

export function nextStatus(action: string): TaskStatus {
  const map: Record<string, TaskStatus> = {
    start: "进行中",
    complete: "已完成",
    pause: "暂停",
    resume: "进行中",
    exception: "异常",
  };
  if (!map[action]) throw new Error("不支持的任务操作");
  return map[action];
}

export function canActivateCutting(tasks: Array<{ process: string; status: string }>) {
  return ["备料", "开版"].every(
    (name) => tasks.find((task) => task.process === name)?.status === "已完成",
  );
}
