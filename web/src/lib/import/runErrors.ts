// Why a run stopped, from its error text. Shared by the server actions and the admin screens.

/** Why a run stopped, from its error text: out of provider funds, a key problem, a budget cap, or something else. */
export function runErrorKind(error: string | null): 'funds' | 'auth' | 'budget' | 'other' | null {
  if (!error) return null;
  if (/payment required|40200|\b402\b|credit balance|no_credit|insufficient|balance|top.?up|billing|usage.?limit|limit exceeded|credits?\b/i.test(error)) return 'funds';
  if (/40100|\b401\b|auth|not authorized|model_not_found|api key|no_api_key|token/i.test(error)) return 'auth';
  if (/budget_exceeded|budget/i.test(error)) return 'budget';
  return 'other';
}

