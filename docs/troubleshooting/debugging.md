---
title: "Debugging Guide"
summary: "Diagnostic procedures and debugging techniques."
---

# Debugging Guide

When something isn't working, follow this guide to diagnose and fix it.

---

## Step 1: Is the System Running?

```bash
# Check process
ps aux | grep orchestrator | grep -v grep

# Check service (if using systemd)
sudo systemctl status orchestrator

# Check logs
tail -20 logs/orchestrator.log
```

If not running:
```bash
npm start 2>&1 | head -50
```

Look for startup errors.

---

## Step 2: Check the Effective State Target

```bash
# Check the configured persistence target
cat orchestrator_config.json | jq '.stateFile'

# Inspect effective runtime facts
curl -fsS -H "Authorization: Bearer $API_KEY" \
  http://127.0.0.1:3312/api/runtime/facts | jq '.config'

# Inspect persistence health
curl -fsS http://127.0.0.1:3312/api/persistence/health | jq
```

---

## Step 3: Check Recent Tasks

```bash
# View visible task runs
curl -fsS -H "Authorization: Bearer $API_KEY" \
  "http://127.0.0.1:3312/api/tasks/runs?limit=20" | jq '.runs'

# View internal maintenance runs too
curl -fsS -H "Authorization: Bearer $API_KEY" \
  "http://127.0.0.1:3312/api/tasks/runs?limit=20&includeInternal=true" | jq '.runs'
```

---

## Step 4: Check Logs for Errors

```bash
# Filter errors
grep -i error logs/orchestrator.log | tail -20

# Filter warnings
grep -i warn logs/orchestrator.log | tail -20

# Watch logs in real-time
tail -f logs/orchestrator.log
```

---

## Common Issues & Fixes

### "Cannot find module"

**Symptom**: Error like `Cannot find module './config'`

**Fix**:
```bash
cd orchestrator
npm install
npm run build
npm start
```

---

### "Config file not found"

**Symptom**: `"orchestrator_config.json is missing docsPath"`

**Fix**:
1. Verify file exists:
   ```bash
   ls -la orchestrator_config.json
   ```

2. Verify it's valid JSON:
   ```bash
   cat orchestrator_config.json | jq empty
   ```

3. If missing, create it:
   ```bash
   cat > orchestrator_config.json << 'EOF'
   {
     "docsPath": "./openclaw-docs",
     "logsDir": "./logs",
     "stateFile": "mongo:orchestrator-runtime-state"
   }
   EOF
   ```

---

### "No heartbeats appearing"

**Symptom**: Last heartbeat is old; system seems frozen

**Diagnosis**:
```bash
# Check when last heartbeat occurred
curl -fsS -H "Authorization: Bearer $API_KEY" \
  http://127.0.0.1:3312/api/dashboard/overview | jq '.health.lastHeartbeatAt'

# Check if process is actually running
ps aux | grep -E 'node|tsx' | grep -v grep
```

**Fix**:
- If no recent heartbeat (>10 min old):
  ```bash
  # Restart
  npm start
  
  # Wait 5 min for first heartbeat
  sleep 300
  curl -fsS -H "Authorization: Bearer $API_KEY" \
    "http://127.0.0.1:3312/api/tasks/runs?includeInternal=true&limit=1&type=heartbeat" | jq '.runs[0]'
  ```

- If process not running:
  ```bash
  npm start
  ```

---

### "Docs not being indexed"

**Symptom**: `docsIndexed` array is empty or not growing

**Diagnosis**:
```bash
# Check config path
cat orchestrator_config.json | jq .docsPath

# Verify path exists
ls -la ./openclaw-docs/ | head -10

# Count indexed docs
curl -fsS http://127.0.0.1:3312/api/knowledge/summary | jq '.stats.total'
```

**Fix**:
- Verify docs directory has files:
  ```bash
  find ./openclaw-docs -type f -name "*.md" | wc -l
  ```

- Manually trigger doc-sync:
  ```bash
  # Find the doc-sync task handler in logs
  grep "doc-sync" logs/orchestrator.log | tail -5
  ```

- Check for file watching errors:
  ```bash
  grep "watch" logs/orchestrator.log | grep -i error
  ```

---

### "Agent spawn failed"

**Symptom**: Task fails with `"Agent spawn failed: ..."`

**Diagnosis**:
```bash
# Verify agent exists
ls -la agents/doc-specialist/src/index.ts
ls -la agents/reddit-helper/src/index.ts

# Check if agent dependencies installed
cd agents/doc-specialist
npm install
```

**Fix**:
```bash
# Install agent dependencies
cd agents/doc-specialist
npm install

cd ../reddit-helper
npm install

cd ../shared
npm install

cd ../../orchestrator
npm run build
npm start
```

---

### "Knowledge pack not generated"

**Symptom**: `knowledgePackGenerated: false` in doc-sync results

**Diagnosis**:
```bash
# Check if knowledge pack directory exists
ls -la logs/knowledge-packs/ 2>&1

# Check recent doc-sync tasks
curl -fsS -H "Authorization: Bearer $API_KEY" \
  "http://127.0.0.1:3312/api/tasks/runs?limit=10&type=doc-sync" | jq '.runs[].result'
```

**Fix**:
- Create knowledge pack directory:
  ```bash
  mkdir -p logs/knowledge-packs
  ```

- Manually run doc-specialist:
  ```bash
  cd agents/doc-specialist
  npm install
  
  # Create test payload
  cat > /tmp/payload.json << 'EOF'
  {
    "type": "doc-sync",
    "knowledgePackPath": "../logs/knowledge-packs/test.json"
  }
  EOF
  
  # Run agent
  tsx src/index.ts --payload /tmp/payload.json
  ```

---

## Advanced Debugging

### Inspect Task Handler

If a specific task is failing:

```bash
# Find the task in history
curl -fsS -H "Authorization: Bearer $API_KEY" \
  "http://127.0.0.1:3312/api/tasks/runs?limit=10&type=reddit-response" | jq '.runs[0]'

# View error details
curl -fsS -H "Authorization: Bearer $API_KEY" \
  "http://127.0.0.1:3312/api/tasks/runs?limit=10&type=reddit-response" | jq '.runs[] | select(.status=="error") | .lastError'
```

### Trace Task Execution

To see what a task handler is doing:

1. Add logging in `taskHandlers.ts`
2. Rebuild:
   ```bash
   npm run build
   ```
3. Restart system:
   ```bash
   npm start
   ```
4. Watch logs:
   ```bash
   tail -f logs/orchestrator.log
   ```

### Test Individual Agent

```bash
# Test doc-specialist
cd agents/doc-specialist
npm install

cat > test-payload.json << 'EOF'
{
  "type": "drift-repair",
  "knowledgePackPath": "test-output.json"
}
EOF

tsx src/index.ts --payload test-payload.json > test-result.json

# Check output
cat test-result.json | jq .
```

---

## Health Check Script

Save this as `check-health.sh`:

```bash
#!/bin/bash

echo "=== Orchestrator Health Check ==="

# 1. Process running?
if pgrep -f "node.*orchestrator" > /dev/null; then
  echo "✓ Process running"
else
  echo "✗ Process NOT running"
  exit 1
fi

# 2. Recent heartbeat?
LAST_HB=$(curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:3312/api/dashboard/overview | jq -r '.health.lastHeartbeatAt // empty')
if [ ! -z "$LAST_HB" ]; then
  echo "✓ Last heartbeat: $LAST_HB"
else
  echo "✗ No heartbeat found"
fi

# 3. Persistence health?
if curl -fsS http://127.0.0.1:3312/api/persistence/health | jq -e '.status=="healthy"' >/dev/null; then
  echo "✓ Persistence healthy"
else
  echo "✗ Persistence degraded"
fi

# 4. Recent errors?
ERRORS=$(grep ERROR logs/orchestrator.log | wc -l)
if [ $ERRORS -gt 0 ]; then
  echo "⚠ Found $ERRORS errors in logs"
else
  echo "✓ No errors"
fi

echo "=== Health check complete ==="
```

Run it:
```bash
chmod +x check-health.sh
./check-health.sh
```

---

See [Common Issues](../troubleshooting/common-issues.md) for more solutions.
