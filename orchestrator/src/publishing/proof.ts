import type { AssetRelationship } from "./types.js";

function hamming(left: string, right: string): number | null {
  if (!/^[a-f0-9]+$/i.test(left) || left.length !== right.length) return null;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const value = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    distance += value.toString(2).replace(/0/g, "").length;
  }
  return distance;
}

export function classifyAssetRelationship(input: {
  sourceSha256?: string | null;
  candidateSha256?: string | null;
  sourcePerceptualHash?: string | null;
  candidatePerceptualHash?: string | null;
  sourceDurationSeconds?: number | null;
  candidateDurationSeconds?: number | null;
}): AssetRelationship {
  if (input.sourceSha256 && input.candidateSha256 && input.sourceSha256 === input.candidateSha256) {
    return { classification: "exact", confidence: "high", reasons: ["sha256-equal"] };
  }
  const distance = input.sourcePerceptualHash && input.candidatePerceptualHash
    ? hamming(input.sourcePerceptualHash, input.candidatePerceptualHash)
    : null;
  const bits = input.sourcePerceptualHash ? input.sourcePerceptualHash.length * 4 : 0;
  const ratio = distance === null || bits === 0 ? null : distance / bits;
  const durationRatio =
    input.sourceDurationSeconds && input.candidateDurationSeconds
      ? Math.min(input.sourceDurationSeconds, input.candidateDurationSeconds) /
        Math.max(input.sourceDurationSeconds, input.candidateDurationSeconds)
      : null;
  if (ratio !== null && ratio <= 0.08 && (durationRatio === null || durationRatio >= 0.98)) {
    return {
      classification: "recompression",
      confidence: "high",
      reasons: [`perceptual-distance-ratio:${ratio.toFixed(4)}`, `duration-ratio:${durationRatio ?? "unavailable"}`],
    };
  }
  if (ratio !== null && ratio <= 0.22 && durationRatio !== null && durationRatio < 0.98) {
    return {
      classification: "derivative",
      confidence: "medium",
      reasons: [`perceptual-distance-ratio:${ratio.toFixed(4)}`, `duration-ratio:${durationRatio.toFixed(4)}`],
    };
  }
  if (input.sourceSha256 && input.candidateSha256 && ratio !== null && ratio > 0.35) {
    return {
      classification: "unrelated",
      confidence: "high",
      reasons: ["sha256-different", `perceptual-distance-ratio:${ratio.toFixed(4)}`],
    };
  }
  return {
    classification: "unknown",
    confidence: "low",
    reasons: ["insufficient-fingerprint-evidence"],
  };
}
