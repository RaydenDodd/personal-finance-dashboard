import { QueryInterface } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE "PersonalFinanceCashFlows"
          ADD COLUMN source TEXT NOT NULL DEFAULT 'manual',
          ADD COLUMN "sourceId" TEXT,
          ADD COLUMN "sourceKey" TEXT,
          ADD COLUMN "sourceFingerprint" TEXT,
          ADD COLUMN "transactionId" UUID REFERENCES "Transactions"(id) ON DELETE SET NULL,
          ADD COLUMN "contributionKind" TEXT NOT NULL DEFAULT 'unspecified' CHECK ("contributionKind" IN ('employee','employer','unspecified')),
          ADD COLUMN verified BOOLEAN NOT NULL DEFAULT true,
          ADD COLUMN evidence JSONB NOT NULL DEFAULT '{}',
          ADD COLUMN "supersedesId" UUID REFERENCES "PersonalFinanceCashFlows"(id) ON DELETE RESTRICT,
          ADD COLUMN "supersededAt" TIMESTAMPTZ;
        CREATE UNIQUE INDEX "PersonalFinanceCashFlows_active_source" ON "PersonalFinanceCashFlows" ("userId","sourceId","sourceKey") WHERE "sourceId" IS NOT NULL AND "sourceKey" IS NOT NULL AND "supersededAt" IS NULL;
        CREATE UNIQUE INDEX "PersonalFinanceCashFlows_one_successor" ON "PersonalFinanceCashFlows" ("supersedesId") WHERE "supersedesId" IS NOT NULL;
        CREATE TABLE "PersonalFinancePrincipalReferences" (
          "userId" INTEGER NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
          namespace TEXT NOT NULL, key TEXT NOT NULL,
          "cashFlowId" UUID NOT NULL REFERENCES "PersonalFinanceCashFlows"(id) ON DELETE CASCADE,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY ("userId",namespace,key)
        );
        CREATE TABLE "PersonalFinancePrincipalTransferRules" (
          id UUID PRIMARY KEY, "userId" INTEGER NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
          "sourceNativeAccountId" UUID NOT NULL REFERENCES "Accounts"(id) ON DELETE CASCADE,
          "destinationAccountId" UUID NOT NULL REFERENCES "PersonalFinanceAccounts"(id) ON DELETE CASCADE,
          "exactDescription" TEXT NOT NULL, "effectiveFrom" DATE NOT NULL,
          "isEnabled" BOOLEAN NOT NULL DEFAULT true,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE ("userId","sourceNativeAccountId","exactDescription")
        );
        CREATE TABLE "PersonalFinancePrincipalReviews" (
          id UUID PRIMARY KEY, "userId" INTEGER NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
          "reviewKey" TEXT NOT NULL, reason TEXT NOT NULL, details JSONB NOT NULL,
          "resolvedAt" TIMESTAMPTZ, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE ("userId","reviewKey")
        );
      `,
        { transaction },
      );
    });
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const table of [
        'PersonalFinancePrincipalReviews',
        'PersonalFinancePrincipalTransferRules',
        'PersonalFinancePrincipalReferences',
      ])
        await queryInterface.dropTable(table, { transaction });
      await queryInterface.sequelize.query(
        `
        DROP INDEX "PersonalFinanceCashFlows_one_successor";
        DROP INDEX "PersonalFinanceCashFlows_active_source";
        ALTER TABLE "PersonalFinanceCashFlows" DROP COLUMN "supersededAt", DROP COLUMN "supersedesId", DROP COLUMN evidence,
          DROP COLUMN verified, DROP COLUMN "contributionKind", DROP COLUMN "transactionId", DROP COLUMN "sourceFingerprint",
          DROP COLUMN "sourceKey", DROP COLUMN "sourceId", DROP COLUMN source;
      `,
        { transaction },
      );
    });
  },
};
