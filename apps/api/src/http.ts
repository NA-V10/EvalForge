import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError, type ZodType } from "zod";
import { audit, authenticate, can, type Platform, type Principal, type Role } from "@rel/platform";

export type Env = { Variables: { principal: Principal; platform: Platform } };

export function requireAuth(p: Platform): MiddlewareHandler<Env> {
  return async (c, next) => {
    const header = c.req.header("authorization");
    const key = c.req.header("x-api-key") ?? (header?.startsWith("Bearer ") ? header.slice(7) : undefined) ?? c.req.query("api_key");
    const principal = await authenticate(p.db, key);
    if (!principal) throw new HTTPException(401, { message: "missing or invalid API key" });
    // Read-only callers may only issue safe methods.
    const needed: Role = c.req.method === "GET" ? "viewer" : "engineer";
    if (!can(principal, needed)) throw new HTTPException(403, { message: `role ${principal.role} cannot ${c.req.method}` });
    c.set("principal", principal);
    c.set("platform", p);
    await next();
  };
}

export function requireRole(role: Role): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (!can(c.get("principal"), role)) throw new HTTPException(403, { message: `requires ${role}` });
    await next();
  };
}

export async function body<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "request body must be JSON" });
  }
  return schema.parse(raw);
}

export const project = (c: Context<Env>) => c.get("principal").projectId;

export async function audited(c: Context<Env>, action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown> = {}) {
  await audit(c.get("platform").db, c.get("principal"), action, targetType, targetId, metadata);
}

export function errorHandler(err: Error, c: Context) {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err instanceof ZodError) return c.json({ error: "validation failed", details: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
  const status = (err as { status?: number }).status;
  if (status === 400 || status === 404) return c.json({ error: err.message, details: (err as { details?: string[] }).details }, status);
  console.error(JSON.stringify({ level: "error", msg: "unhandled API error", error: err.message }));
  return c.json({ error: "internal error" }, 500);
}
