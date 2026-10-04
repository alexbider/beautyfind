// Hand-written reference profiles: the gold examples the writer prompt carries (src/lib/import/goldExamples.json).
// No rewrite queue, enhance run or regenerate ever touches their text; they are also marked ownerApproved on the
// listing, which the publisher honours on its own.

export const REFERENCE_BRANCH_IDS: ReadonlySet<string> = new Set([
  '9c7c2244-996d-45b2-88a2-9160cd872e80', // rich: ד״ר מנאר קעואר, Haifa
  '80be9c7f-a966-4f2c-9309-97bbbb8fa10b', // normal: Batya Care & Beauty Institute, Nahariya
  '2ccbad7e-ae74-4814-afcb-89d1d6d34d30', // sparse: Grace Cosmetology Nahariya
]);

export const isReferenceBranch = (branchId: string | null | undefined) => !!branchId && REFERENCE_BRANCH_IDS.has(branchId);
