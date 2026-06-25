#!/usr/bin/env python3
"""U4 tests for the badge cache — stdlib only, GCS faked.

Runnable directly:
    python3 service/tests/test_cache.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SERVICE = os.path.dirname(HERE)
sys.path.insert(0, SERVICE)

from cache import MemoryCache, GCSCache  # noqa: E402


class FakeBlob:
    def __init__(self, store, key):
        self.store = store
        self.key = key
        self.cache_control = None
        self.content_type = None

    def exists(self):
        return self.key in self.store

    def download_as_bytes(self):
        return self.store[self.key]

    def upload_from_string(self, body, content_type=None):
        self.store[self.key] = body if isinstance(body, bytes) else body.encode()
        self.content_type = content_type


class FakeBucket:
    def __init__(self):
        self.store = {}
        self.blobs = {}

    def blob(self, key):
        b = self.blobs.get(key) or FakeBlob(self.store, key)
        self.blobs[key] = b
        return b


def test_memory_cache_roundtrip_and_miss():
    c = MemoryCache()
    assert c.get("k") is None
    c.put("k", b"<svg/>")
    assert c.get("k") == b"<svg/>"
    print("  ✅ MemoryCache get/put roundtrip + miss returns None")


def test_gcs_cache_put_sets_headers_and_get_reads_back():
    bucket = FakeBucket()
    c = GCSCache(bucket=bucket)
    assert c.get("a.b.svg") is None, "miss must return None"
    c.put("a.b.svg", b"<svg>hi</svg>")
    assert c.get("a.b.svg") == b"<svg>hi</svg>"
    blob = bucket.blob("a.b.svg")
    assert blob.content_type == "image/svg+xml", blob.content_type
    assert blob.cache_control == "public, max-age=86400", blob.cache_control
    print("  ✅ GCSCache put sets content-type + cache-control; get reads back; miss -> None")


def _main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        print(f"• {t.__name__}")
        try:
            t()
        except AssertionError as e:
            failed += 1
            print(f"  ❌ FAIL: {e}")
    print(f"\n{'❌' if failed else '✅'} {len(tests)-failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    _main()
