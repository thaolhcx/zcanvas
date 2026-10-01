import type { Asset, Recipe } from "../../contracts/index.ts";
import { db } from "./db.ts";
import { config } from "./config.ts";
import { personalSpaceId } from "./access.ts";
export interface MigrationReport {
  canvasesAssigned: number;
  runsAssigned: number;
  assetsMigrated: number;
  assetsAssigned: number;
  /** Records left without an owner. They stay invisible until assigned explicitly. */
  unmapped: { recordType: string; recordId: string; reason: string }[];
}
const legacyProfile = () =>
  config.storage.profiles.find((p) => p.driver === "s3")?.id ?? "s3";
/** Asset IDs referenced by `asset` params in a recipe. */
export function referencedAssetIds(recipe: Recipe | null | undefined) {
  const ids = new Set<string>();
  for (const node of recipe?.nodes ?? [])
    for (const value of Object.values(node.params ?? {}))
      if (typeof value === "string" && value.startsWith("ast_")) ids.add(value);
  return ids;
}
const extension = (mime: string) =>
  ({
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mpeg": "mp3",
  })[mime] ??
  mime.split("/")[1]?.replace(/[^a-z0-9]/g, "") ??
  "bin";
/**
 * Moves POC records into the catalog. Safe to rerun: each step only touches
 * rows that have not been migrated yet.
 *
 * - Canvases without a space belong to the single local workspace, so they
 *   move to the configured actor's personal space.
 * - Runs take the space of their canvas.
 * - Generated assets take the space of the run that made them.
 * - Uploaded assets take the space of the canvases that reference them, but
 *   only when exactly one space references them. Others are reported.
 */
export async function migrateLegacyCatalog(): Promise<MigrationReport> {
  const report: MigrationReport = {
    canvasesAssigned: 0,
    runsAssigned: 0,
    assetsMigrated: 0,
    assetsAssigned: 0,
    unmapped: [],
  };
  const defaultSpace = personalSpaceId(config.actorId);
  report.canvasesAssigned =
    (
      await db.query("UPDATE canvases SET space_id=$1 WHERE space_id IS NULL", [
        defaultSpace,
      ])
    ).rowCount ?? 0;
  report.runsAssigned =
    (
      await db.query(
        "UPDATE runs r SET space_id=c.space_id FROM canvases c WHERE r.space_id IS NULL AND c.id=r.canvas_id AND c.space_id IS NOT NULL",
      )
    ).rowCount ?? 0;
  const legacy = await db.query(
    "SELECT id, data FROM assets WHERE catalog_version=0 AND data IS NOT NULL ORDER BY id",
  );
  if (legacy.rowCount) {
    const owners = new Map<string, Set<string>>();
    const canvases = await db.query(
      "SELECT id, space_id, snapshot FROM canvases WHERE space_id IS NOT NULL",
    );
    for (const canvas of canvases.rows)
      for (const id of referencedAssetIds(canvas.snapshot)) {
        if (!owners.has(id)) owners.set(id, new Set());
        owners.get(id)!.add(canvas.space_id);
      }
    for (const row of legacy.rows) {
      const data = row.data as Asset;
      let spaceId: string | null = null,
        canvasId: string | null = null,
        reason = "";
      if (data.createdBy?.runId) {
        const run = await db.query(
          "SELECT canvas_id, space_id FROM runs WHERE id=$1",
          [data.createdBy.runId],
        );
        spaceId = run.rows[0]?.space_id ?? null;
        canvasId = run.rows[0]?.canvas_id ?? null;
        if (!spaceId) reason = "Generating run or its canvas no longer exists";
      } else {
        const spaces = [...(owners.get(row.id) ?? [])];
        if (spaces.length === 1) spaceId = spaces[0];
        else
          reason = spaces.length
            ? "Referenced by canvases in more than one space"
            : "Upload is not referenced by any canvas";
      }
      const createdAt = data.createdAt ?? new Date().toISOString();
      const name =
        typeof data.meta?.name === "string" && data.meta.name.trim()
          ? `${data.meta.name.trim()}.${extension(data.mime)}`
          : `${row.id}.${extension(data.mime)}`;
      const updated = await db.query(
        `UPDATE assets SET catalog_version=1, space_id=$2, source_type=$3, source_canvas_id=$4, source_run_id=$5, source_node_id=$6,
           name=$7, kind=$8, mime=$9, bytes=$10, meta=$11, status='ready', preview_status=$12, created_at=$13, updated_at=$13
         WHERE id=$1 AND catalog_version=0`,
        [
          row.id,
          spaceId,
          data.createdBy ? "generated" : "upload",
          canvasId,
          data.createdBy?.runId ?? null,
          data.createdBy?.nodeId ?? null,
          name,
          data.kind,
          data.mime,
          data.bytes,
          data.meta ?? {},
          data.thumbUrl ? "ready" : "none",
          createdAt,
        ],
      );
      if (!updated.rowCount) continue;
      // Legacy objects stay where they are: key = asset ID in the S3 profile.
      await db.query(
        `INSERT INTO asset_objects(asset_id,role,profile,key,bytes,mime,state) VALUES($1,'original',$2,$3,$4,$5,'stored') ON CONFLICT DO NOTHING`,
        [row.id, legacyProfile(), row.id.toLowerCase(), data.bytes, data.mime],
      );
      if (data.thumbUrl)
        await db.query(
          `INSERT INTO asset_objects(asset_id,role,profile,key,mime,state) VALUES($1,'thumbnail',$2,$3,'image/jpeg','stored') ON CONFLICT DO NOTHING`,
          [row.id, legacyProfile(), `${row.id}_thumb`.toLowerCase()],
        );
      report.assetsMigrated++;
      if (spaceId) report.assetsAssigned++;
      else
        await db.query(
          `INSERT INTO catalog_migration_issues(record_type,record_id,reason) VALUES('asset',$1,$2)
           ON CONFLICT (record_type,record_id) DO UPDATE SET reason=EXCLUDED.reason`,
          [row.id, reason],
        );
    }
  }
  const runs = await db.query(
    "SELECT id FROM runs WHERE space_id IS NULL ORDER BY id",
  );
  for (const run of runs.rows)
    await db.query(
      `INSERT INTO catalog_migration_issues(record_type,record_id,reason) VALUES('run',$1,'Canvas of this run no longer exists') ON CONFLICT DO NOTHING`,
      [run.id],
    );
  const issues = await db.query(
    `SELECT i.record_type, i.record_id, i.reason FROM catalog_migration_issues i
     WHERE (i.record_type='asset' AND EXISTS(SELECT 1 FROM assets a WHERE a.id=i.record_id AND a.space_id IS NULL))
        OR (i.record_type='run' AND EXISTS(SELECT 1 FROM runs r WHERE r.id=i.record_id AND r.space_id IS NULL))
     ORDER BY i.record_type, i.record_id`,
  );
  report.unmapped = issues.rows.map((r) => ({
    recordType: r.record_type,
    recordId: r.record_id,
    reason: r.reason,
  }));
  return report;
}
/** Explicit, operator-chosen assignment for reported assets. */
export async function assignUnmappedAssets(spaceId: string, ids?: string[]) {
  const { rowCount } = await db.query(
    `UPDATE assets SET space_id=$1, updated_at=now() WHERE space_id IS NULL AND catalog_version=1
       AND id IN (SELECT record_id FROM catalog_migration_issues WHERE record_type='asset')
       AND ($2::text[] IS NULL OR id = ANY($2))`,
    [spaceId, ids ?? null],
  );
  return rowCount ?? 0;
}
