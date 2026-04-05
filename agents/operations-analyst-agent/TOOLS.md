# TOOLS - Operations Analyst Agent

## Local Smoke
```bash
cd /home/oneclickwebsitedesignfactory/.openclaw/workspace/projects/openclaw-operator
npm run dev
```

```bash
curl -H "Authorization: Bearer <operator-key>" \
  -H "Content-Type: application/json" \
  -d '{"type":"control-plane-brief","payload":{"focus":"operator summary"}}' \
  http://127.0.0.1:3000/api/tasks/trigger
```

## What To Inspect
```bash
curl -H "Authorization: Bearer <operator-key>" \
  http://127.0.0.1:3000/api/agents/overview
```

## Success Signal
- `controlPlaneBrief` appears in task-run result highlights and agent runtime
  readiness signals.
