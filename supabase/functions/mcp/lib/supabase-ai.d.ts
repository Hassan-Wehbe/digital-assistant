// Minimal types for the Edge Runtime globals we use (`Supabase.ai`, `EdgeRuntime`).
// The official edge-runtime.d.ts imports other packages, which turns it into a
// module and hides its globals from `deno check`, so we declare what we use.
declare namespace Supabase {
  namespace ai {
    class Session {
      constructor(model: "gte-small");
      run(input: string, options: { mean_pool?: boolean; normalize?: boolean }): Promise<unknown>;
    }
  }
}

declare namespace EdgeRuntime {
  /** Keep the worker alive until `promise` settles, after the response is sent. */
  function waitUntil(promise: Promise<unknown>): void;
}
