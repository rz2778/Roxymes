export interface DingTalkMessage {
  recipient: string;
  title: string;
  body: string;
}

/**
 * 钉钉适配边界。MVP 先将消息可靠写入系统内通知；
 * 配置正式应用凭证后，可在这里替换为钉钉工作通知 API。
 */
export async function sendDingTalkMessage(message: DingTalkMessage) {
  return {
    channel: "系统内（钉钉待联调）",
    status: "待处理",
    ...message,
  };
}
