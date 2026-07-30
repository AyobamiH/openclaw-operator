import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { canonicalDocumentDigest, createApprovalRequest, executeApprovedTransaction, prepareRepositoryPatch, signingProviderFromPrivateKeyPem, verifyReceipt, type ExecutionRequestDocument, type RepositoryPatchRequestDocument } from "@oneclicksystems/agentproof";
// @ts-expect-error legacy Operator TypeScript resolution does not model package export subpaths
import { createDevelopmentApprovalDecision, createDevelopmentKeyPair } from "@oneclicksystems/agentproof/development-authority";
import { adaptApprovedReplayToAgentProofDevelopmentDecision } from "../src/agentproofAdapter.js";
import { decideAndEnqueueApprovalReplay } from "../src/approvalReplay.js";
import { TaskQueue } from "../src/taskQueue.js";
import type { ApprovalRecord, OrchestratorState } from "../src/types.js";
const run=promisify(execFile);

test("canonical Operator replay authorizes one RC5 public-package execution", async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"operator-agentproof-")), repo=path.join(root,"repo"), stateDir=path.join(root,"state");
  await run("git",["init","-b","main",repo]); await run("git",["-C",repo,"config","user.email","test@example.invalid"]); await run("git",["-C",repo,"config","user.name","Test"]);
  await writeFile(path.join(repo,"protected.txt"),"before\n"); await run("git",["-C",repo,"add","protected.txt"]); await run("git",["-C",repo,"commit","-m","base"]);
  const request:RepositoryPatchRequestDocument={schema:"agentproof.protocol.repository-patch-request",schemaVersion:"1.0.0",actionType:"agentproof.repository_patch.v1",correlationId:"operator-rc5-correlation",stateDirectory:stateDir,
    action:{type:"agentproof.repository_patch.v1",repositoryRoot:repo,operations:[{kind:"write",path:"protected.txt",contentBase64:Buffer.from("after\n").toString("base64")}]},
    intent:{summary:"Operator approved patch",requestedBy:"operator-test",acceptanceCriteria:["exact postcondition"]},policy:{allowedRepositoryRoot:repo,allowedTrackedPaths:["protected.txt"],allowedNewPaths:[],maxPatchBytes:1024,maxFiles:1}};
  const prepared=await prepareRepositoryPatch(request), approvalRequest=await createApprovalRequest(prepared,{expiresAt:new Date(Date.now()+60000).toISOString(),nonce:"operator-rc5-nonce"});
  const approval:ApprovalRecord={taskId:"operator-approval",type:"build-refactor",payload:{agentProofApprovalRequestDigest:approvalRequest.requestDigest,agentProofApprovalDocumentDigest:canonicalDocumentDigest(approvalRequest)},requestedAt:new Date().toISOString(),status:"pending"};
  const state={approvals:[approval],taskExecutions:[]} as unknown as OrchestratorState, queue=new TaskQueue();
  const replay=decideAndEnqueueApprovalReplay({state,queue,taskId:approval.taskId,decision:"approved",actor:"operator-local-authority"}); expect(replay.status).toBe("replay-enqueued");
  const authority=createDevelopmentKeyPair(), receiptKey=createDevelopmentKeyPair(); const authorityIssuer={issue:(request:any,context:any)=>createDevelopmentApprovalDecision({request,decision:"approved",issuer:context.issuer,decidedAt:context.decidedAt,privateKeyPem:authority.privateKeyPem,developmentMode:true})};
  const decision=adaptApprovedReplayToAgentProofDevelopmentDecision({approval:replay.approval,replay:replay.replay!,approvalRequest,authorityIssuer});
  const execution:ExecutionRequestDocument={schema:"agentproof.protocol.execution-request",schemaVersion:"1.0.0",actionType:"agentproof.repository_patch.v1",correlationId:prepared.correlationId,transactionId:prepared.transactionId,stateDirectory:prepared.stateDirectory,idempotencyKey:"operator-execute",requiredAuthorityEnvironment:"development",trustedAuthorityFingerprints:[authority.fingerprint],approvalDecision:decision};
  const signer=signingProviderFromPrivateKeyPem("operator-test",receiptKey.privateKeyPem), receipt=await executeApprovedTransaction(execution,{receiptSigner:signer});
  expect(await readFile(path.join(repo,"protected.txt"),"utf8")).toBe("after\n"); expect(verifyReceipt({document:receipt,trustedSignerFingerprints:[receiptKey.fingerprint]})).toMatchObject({trusted:true,verifiedClaims:{correlationId:prepared.correlationId}});
  expect(await executeApprovedTransaction(execution,{receiptSigner:signer})).toEqual(receipt);
  const altered={...replay.replay!,payload:{...replay.replay!.payload,approvedFromTaskId:"wrong"}}; expect(()=>adaptApprovedReplayToAgentProofDevelopmentDecision({approval:replay.approval,replay:altered,approvalRequest,authorityIssuer})).toThrow("agentproof_operator_replay_link_invalid");
});
