import {
  accountingPeriodInput,
  approveDividendInput,
  catalogQuery,
  dividendRuleInput,
  payoutInput,
  payoutObligationQuery,
  periodListQuery,
  purchaseAdjustmentInput,
} from "@thepos/contracts";
import type { Hono } from "hono";
import { body, uuid, validate, type RouteContext } from "../../core/http";
import type { createPayouts } from "./payouts.service";
import type { createDividends } from "./service";

export function registerDividendRoutes(
  app: Hono,
  deps: {
    ctx: RouteContext;
    dividends: ReturnType<typeof createDividends>;
    payouts: ReturnType<typeof createPayouts>;
  },
) {
  const { ctx, dividends, payouts } = deps;

  app.get("/dividends/rules", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "dividend:read");
    return c.json(await dividends.rules(storeId, validate(c.req.query(), catalogQuery)));
  });

  app.post("/dividends/rules", async (c) => {
    const actor = await ctx.authorize(c.req, "dividend:write");
    return c.json(await dividends.saveRule(actor, await body(c.req, dividendRuleInput)), 201);
  });

  app.get("/dividends/periods", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "dividend:read");
    return c.json(await dividends.periods(storeId, validate(c.req.query(), periodListQuery)));
  });

  app.post("/dividends/periods", async (c) => {
    const actor = await ctx.authorize(c.req, "dividend:write");
    return c.json(await dividends.savePeriod(actor, await body(c.req, accountingPeriodInput)), 201);
  });

  app.put("/dividends/periods/:id", async (c) => {
    const actor = await ctx.authorize(c.req, "dividend:write");
    return c.json(
      await dividends.savePeriod(
        actor,
        await body(c.req, accountingPeriodInput),
        validate(c.req.param("id"), uuid).toLowerCase(),
      ),
    );
  });

  app.post("/dividends/periods/:id/preview", async (c) => {
    const actor = await ctx.authorize(c.req, "dividend:write");
    return c.json(await dividends.calculate(actor, validate(c.req.param("id"), uuid).toLowerCase()));
  });

  app.get("/dividends/periods/:id/preview", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "dividend:read");
    return c.json(await dividends.preview(storeId, validate(c.req.param("id"), uuid), validate(c.req.query(), catalogQuery)));
  });

  app.post("/dividends/periods/:id/approve", async (c) => {
    const actor = await ctx.authorize(c.req, "dividend:approve");
    const { runId } = await body(c.req, approveDividendInput);
    return c.json(await dividends.approve(actor, validate(c.req.param("id"), uuid).toLowerCase(), runId.toLowerCase()));
  });

  app.post("/dividends/periods/:id/adjustments", async (c) => {
    const actor = await ctx.authorize(c.req, "dividend:approve");
    const key = validate(c.req.header("idempotency-key"), uuid).toLowerCase();
    return c.json(
      await dividends.adjustPurchases(
        actor,
        validate(c.req.param("id"), uuid).toLowerCase(),
        key,
        await body(c.req, purchaseAdjustmentInput),
      ),
      201,
    );
  });

  app.post("/dividends/periods/:id/close", async (c) => {
    const actor = await ctx.authorize(c.req, "dividend:approve");
    return c.json(await dividends.close(actor, validate(c.req.param("id"), uuid).toLowerCase()));
  });

  app.get("/dividends/periods/:id/obligations", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "dividend:read");
    return c.json(
      await payouts.obligations(storeId, validate(c.req.param("id"), uuid), validate(c.req.query(), payoutObligationQuery)),
    );
  });

  app.get("/dividends/obligations/:id/payouts", async (c) => {
    const { storeId } = await ctx.authorize(c.req, "dividend:read");
    return c.json(await payouts.history(storeId, validate(c.req.param("id"), uuid), validate(c.req.query(), catalogQuery)));
  });

  app.post("/dividends/obligations/:id/payouts", async (c) => {
    const actor = await ctx.authorize(c.req, "payout:write");
    const id = validate(c.req.param("id"), uuid).toLowerCase();
    const key = validate(c.req.header("idempotency-key"), uuid).toLowerCase();
    const result = await payouts.record(actor, id, key, await body(c.req, payoutInput));
    return c.json(result.payout, result.replayed ? 200 : 201);
  });
}
