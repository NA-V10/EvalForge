import { z } from "zod";

export const RedactionRuleSchema = z.object({
  name: z.string().min(1),
  pattern: z.string().min(1),
  replacement: z.string(),
  flags: z.string().optional(),
});
