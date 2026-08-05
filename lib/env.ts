import { z } from "zod";

const serverEnvSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .min(1, "DATABASE_URL is required")
      .refine((value) => {
        try {
          const protocol = new URL(value).protocol;
          return protocol === "postgres:" || protocol === "postgresql:";
        } catch {
          return false;
        }
      }, "DATABASE_URL must be a valid PostgreSQL connection URL"),
    AI_PROVIDER: z.enum(["mock", "gemini"]).default("mock"),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().optional(),
    EMAIL_IMPORT_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  })
  .superRefine((env, context) => {
    if (env.AI_PROVIDER !== "gemini") {
      return;
    }

    if (!env.GEMINI_API_KEY?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["GEMINI_API_KEY"],
        message: "GEMINI_API_KEY is required when AI_PROVIDER is gemini",
      });
    }

    if (!env.GEMINI_MODEL?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["GEMINI_MODEL"],
        message: "GEMINI_MODEL is required when AI_PROVIDER is gemini",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(
  source: Record<string, string | undefined>,
): ServerEnv {
  const result = serverEnvSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid server configuration: ${details}`);
  }

  return result.data;
}

let cachedEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cachedEnv ??= parseServerEnv(process.env);
  return cachedEnv;
}
