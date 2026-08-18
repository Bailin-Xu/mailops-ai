import { z } from "zod";

const booleanEnv = (defaultValue: boolean) => z
  .enum(["true", "false"])
  .default(defaultValue ? "true" : "false")
  .transform((value) => value === "true");

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
    SHADOW_MODE: booleanEnv(true),
    EXTERNAL_DELIVERY_ENABLED: booleanEnv(false),
    AUTO_REPLY_MIN_CONFIDENCE: z.coerce.number().min(0.7).max(1).default(0.9),
    EMAIL_IMPORT_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
    MAILOPS_OWNED_EMAIL_ADDRESSES: z
      .string()
      .default("")
      .transform((value, context) => {
        const addresses = [
          ...new Set(
            value
              .split(",")
              .map((address) => address.trim().toLowerCase())
              .filter(Boolean),
          ),
        ];

        for (const address of addresses) {
          if (!z.email().safeParse(address).success) {
            context.addIssue({
              code: "custom",
              message: `Invalid owned email address: ${address}`,
            });
            return z.NEVER;
          }
        }

        return addresses;
      }),
  })
  .superRefine((env, context) => {
    if (env.EXTERNAL_DELIVERY_ENABLED && env.SHADOW_MODE) {
      context.addIssue({
        code: "custom",
        path: ["EXTERNAL_DELIVERY_ENABLED"],
        message: "EXTERNAL_DELIVERY_ENABLED cannot be true while SHADOW_MODE is true",
      });
    }

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
