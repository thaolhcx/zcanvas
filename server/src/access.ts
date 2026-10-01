import type {
  ApiErrorCode,
  Space,
  SpaceRole,
  SpacesResponse,
} from "../../contracts/index.ts";
import { db } from "./db.ts";
/**
 * Access rules (docs/asset-platform.md):
 * - The server resolves the actor; clients never supply a user or permission.
 * - A member of a space may read its canvases, runs and assets.
 * - Owners and editors may also write: upload, rename, delete, create canvases, run.
 * - A record without a space (unmapped by migration) is visible to nobody.
 */
export type Actor = { id: string };
export type Access = "read" | "write";
export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
  body() {
    return {
      error: this.message,
      code: this.code,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}
export const notFound = (what = "Not found") =>
  new ApiProblem(404, "NOT_FOUND", what);
export const personalSpaceId = (userId: string) =>
  `spc_${userId.replace(/^usr_/, "")}`;
/** Creates the user and their personal space if missing. Idempotent. */
export async function ensureActor(userId: string, name = userId) {
  const spaceId = personalSpaceId(userId);
  await db.query(
    `INSERT INTO users(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING;`,
    [userId, name],
  );
  await db.query(
    `INSERT INTO spaces(id,kind,name) VALUES($1,'personal','Personal Space') ON CONFLICT DO NOTHING`,
    [spaceId],
  );
  await db.query(
    `INSERT INTO space_members(space_id,user_id,role) VALUES($1,$2,'owner') ON CONFLICT DO NOTHING`,
    [spaceId, userId],
  );
  return spaceId;
}
export async function roleIn(
  actor: Actor,
  spaceId: string | null | undefined,
): Promise<SpaceRole | undefined> {
  if (!spaceId) return undefined;
  const { rows } = await db.query(
    "SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2",
    [spaceId, actor.id],
  );
  return rows[0]?.role;
}
export const allows = (role: SpaceRole | undefined, access: Access) =>
  role !== undefined && (access === "read" || role !== "viewer");
/**
 * Throws 404 when the actor cannot see the space (so its existence does not
 * leak) and 403 when they can see it but may not write.
 */
export async function requireSpace(
  actor: Actor,
  spaceId: string | null | undefined,
  access: Access,
  what = "Not found",
) {
  const role = await roleIn(actor, spaceId);
  if (!role) throw notFound(what);
  if (!allows(role, access))
    throw new ApiProblem(403, "FORBIDDEN", "You can view but not change this space");
  return role;
}
export async function readableSpaceIds(actor: Actor): Promise<string[]> {
  const { rows } = await db.query(
    "SELECT space_id FROM space_members WHERE user_id=$1",
    [actor.id],
  );
  return rows.map((r) => r.space_id);
}
export async function canvasSpace(canvasId: string) {
  const { rows } = await db.query(
    "SELECT space_id FROM canvases WHERE id=$1",
    [canvasId],
  );
  return rows.length ? (rows[0].space_id as string | null) : undefined;
}
export async function requireCanvas(
  actor: Actor,
  canvasId: string,
  access: Access,
) {
  const spaceId = await canvasSpace(canvasId);
  await requireSpace(actor, spaceId, access, "Canvas not found");
  return spaceId!;
}
export async function listSpaces(actor: Actor): Promise<SpacesResponse> {
  const { rows } = await db.query(
    `SELECT s.id, s.kind, s.name, m.role,
       COALESCE((SELECT json_agg(json_build_object('id',p.id,'spaceId',p.space_id,'name',p.name) ORDER BY p.name, p.id) FROM projects p WHERE p.space_id=s.id), '[]') AS projects
     FROM space_members m JOIN spaces s ON s.id=m.space_id
     WHERE m.user_id=$1
     ORDER BY (s.kind='personal') DESC, lower(s.name), s.id`,
    [actor.id],
  );
  return {
    defaultSpaceId: personalSpaceId(actor.id),
    spaces: rows as Space[],
  };
}
