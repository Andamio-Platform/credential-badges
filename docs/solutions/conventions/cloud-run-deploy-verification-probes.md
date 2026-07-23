---
title: Deploy verification probes the public LB route, never /healthz on run.app
date: 2026-07-23
category: conventions
module: deploy-workflows
problem_type: convention
component: development_workflow
severity: high
applies_when:
  - "Writing or editing a post-deploy verify step in any deploy workflow"
  - "Adding a new Cloud Run service or deploy lane"
  - "A deploy verify step fails while the service itself looks healthy"
tags: [cloud-run, deploy-verification, healthz, load-balancer, probes, ci]
---

# Deploy verification probes the public LB route, never /healthz on run.app

## Context

Three deploy lanes independently hit the same two failure modes before this was written down:

1. The issuer lane's verify step probed the `*.run.app` URL, which stopped working after the LB cutover sealed the service's ingress (#62/#63 moved the probe to the public hostname).
2. The render lane's verify step probed the literal path `/healthz` on its `*.run.app` URL. The `vrender-0.1.2` deploy failed against a **healthy, correctly deployed revision**: Google's frontend intercepts `/healthz` on run.app URLs and returns a generic HTML 404 — the request never reaches the container. Request logs proved it: `/health` and `/badges/*` arrived at the app; `/healthz` never did (fixed in #66).

The static lane's byte-verification probes were written against the public host from the start (#64), citing the issuer lesson.

## Guidance

Two rules for every external deploy-verification probe:

1. **Probe the public hostname (`credentials.andamio.io`), not `*.run.app`.** The LB route is the only path that proves what users and verifiers actually fetch — a run.app probe cannot see LB misroutes, and sealed ingress (`internal-and-cloud-load-balancing`) makes run.app unreachable to the runner entirely. A run.app check is acceptable only as a supplementary service-level reachability signal on a service with open ingress, never as the verification of served content.
2. **Never probe the literal path `/healthz` from outside.** Google's frontend swallows it on run.app URLs (HTML 404, `content-type: text/html`, no request log entry). Keep `/healthz` in the app for Cloud Run's *internal* probes — those bypass the frontend and work fine. External verification should exercise a real application path instead (a served file with a content-type or sha256 assertion, a rendered badge, a signed credential).

The strongest form, used by the static lane since #64: assert **sha256 of the served body** against the checked-out tag's bytes on the public host, so `served == checkout == pinned` in one chain.

## Why This Matters

Both failure modes produce the worst kind of CI signal. The run.app probe produces **false green** (verifying a URL nobody uses while the LB serves something else), and the `/healthz` probe produces **false red** (failing a healthy deploy), which trains people to distrust or re-run the gate. Each lane paid for this lesson separately — #62, #63, #66 — because the rule lived only in commit messages.

## When to Apply

- Any new `Verify` step in `.github/workflows/deploy*.yml`
- Diagnosing a deploy verify failure: if the response is an HTML 404 with no matching entry in the service's request logs, it never reached the container — check the probe path and host before touching the service
- Reviewing PRs that add health endpoints: `/healthz` is fine for internal probes, but do not build external checks on it

## Examples

The render-lane fix (#66) — before:

```yaml
code=$(curl -s -o /dev/null -w '%{http_code}' "${URL}/healthz")   # URL = *.run.app
test "${code}" = "200"                                            # GFE intercepts: always 404
```

After — verify a real application path (and the static lane's byte assertion, `deploy.yml`):

```yaml
ct=$(curl -sI "${URL}/badges/${NAME}.svg" | ... content-type ...)  # reaches the app
# static lane, public host:
served=$(curl -sf "https://${PUBLIC_HOST}/$f" -o served.jsonld && sha256sum served.jsonld ...)
test "$served" = "$expected"
```

## Related

- PRs #62, #63 (issuer lane), #64 (static sha256 probes), #66 (render lane)
- `.github/workflows/deploy.yml`, `deploy-issuer.yml`, `deploy-render.yml` — current probe implementations
- `DEPLOY.md` — deploy-lane overview (probe descriptions updated alongside this doc)
