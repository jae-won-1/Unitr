// A column added by a migration that may not have been run yet.
//
// House convention (CLAUDE.md): missing migrations degrade, they don't crash.
// Naming a column that isn't in the schema fails the *whole* statement, so a
// query or update that wants an optional column runs twice — once with it, and
// once without, if the first attempt objected to that column by name.
//
// `run` is handed the flag and builds the statement itself rather than being
// given a prebuilt query, because a Supabase builder can only be awaited once.

type Result<T> = { data: T | null; error: { message: string } | null };

export async function withOptionalColumn<T>(
  column: string | string[],
  run: (include: boolean) => PromiseLike<Result<T>>,
): Promise<Result<T> & { included: boolean }> {
  const names = Array.isArray(column) ? column : [column];
  // Postgres names the offending column in the message ("column profiles.positions
  // does not exist"), so only that complaint costs a second round trip — any
  // other error is returned as it is.
  const objection = new RegExp(`\\b(${names.join("|")})\\b`);

  const first = await run(true);
  if (first.error && objection.test(first.error.message)) {
    const retried = await run(false);
    return { ...retried, included: false };
  }
  return { ...first, included: true };
}
