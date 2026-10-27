type DatabaseEnvironment = Record<string, string | undefined>;

function parseDatabaseUrl(value: string | undefined, name: string): URL {
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
    return url;
  } catch {
    throw new Error(`${name} must be an explicit PostgreSQL URL.`);
  }
}

function databaseIdentity(url: URL) {
  const host = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    ? "loopback"
    : url.hostname.toLowerCase();
  return `${host}:${url.port || "5432"}/${decodeURIComponent(url.pathname.slice(1))}`;
}

/** Validate before connecting, migrating, seeding, or cleaning up test records. */
export function resolveTestDatabaseUrl(env: DatabaseEnvironment): string {
  const test = parseDatabaseUrl(env.TEST_DATABASE_URL, "TEST_DATABASE_URL");
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(test.hostname)
    || decodeURIComponent(test.pathname) !== "/mailops_test"
    || decodeURIComponent(test.username) !== "mailops_test"
    || !test.password
  ) {
    throw new Error("Integration tests require a loopback mailops_test database and mailops_test role with a password.");
  }

  const parameters = [...test.searchParams.entries()];
  if (parameters.length > 1 || parameters.some(([key, value]) => key !== "schema" || value !== "public")) {
    throw new Error("TEST_DATABASE_URL permits only the public schema parameter; connection overrides are forbidden.");
  }

  if (env.DATABASE_URL) {
    const development = parseDatabaseUrl(env.DATABASE_URL, "DATABASE_URL");
    if (databaseIdentity(test) === databaseIdentity(development)) {
      throw new Error("The test database must be different from DATABASE_URL, regardless of credentials or schema.");
    }
  }
  return test.toString();
}
