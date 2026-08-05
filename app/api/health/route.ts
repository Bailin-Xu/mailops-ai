import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().$queryRaw`SELECT 1`;

    return NextResponse.json({
      status: "ok",
      checks: { database: "reachable" },
    });
  } catch (error) {
    const isConfigurationError =
      error instanceof Error && error.message.startsWith("Invalid server configuration:");

    console.error(
      "Health check failed",
      error instanceof Error ? error.message : "Unknown error",
    );

    return NextResponse.json(
      {
        status: "unhealthy",
        checks: { database: "unreachable" },
        message: isConfigurationError
          ? "The server configuration is invalid. Check the required environment variables."
          : "The application cannot connect to its local database.",
      },
      { status: 503 },
    );
  }
}
