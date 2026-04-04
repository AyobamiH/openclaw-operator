---
title: "Common Issues"
summary: "Troubleshooting guide and FAQ."
---

# Common Issues

## Installation & Startup

### "npm ERR! Cannot find module"

```bash
cd orchestrator
rm -rf node_modules package-lock.json
npm install
```

### "orchestrator_config.json is missing docsPath"

Create/update `orchestrator_config.json`:

```json
{
  "docsPath": "./openclaw-docs",
  "logsDir": "./logs",
  "stateFile": "mongo:orchestrator-runtime-state"
}
```

### System doesn't start

Check logs:

```bash
npm start 2>&1 | head -50
```

Look for:
- File not found errors
- JSON parse errors
- Permission denied

### "logs directory doesn't exist"

This is normal. The system creates it. Verify:

```bash
ls -la logs/
cat logs/orchestrator.log
```

---

## Runtime Issues

### No logs appearing

Check environment:

```bash
# Verify config loaded
cat orchestrator_config.json | jq .

# Check log directory writable
touch logs/test.txt && rm logs/test.txt

# Restart
npm start
```

### Heartbeat not appearing

Check state:

```bash
curl -fsS -H "Authorization: Bearer $API_KEY" \
  http://127.0.0.1:3312/api/dashboard/overview | jq '.health.lastHeartbeatAt'
```

If null or old, system may have crashed:

```bash
npm start 2>&1 | tail -20
```

### Tasks not processing

Check queue and concurrency:

```bash
# View last 5 visible tasks
curl -fsS -H "Authorization: Bearer $API_KEY" \
  "http://127.0.0.1:3312/api/tasks/runs?limit=5" | jq '.runs'

# Check internal maintenance runs too when needed
curl -fsS -H "Authorization: Bearer $API_KEY" \
  "http://127.0.0.1:3312/api/tasks/runs?limit=10&includeInternal=true" | jq '.runs'
```

---

## Agent Issues

### "Agent spawn failed"

Check agent template exists:

```bash
ls -la agents/doc-specialist/src/index.ts
ls -la agents/reddit-helper/src/index.ts
```

### "No handler for task type"

Typo in task type. Check [Task Types](../reference/task-types.md) for valid names.

---

See [Debugging](./debugging.md) for deeper diagnosis.
