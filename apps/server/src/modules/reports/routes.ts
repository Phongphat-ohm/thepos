import { reportQuery } from "@thepos/contracts";
import type { Hono } from "hono";
import { validate, type RouteContext } from "../../core/http";
import { reportPermissions, type createReports } from "./service";

export function registerReportRoutes(
  app: Hono,
  deps: { ctx: RouteContext; reports: ReturnType<typeof createReports> },
) {
  const { ctx, reports } = deps;

  app.get("/dashboard", async (c) => c.json(await reports.dashboard(await ctx.profile(c.req))));

  app.get("/reports", async (c) => {
    const query = validate(c.req.query(), reportQuery);
    const { storeId } = await ctx.authorize(c.req, reportPermissions[query.kind]);
    return c.json(await reports.report(storeId, query));
  });
}
