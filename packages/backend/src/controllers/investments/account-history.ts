import { createController } from "@controllers/helpers/controller-factory";
import { investmentHistoryCron } from "@crons/investment-history";
import { getAccountHistory } from "@services/investments/analytics/account-history";
import { z } from "zod";
const flag = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");
export const getAccountHistoryController = createController(
  z.object({
    query: z.object({
      portfolioIds: z
        .string()
        .optional()
        .transform((v) => v?.split(",").filter(Boolean)),
      from: z.iso.date().optional(),
      through: z.iso.date().optional(),
      includeCapital: flag,
      gainFrom: z.iso.date().optional(),
      includeEvents: flag,
      audit: flag,
      coverageOnly: flag,
    }),
  }),
  async ({ user, query }) => ({
    data: await getAccountHistory({ userId: user.id, ...query }),
  }),
);
export const rebuildAccountHistoryController = createController(
  z.object({}),
  async ({ user }) => ({
    data: await investmentHistoryCron.triggerManualSync({
      userId: user.id,
      budgetMs: 20000,
    }),
  }),
  { inBackground: true },
);
