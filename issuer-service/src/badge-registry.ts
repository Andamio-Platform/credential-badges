// The in-repo badge registry (deployment plan R5: "Badge registry: in this
// repo. badge_id is the <course_id>.<slt_hash> URN itself").
//
// generator/credentials.json is the repo's source of truth for which badges
// exist and for their display titles (course_title / module_title) — the
// same registry the badge SVGs and the render service are generated from.
// The spike pinned its one subject's titles as constants; the service reads
// them from the registry, baked into the image at build time.
//
// A request for a (course_id, slt_hash) pair not in the registry is refused
// BEFORE any chain read: this service signs credentials for registered
// badges only.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Dockerfile bakes the repo's generator/credentials.json alongside the
// service at the same relative location as in the repo checkout.
const REGISTRY_FILE = path.join(HERE, "..", "..", "generator", "credentials.json");

export interface BadgeEntry {
  course_id: string;
  slt_hash: string;
  course_title: string;
  module_title: string;
}

let registry: Map<string, BadgeEntry> | null = null;

export function loadRegistry(file: string = REGISTRY_FILE): Map<string, BadgeEntry> {
  const entries: BadgeEntry[] = JSON.parse(readFileSync(file, "utf8"));
  const map = new Map<string, BadgeEntry>();
  for (const e of entries) {
    if (!e.course_id || !e.slt_hash || !e.course_title || !e.module_title) {
      throw new Error(
        `badge registry entry is missing a required field: ${JSON.stringify(e)}`,
      );
    }
    map.set(`${e.course_id}.${e.slt_hash}`, e);
  }
  return map;
}

export function lookupBadge(
  courseId: string,
  sltHash: string,
  file?: string,
): BadgeEntry | null {
  if (registry === null) registry = loadRegistry(file);
  return registry.get(`${courseId}.${sltHash}`) ?? null;
}

/** Test seam: reset the memoized registry. */
export function resetRegistryCache(): void {
  registry = null;
}
