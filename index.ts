import { z } from "zod";

function parseConfig() {
  const zNumber = z
    .string()
    .default("3000")
    .transform((val, ctx) => {
      const parsed = parseInt(val);
      if (isNaN(parsed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Not a number",
        });
        return z.NEVER;
      }
      return parsed;
    });

  const zConfig = z.object({
    PORT: zNumber,
  });
  const config = zConfig.parse(process.env);
  return config;
}

const config = parseConfig();

const server = Bun.serve({
  port: config.PORT,
});

console.info(`Serving http://localhost:${server.port}`);
