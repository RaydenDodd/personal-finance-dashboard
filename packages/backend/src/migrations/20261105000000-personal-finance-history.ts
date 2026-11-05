import { QueryInterface } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        CREATE TABLE "PersonalFinanceSettings" (
          "userId" INTEGER PRIMARY KEY REFERENCES "Users"("id") ON DELETE CASCADE,
          categories JSONB NOT NULL, "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE "PersonalFinanceAccounts" (
          id UUID PRIMARY KEY, "userId" INTEGER NOT NULL REFERENCES "Users"("id") ON DELETE CASCADE,
          name TEXT NOT NULL, "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'USD',
          "categoryId" TEXT NOT NULL, included BOOLEAN NOT NULL DEFAULT true,
          "balanceKind" TEXT NOT NULL CHECK ("balanceKind" IN ('asset','liability')),
          "nativeAccountId" UUID REFERENCES "Accounts"(id) ON DELETE SET NULL,
          "preferredSource" TEXT NOT NULL DEFAULT 'manual', description TEXT NOT NULL DEFAULT '',
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE ("userId", "nativeAccountId")
        );
        CREATE TABLE "PersonalFinanceSnapshots" (
          id UUID PRIMARY KEY, revision BIGSERIAL UNIQUE, "userId" INTEGER NOT NULL REFERENCES "Users"("id") ON DELETE CASCADE,
          "accountId" UUID NOT NULL REFERENCES "PersonalFinanceAccounts"(id) ON DELETE CASCADE,
          date DATE NOT NULL, "balanceCents" BIGINT NOT NULL, "currencyCode" VARCHAR(3) NOT NULL,
          source TEXT NOT NULL, verified BOOLEAN NOT NULL DEFAULT false,
          "sourceId" TEXT NOT NULL, "sourceKey" TEXT NOT NULL, fingerprint TEXT NOT NULL,
          "sourceLabel" TEXT NOT NULL DEFAULT '', formula TEXT, description TEXT NOT NULL DEFAULT '',
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE ("userId", "sourceId", "sourceKey", fingerprint)
        );
        CREATE INDEX "PersonalFinanceSnapshots_lookup" ON "PersonalFinanceSnapshots" ("userId", "accountId", date);
        CREATE TABLE "PersonalFinanceCashFlows" (
          id UUID PRIMARY KEY, "userId" INTEGER NOT NULL REFERENCES "Users"("id") ON DELETE CASCADE,
          "accountId" UUID NOT NULL REFERENCES "PersonalFinanceAccounts"(id) ON DELETE CASCADE,
          date DATE NOT NULL, "amountCents" BIGINT NOT NULL, type TEXT NOT NULL,
          "toAccountId" UUID REFERENCES "PersonalFinanceAccounts"(id) ON DELETE RESTRICT,
          description TEXT NOT NULL DEFAULT '', opening BOOLEAN NOT NULL DEFAULT false,
          "idempotencyKey" TEXT, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE ("userId", "idempotencyKey")
        );
        CREATE TABLE "PersonalFinanceAudit" (
          id UUID PRIMARY KEY, "userId" INTEGER NOT NULL REFERENCES "Users"("id") ON DELETE CASCADE,
          action TEXT NOT NULL, "entityId" TEXT NOT NULL, details JSONB NOT NULL,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE "PersonalFinanceMonthlyRuns" (
          "userId" INTEGER NOT NULL REFERENCES "Users"("id") ON DELETE CASCADE,
          month DATE NOT NULL, "missingAccountIds" JSONB NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY ("userId", month)
        );
      `, { transaction });
    });
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const name of ['PersonalFinanceMonthlyRuns','PersonalFinanceAudit','PersonalFinanceCashFlows','PersonalFinanceSnapshots','PersonalFinanceAccounts','PersonalFinanceSettings'])
        await queryInterface.dropTable(name, { transaction });
    });
  },
};
