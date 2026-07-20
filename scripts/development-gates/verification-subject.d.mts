export function collectGitVerificationSubject(root: string, options?: {
  policyPath?: string;
  stagePath?: string;
}): {
  headSha: string;
  treeSha: string;
  workingTreeDigest: string;
  dirty: boolean;
  policySha256: string;
  stageSha256: string;
};
