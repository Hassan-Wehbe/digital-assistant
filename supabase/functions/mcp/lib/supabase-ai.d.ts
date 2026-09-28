// Minimal types for the Edge Runtime's built-in AI API (the global `Supabase`).
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
