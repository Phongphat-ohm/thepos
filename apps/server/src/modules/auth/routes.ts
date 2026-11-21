import { changePasswordSchema, loginSchema, unlockSchema } from "@thepos/contracts";
import type { Hono } from "hono";
import { body, type RouteContext } from "../../core/http";
import type { createAuth } from "./service";

export function registerAuthRoutes(
  app: Hono,
  deps: { ctx: RouteContext; auth: ReturnType<typeof createAuth> },
) {
  const { ctx, auth } = deps;

  app.post("/auth/login", async (c) => {
    ctx.limitCredentials(c.req);
    return c.json(await auth.login(await ctx.device(c.req), await body(c.req, loginSchema)));
  });

  app.post("/auth/web-login", async (c) => {
    ctx.limitCredentials(c.req);
    const cookieMode = c.req.header("x-web-auth") === "cookie";
    if (cookieMode) ctx.assertCookieSameOrigin(c);
    const session = await auth.webLogin(await body(c.req, loginSchema), ctx.rawDevice(c.req));
    if (cookieMode) {
      ctx.setWebRefreshCookie(c, session.refreshToken);
      const { refreshToken: _refreshToken, ...safeSession } = session;
      return c.json({ ...safeSession, cookieAuth: true });
    }
    return c.json(session);
  });

  app.post("/auth/refresh", async (c) => {
    ctx.limitCredentials(c.req);
    const { token, fromCookie } = ctx.refresh(c);
    if (fromCookie) ctx.assertCookieSameOrigin(c);
    const session = await auth.refresh(await ctx.device(c.req), token);
    if (fromCookie || c.req.header("x-web-auth") === "cookie") {
      ctx.setWebRefreshCookie(c, session.refreshToken);
      const { refreshToken: _refreshToken, ...safeSession } = session;
      return c.json({ ...safeSession, cookieAuth: true });
    }
    return c.json(session);
  });

  app.post("/auth/lock", async (c) => {
    ctx.limitCredentials(c.req);
    const { token, fromCookie } = ctx.refresh(c);
    if (fromCookie) ctx.assertCookieSameOrigin(c);
    return c.json(await auth.lock(await ctx.device(c.req), token));
  });

  app.post("/auth/unlock", async (c) => {
    ctx.limitCredentials(c.req);
    const { token, fromCookie } = ctx.refresh(c);
    if (fromCookie) ctx.assertCookieSameOrigin(c);
    const { pin } = await body(c.req, unlockSchema);
    const session = await auth.unlock(await ctx.device(c.req), token, pin);
    if (fromCookie || c.req.header("x-web-auth") === "cookie") {
      ctx.setWebRefreshCookie(c, session.refreshToken);
      const { refreshToken: _refreshToken, ...safeSession } = session;
      return c.json({ ...safeSession, cookieAuth: true });
    }
    return c.json(session);
  });

  app.post("/auth/logout", async (c) => {
    const { token, fromCookie } = ctx.refresh(c);
    if (fromCookie) ctx.assertCookieSameOrigin(c);
    await auth.logout(await ctx.device(c.req), token);
    ctx.clearWebRefreshCookie(c);
    return c.body(null, 204);
  });

  app.post("/auth/change-password", async (c) => {
    ctx.limitCredentials(c.req);
    await auth.changePassword(ctx.access(c.req), await ctx.device(c.req), await body(c.req, changePasswordSchema));
    return c.body(null, 204);
  });

  app.get("/auth/me", async (c) => c.json(await auth.me(ctx.access(c.req), await ctx.device(c.req))));
}
