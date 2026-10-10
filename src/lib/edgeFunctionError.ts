// supabase.functions.invoke() reports ANY non-2xx as a FunctionsHttpError whose
// message is the unhelpful "Edge Function returned a non-2xx status code", and
// leaves `data` null. The reason the function actually gave — "An employee with
// this email already exists in the Hub", "Forbidden: Admin only" — is in the
// response body, reachable only through error.context.
//
// Without this, a deliberate, correct refusal is indistinguishable from a crash:
// an admin adding a duplicate saw only the generic string and had no way to know
// the person was already in the Hub.
export async function edgeFunctionError(error: unknown, fallback: string): Promise<Error> {
  const ctx = (error as { context?: Response } | null)?.context

  if (ctx && typeof ctx.clone === 'function') {
    try {
      // clone() so this never competes with anything else reading the body.
      const body = await ctx.clone().json()
      if (body?.error) return new Error(String(body.error))
    } catch {
      // Not JSON, or already consumed — fall back to the generic message.
    }
  }

  const msg = (error as { message?: string } | null)?.message
  return new Error(msg || fallback)
}
