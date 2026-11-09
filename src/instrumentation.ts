// Runs once when the server starts: bring the database schema up to date.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./migrate");
}
