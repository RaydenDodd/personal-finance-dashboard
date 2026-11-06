import { QueryInterface } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE "PersonalFinanceSheetSync" (
          "userId" INTEGER PRIMARY KEY REFERENCES "Users"(id) ON DELETE CASCADE,
          config JSONB NOT NULL, credentials TEXT, "oauthState" TEXT,
          "lastAttemptAt" TIMESTAMPTZ, "lastSuccessAt" TIMESTAMPTZ, "lastErrorCode" TEXT, "lastResult" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE "PersonalFinanceSheetCells" (
          "userId" INTEGER NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
          key TEXT NOT NULL, state JSONB NOT NULL, "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY ("userId",key)
        );
        CREATE TABLE "PersonalFinanceSheetOutbox" (
          id UUID PRIMARY KEY, "userId" INTEGER NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
          key TEXT NOT NULL, "operationHash" TEXT NOT NULL, payload JSONB NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending', "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE ("userId",key,"operationHash")
        );
        CREATE TABLE "PersonalFinanceSheetConflicts" (
          id UUID PRIMARY KEY, "userId" INTEGER NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
          key TEXT NOT NULL, "accountId" UUID NOT NULL REFERENCES "PersonalFinanceAccounts"(id) ON DELETE CASCADE,
          date DATE NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL,
          "sheetValue" JSONB, "dashboardValue" JSONB, "sheetFingerprint" TEXT NOT NULL,
          "localFingerprint" TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "resolvedAt" TIMESTAMPTZ
        );
        CREATE UNIQUE INDEX "PersonalFinanceSheetConflicts_open" ON "PersonalFinanceSheetConflicts" ("userId",key) WHERE status='open';
      `,
        { transaction },
      );
    });
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    for (const name of [
      'PersonalFinanceSheetConflicts',
      'PersonalFinanceSheetOutbox',
      'PersonalFinanceSheetCells',
      'PersonalFinanceSheetSync',
    ])
      await queryInterface.dropTable(name);
  },
};
