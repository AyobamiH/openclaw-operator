---
title: "Repo Boundary"
summary: "What belongs in the public product repo versus the private working repo."
---

# Repo Boundary

Use this document to decide where work belongs now that the public product repo
exists alongside the private workspace.

## Canonical Homes

- public product repo: `https://github.com/AyobamiH/openclaw-operator`
- private working repo: this workspace

The public repo is the canonical home for open-source product work.

The private repo remains useful, but it is no longer the place where public
product changes should accumulate by default.

## Branch-First Workflow

Use branches in both repos.

- private repo: do active lab work on a local work branch, not directly on
  `master`
- public repo: do public product changes on a local feature branch, validate
  there, then merge into `main` locally before pushing

The rule is simple:

- branch locally first
- merge locally second
- push after the merge state is correct

## Put It In The Public Repo When

Use `openclaw-operator` for:

- product behavior meant for users or contributors
- operator UI, docs site, onboarding, and public examples
- agent, task, approval, API, and runtime changes that should ship publicly
- tests, docs, and release notes that belong to the public product
- cleanup that improves public cloning, self-hosting, or contribution

Rule of thumb:

- if someone opening a public issue or PR would expect the change to exist, it
  belongs in the public repo

## Keep It In The Private Repo When

Use the private workspace for:

- local notes and memory files
- machine-specific service definitions, paths, and operating habits
- rough experiments that are not ready for users
- personal helper workflows
- side-step practical use that may or may not later become product work
- staging ideas before they have a clean public shape

Rule of thumb:

- if the change is mainly about your own practical use, local setup, or
  incubation, keep it private until it proves itself

## Promotion Rule

When a private experiment becomes clearly useful for users:

1. restate the outcome in product terms
2. rebuild or port it into `openclaw-operator`
3. keep machine-specific or personal residue out of the public change set
4. document the public-facing behavior where contributors will find it

Do not treat the private repo as the long-term canonical source for public
features.

## Decision Checklist

Before you start a change, ask:

- Is this meant for users, contributors, or open-source adoption?
- Would I want to document this publicly?
- Does it rely on my machine, my memory files, or my personal workflow?
- Is it a product behavior or a private operating habit?

If the answer trends public, start in `openclaw-operator`.

If the answer trends personal or experimental, keep it here until it is ready.
