import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { newId } from "@rel/core";
import { apiKeys, auditLogs, secrets, type Db } from "@rel/database";

export type Role = "admin" | "engineer" | "viewer";
export interface Principal {
  projectId: string;
  role: Role;
  actor: string;
}

const ROLE_RANK: Record<Role, number> = { viewer: 1, engineer: 2, admin: 3 };
export const can = (p: Principal, needed: Role) => ROLE_RANK[p.role] >= ROLE_RANK[needed];

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** Create an API key. The plaintext is returned once and never stored. */
export async function createApiKey(db: Db, projectId: string, name: string, role: Role) {
  const key = `rel_${randomBytes(24).toString("base64url")}`;
  await db.insert(apiKeys).values({ id: newId("key"), projectId, name, role, prefix: key.slice(0, 10), hash: hashKey(key) });
  return key;
}

export async function authenticate(db: Db, key: string | undefined): Promise<Principal | null> {
  if (!key) return null;
  const h = hashKey(key);
  const row = (await db.select().from(apiKeys).where(and(eq(apiKeys.hash, h), isNull(apiKeys.revokedAt))).limit(1))[0];
  if (!row || !timingSafeEqual(Buffer.from(row.hash), Buffer.from(h))) return null;
  await db.update(apiKeys).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiKeys.id, row.id));
  return { projectId: row.projectId, role: row.role, actor: `key:${row.prefix}` };
}

export async function audit(db: Db, p: Pick<Principal, "projectId" | "actor">, action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown> = {}) {
  await db.insert(auditLogs).values({ id: newId("aud"), projectId: p.projectId, actor: p.actor, action, targetType, targetId, metadata });
}

// ───────────────────────────── secrets (AES-256-GCM) ─────────────────────────────

let warned = false;
function masterKey(): Buffer {
  const raw = process.env.RELIABILITY_SECRET_KEY;
  if (!raw) {
    if (!warned && process.env.NODE_ENV === "production") throw new Error("RELIABILITY_SECRET_KEY must be set in production");
    warned = true;
    return scryptSync("reliability-os-dev-only", "reliability-os", 32);
  }
  return scryptSync(raw, "reliability-os", 32);
}

export async function putSecret(db: Db, projectId: string, name: string, value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const row = { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
  const existing = (await db.select().from(secrets).where(and(eq(secrets.projectId, projectId), eq(secrets.name, name))))[0];
  if (existing) await db.update(secrets).set(row).where(eq(secrets.id, existing.id));
  else await db.insert(secrets).values({ id: newId("sec"), projectId, name, ...row });
}

export async function getSecret(db: Db, projectId: string, name: string): Promise<string | null> {
  const row = (await db.select().from(secrets).where(and(eq(secrets.projectId, projectId), eq(secrets.name, name))))[0];
  if (!row) return null;
  const d = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(row.iv, "base64"));
  d.setAuthTag(Buffer.from(row.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(row.ciphertext, "base64")), d.final()]).toString("utf8");
}

/** Names only — secret values are never returned by any listing. */
export async function listSecretNames(db: Db, projectId: string) {
  return (await db.select({ name: secrets.name, createdAt: secrets.createdAt }).from(secrets).where(eq(secrets.projectId, projectId))).map((r) => r);
}
