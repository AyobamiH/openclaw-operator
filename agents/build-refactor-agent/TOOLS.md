# TOOLS - Build & Refactor Agent Development

## Local Development Setup

### Requirements
- Node.js 22.x
- TypeScript 5.5+
- OpenAI/Codex runtime auth (for openai/gpt-5.5 model)
- Git (for diff generation)

### Installation

```bash
cd agents/build-refactor-agent
npm install
```

### Environment

Create `.env.local`:
```
AGENT_ID=build-refactor-agent
CODEBASE_PATH=../../src
LOG_LEVEL=debug
```

## Permissions Verification

```bash
# Test workspacePatch skill access
npm run test:permissions

# Expected:
# ✓ Can call workspacePatch skill
# ✓ Can call testRunner skill  
# ✗ Cannot call sourceFetch (should be denied)
```

## Running Locally

```bash
# Test refactoring on sample code
npm run test:local

# Start in development mode
npm run dev

# Test specific refactoring type
npm run test -- --grep "deduplication"
```

## Test Suite

```bash
# All tests
npm run test

# Unit tests (mocking skills)
npm run test:unit

# Integration tests (real workspacePatch calls)
npm run test:integration

# E2E tests (full refactoring pipeline)
npm run test:e2e
```

## Debugging

### Enable Debug Logging

```bash
DEBUG=refactor:* npm run test:local
```

### Common Issues

**Issue: "workspacePatch skill not found"**
- Check: Is orchestrator/skills/workspacePatch.ts created?
- Fix: Run `npm run orchestrator:init`

**Issue: "Tests fail after refactoring"**
- Check: Did the refactoring change behavior?
- Debug: Use `npm run test:debug` to see full diff
- Verify: Original tests still pass before refactoring

**Issue: "Diff too large to review"**
- Check: Are we changing too many files at once?
- Limit: Set `maxFilesPerTask: 5` in agent.config.json
- Split: Break into smaller refactors

## Cost Analysis

### Per-Task Costs

| Task | Input Tokens | Output Tokens | Cost |
|------|--------------|---------------|------|
| Security scan (100 files) | 5,000 | 1,500 | ~$0.18 |
| Single-file refactor | 2,000 | 600 | ~$0.08 |
| Performance optimization | 3,000 | 900 | ~$0.11 |
| Deduplication analysis | 4,000 | 1,200 | ~$0.16 |

**Monthly estimate (50 tasks/month):** ~$25

## Credentials (Dev Only)

Do not commit credentials. Local runtime credentials are managed by OpenClaw/Codex auth; if a local credentials file is used for development, keep it untracked:

```json
{
  "codex": {
    "runtimeAuth": "managed by OpenClaw/Codex provider",
    "model": "openai/gpt-5.5",
    "maxTokens": 4096
  }
}
```

## Monitoring Checklist

Before production deployment:

- [ ] All permissions verified (`npm run test:permissions`)
- [ ] All tests passing (`npm run test`)
- [ ] Dry-run capability tested (show diffs before apply)
- [ ] Test suite runs successfully after refactoring
- [ ] No timeout issues on large codebases (<300 sec total)
- [ ] Security scan finds known vulnerabilities (test corpus)
- [ ] Deduplication ratio calculated correctly
- [ ] Heartbeat checks pass (disk, skill access, test runner)

## References

- [workspacePatch skill](../../orchestrator/skills/workspacePatch.ts)
- [testRunner skill](../../orchestrator/skills/testRunner.ts)
- [Agent config schema](../../docs/agent-config-schema.json)
