# TOOLS - Release Manager Agent

## Local Smoke
```bash
cd /home/oneclickwebsitedesignfactory/.openclaw/workspace/projects/openclaw-operator
npm run dev
```

```bash
curl -H "Authorization: Bearer <operator-key>" \
  -H "Content-Type: application/json" \
  -d '{"type":"release-readiness","payload":{"releaseTarget":"local"}}' \
  http://127.0.0.1:3000/api/tasks/trigger
```

## What To Inspect
```bash
curl -H "Authorization: Bearer <operator-key>" \
  http://127.0.0.1:3000/api/tasks/runs?limit=20
```

## Success Signal
- `releaseReadiness` appears in task-run highlights and agent runtime readiness
  signals with `go`, `hold`, or `block` posture.
