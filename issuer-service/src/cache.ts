// Signed-artifact cache. The SIGNED bytes are cached, keyed by
// (network, courseId, sltHash, recipient asset, signing key version) — a
// re-request for the same coordinate under the same key version must never
// re-call KMS. Re-derivation is byte-identical (validFrom / proof.created are
// pinned to the claim-tx block_time), so serving cached bytes is exactly
// serving a fresh re-sign, minus the KMS spend.
//
// Two levels behind one seam:
//   - MemoryArtifactStore (always on): per-instance in-memory map.
//   - An optional second-level ArtifactStore (the GCS-style seam) can be
//     injected for cross-instance / cross-restart persistence. No GCS client
//     ships in this build — the seam is the contract the ops-gated follow-up
//     implements (a GCS bucket in the deploy region, written with the runtime
//     SA). Keeping it an injected interface means adding it never touches the
//     signing path.

export interface ArtifactStore {
  get(key: string): Promise<string | null>;
  put(key: string, artifact: string): Promise<void>;
}

export class MemoryArtifactStore implements ArtifactStore {
  private readonly map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async put(key: string, artifact: string): Promise<void> {
    this.map.set(key, artifact);
  }
  get size(): number {
    return this.map.size;
  }
}

export function artifactCacheKey(opts: {
  network: string;
  courseId: string;
  sltHash: string;
  studentStateAsset: string;
  keyVersion: string;
}): string {
  return `${opts.network}/${opts.courseId}.${opts.sltHash}/${opts.studentStateAsset}@${opts.keyVersion}`;
}

/** Layered lookup: memory first, then the optional second level (a second-
 *  level hit is promoted into memory). */
export class LayeredArtifactCache {
  private readonly memory: MemoryArtifactStore;
  private readonly secondLevel: ArtifactStore | null;

  constructor(memory: MemoryArtifactStore, secondLevel: ArtifactStore | null = null) {
    this.memory = memory;
    this.secondLevel = secondLevel;
  }

  async get(key: string): Promise<string | null> {
    const hot = await this.memory.get(key);
    if (hot !== null) return hot;
    if (this.secondLevel) {
      const cold = await this.secondLevel.get(key);
      if (cold !== null) {
        await this.memory.put(key, cold);
        return cold;
      }
    }
    return null;
  }

  async put(key: string, artifact: string): Promise<void> {
    await this.memory.put(key, artifact);
    if (this.secondLevel) await this.secondLevel.put(key, artifact);
  }
}
