type RetryOptions = {
  timeoutMs: number;
  attempts?: number;
};

function isTransientStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function retryDelay(response: Response | null, attempt: number) {
  const retryAfter = Number(response?.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(retryAfter * 1_000, 1_500);
  }
  return 250 * (attempt + 1);
}

export async function fetchWithTransientRetry(
  input: string | URL,
  init: Omit<RequestInit, "signal"> = {},
  options: RetryOptions,
) {
  const attempts = Math.max(1, Math.min(options.attempts ?? 2, 3));
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response | null = null;
    try {
      response = await fetch(input, {
        ...init,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (response.ok || !isTransientStatus(response.status) || attempt === attempts - 1) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
  }

  throw lastError instanceof Error ? lastError : new Error("Connector request failed after bounded retries");
}
