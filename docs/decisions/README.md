# Decision records

Short, numbered records of decisions that shape the project: architecture,
published vocabulary, the adapter contract, governance. Each one records what
was decided, why, and what was rejected, so a new maintainer from another
organization can see how the project got here without asking the people who
were in the room.

[`GOVERNANCE.md`](../../GOVERNANCE.md) says which decisions *must* be recorded
here. Anything else that someone would otherwise have to rediscover is welcome
too.

## How to write one

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-short-title.md` using
   the next free number.
2. Open a PR. Discussion happens on the PR. Merging the PR records the
   decision.
3. Records are never deleted. A reversed decision gets a new record that
   *supersedes* the old one, and the old one's status is updated to point at
   it.

## Relationship to `docs/solutions/`

`docs/solutions/` holds **lessons**: what burned someone and the convention
that prevents it. This directory holds **decisions**: choices among options. A
decision record may cite a solution as its motivation.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-adopt-open-governance.md) | Adopt open governance in preparation for foundation incubation | Proposed |
