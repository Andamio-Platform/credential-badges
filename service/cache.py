#!/usr/bin/env python3
"""Badge SVG cache. The render service writes a rendered badge here on a cache
miss so repeat requests are served without a re-render or a gateway call (KTD-1).

Two implementations behind one tiny interface (get/put):
  - MemoryCache: process-local dict, for tests and local dev.
  - GCSCache:    a Google Cloud Storage bucket, for the deployed service.

KTD-3b invariant lives in the caller (app.serve_badge), not here: only a
successful (200) render is ever put() — a failed read must never be cached.
"""


class MemoryCache:
    """In-process cache. Not shared across workers — dev/test only."""

    def __init__(self):
        self._d = {}

    def get(self, key):
        return self._d.get(key)

    def put(self, key, body):
        self._d[key] = body

    def delete(self, key):
        """Remove a cache object. Idempotent — returns True if it existed."""
        return self._d.pop(key, None) is not None

    def list_keys(self):
        return list(self._d.keys())


class GCSCache:
    """GCS-backed cache keyed by object name ("{course_id}.{slt_hash}.svg").

    Pass `bucket` (a google.cloud.storage Bucket, or a compatible fake) for tests;
    otherwise `bucket_name` lazily constructs a real client so importing this
    module never requires google-cloud-storage to be installed."""

    def __init__(self, bucket_name=None, *, bucket=None):
        if bucket is not None:
            self._bucket = bucket
        else:
            from google.cloud import storage  # lazy: only the deployed service needs it
            self._bucket = storage.Client().bucket(bucket_name)

    def get(self, key):
        blob = self._bucket.blob(key)
        if not blob.exists():
            return None
        return blob.download_as_bytes()

    def put(self, key, body):
        blob = self._bucket.blob(key)
        # Mirror the static host's badge caching: cached but NOT immutable, since
        # badge art is mutable presentation (an issuer may refresh it).
        blob.cache_control = "public, max-age=86400"
        blob.upload_from_string(body, content_type="image/svg+xml")

    def delete(self, key):
        """Remove a cache object (U6 cache-admin invalidate/reconcile). Idempotent:
        a missing object is not an error — the badge simply re-renders on the next
        request, so invalidation is always non-destructive. Returns True if the
        object existed."""
        blob = self._bucket.blob(key)
        if not blob.exists():
            return False
        blob.delete()
        return True

    def list_keys(self):
        """All object names in the cache bucket (U6 cache-admin reconcile)."""
        return [b.name for b in self._bucket.list_blobs()]
