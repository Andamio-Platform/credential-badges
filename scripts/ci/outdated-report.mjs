// Renders the Markdown body of the weekly dependency report issue
// (outdated-report.yml): `npm outdated --json` for each package directory, plus
// the GitHub Actions the workflows use. Dependabot opens PRs for security
// updates only; every other update is listed here, to be picked up by hand.
//
// Usage: (cd <dir> && npm outdated --json) > outdated-<n>.json, per directory
//        node scripts/ci/outdated-report.mjs <dir>=outdated-<n>.json ... > report.md
// GH_TOKEN, when set, authenticates the GitHub API calls for the Actions part.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const major = (v) => Number(String(v).replace(/^v/, "").split(".")[0]);

// "wanted" is the newest version the package.json range allows, so reaching
// it is a lockfile-only change. Anything past it needs the range bumped.
export function classify({ current, wanted, latest }) {
  if (current !== wanted) return "in-range";
  if (major(latest) > major(current)) return "major";
  return "range-bump";
}

const SECTIONS = [
  ["in-range", "In range — `npm update`, lockfile only"],
  ["range-bump", "Minor / patch past the range — bump package.json"],
  ["major", "Major — needs its own migration"],
];

// Every `uses: owner/repo[/path]@ref` in the workflows, keyed by
// "owner/repo@ref" and holding the files using it. A ref pinned to a commit
// SHA carries its release in a trailing comment (`@<sha> # v7.0.1`), which is
// kept as the version. Local (./) and docker:// actions are skipped.
export function collectActions(workflows) {
  const used = new Map();
  for (const [file, text] of workflows) {
    for (const [, repo, ref, comment] of text.matchAll(
      /uses:\s*["']?([\w.-]+\/[\w.-]+)(?:\/[^@\s"']*)?@([^\s"'#]+)["']?(?:[ \t]*#[ \t]*(v?\d[\w.-]*))?/g,
    )) {
      const key = `${repo}@${ref}`;
      const sha = /^[0-9a-f]{40}$/.test(ref);
      const entry = used.get(key) ?? {
        version: comment ?? (sha ? undefined : ref),
        files: [],
      };
      if (!entry.files.includes(file)) entry.files.push(file);
      used.set(key, entry);
    }
  }
  return used;
}

const parts = (v) =>
  String(v)
    .replace(/^v/, "")
    .split(".")
    .map((n) => Number(n) || 0);

// -1, 0 or 1 as a is older than, equal to or newer than b, comparing only the
// components both have.
function compareVersions(a, b) {
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.min(pa.length, pb.length); i++)
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

// A SHA pin is compared at full precision, since it does not float. A major
// tag (v7) floats within its major, so only a newer major is an update. A ref
// with no version (a bare SHA or a branch) cannot be compared.
export function actionRows(used, latestTags) {
  return [...used]
    .map(([key, { version, files }]) => {
      const [repo, ref] = key.split("@");
      const latest = latestTags.get(repo);
      let status;
      if (!latest) status = "could not check";
      else if (!/^v?\d/.test(version ?? "")) status = "no version to compare";
      else if (major(latest) > major(version)) status = "major";
      else if (version !== ref && compareVersions(version, latest) < 0)
        status = "minor / patch";
      else return null;
      return {
        repo,
        ref: version ?? ref,
        latest: latest ?? "?",
        status,
        files,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

// One block per package directory: a `## npm: <dir>` heading, then the
// sections of that directory's updates.
function renderPackage({ dir, outdated, pkg }) {
  const dev = new Set(Object.keys(pkg.devDependencies ?? {}));
  const rows = Object.entries(outdated)
    .map(([name, info]) => ({ name, ...info, kind: classify(info) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const out = [`## npm: \`${dir}\``, ""];
  if (rows.length === 0) return [...out, "No updates.", ""];

  for (const [kind, title] of SECTIONS) {
    const section = rows.filter((r) => r.kind === kind);
    if (section.length === 0) continue;
    out.push(`### npm: ${title} (${section.length})`, "");
    out.push(
      "| Package | Type | Current | Wanted | Latest |",
      "|---|---|---|---|---|",
    );
    for (const r of section) {
      const type = dev.has(r.name) ? "dev" : "prod";
      out.push(
        `| \`${r.name}\` | ${type} | ${r.current ?? "missing"} | ${r.wanted} | ${r.latest} |`,
      );
    }
    out.push("");
  }
  return out;
}

// packages: [{ dir, outdated, pkg }], in the order they are listed.
export function render(packages, actions, date, repo) {
  const out = [
    `Weekly dependency report for \`main\`, last run ${date}. This issue is edited in place each week.`,
    "",
    "Security updates are not listed here: Dependabot opens a PR for each " +
      `alert ([alerts](https://github.com/${repo}/security/dependabot)).`,
    "",
  ];
  const none = packages.every((p) => Object.keys(p.outdated).length === 0);
  if (none && actions.length === 0)
    return [...out, "Everything is up to date."].join("\n");

  for (const p of packages) out.push(...renderPackage(p));

  if (actions.length > 0) {
    out.push("## GitHub Actions", "");
    out.push(`### GitHub Actions (${actions.length})`, "");
    out.push(
      "| Action | Used | Latest | Status | Workflows |",
      "|---|---|---|---|---|",
    );
    for (const a of actions) {
      const files = a.files.map((f) => `\`${f}\``).join(", ");
      out.push(
        `| \`${a.repo}\` | ${a.ref} | ${a.latest} | ${a.status} | ${files} |`,
      );
    }
    out.push("");
  }
  return out.join("\n");
}

async function latestRelease(repo) {
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GH_TOKEN)
    headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  const res = await fetch(
    `https://api.github.com/repos/${repo}/releases/latest`,
    {
      headers,
    },
  );
  if (!res.ok) return undefined;
  return (await res.json()).tag_name;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packages = process.argv.slice(2).map((arg) => {
    const [dir, file] = arg.split("=");
    const raw = readFileSync(file, "utf8").trim();
    return {
      dir,
      outdated: raw ? JSON.parse(raw) : {},
      pkg: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")),
    };
  });

  const dir = ".github/workflows";
  const workflows = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => [f, readFileSync(join(dir, f), "utf8")]);
  const used = collectActions(workflows);
  const repos = [...new Set([...used.keys()].map((k) => k.split("@")[0]))];
  const latestTags = new Map(
    await Promise.all(repos.map(async (r) => [r, await latestRelease(r)])),
  );

  process.stdout.write(
    render(
      packages,
      actionRows(used, latestTags),
      new Date().toISOString().slice(0, 10),
      process.env.GITHUB_REPOSITORY,
    ) + "\n",
  );
}
