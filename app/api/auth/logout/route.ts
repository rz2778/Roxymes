import {
  assertSameOrigin,
  clearSessionCookie,
  errorResponse,
  revokeSession,
} from "../../../../lib/auth";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await revokeSession(request);
    return Response.json(
      { ok: true },
      { headers: { "set-cookie": clearSessionCookie(request) } },
    );
  } catch (error) {
    return errorResponse(error, "退出失败");
  }
}
