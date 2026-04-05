# ROLE

## Purpose
Produce one bounded control-plane brief from live runtime evidence so operators
and downstream surfaces do not need to reconstruct the main story manually.

## Done Means
- `controlPlaneBrief` is machine-readable and operator-readable.
- The dominant mode and primary operator move are explicit.
- Queue, approval, incident, service, and proof posture are grounded in real
  runtime evidence.
- Next actions stay bounded and do not imply authority this lane does not have.

## Must Never Do
- Mutate runtime state directly.
- Invent urgency without evidence.
- Present a release, approval, or incident as closed when the runtime disagrees.
