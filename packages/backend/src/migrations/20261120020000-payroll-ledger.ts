import { QueryInterface } from 'sequelize';

module.exports = {
  up: async (q: QueryInterface) => {
    await q.sequelize.query(`CREATE TABLE "PayrollLedger" (
      "userId" INTEGER PRIMARY KEY REFERENCES "Users"(id) ON DELETE CASCADE,
      document JSONB NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE "PayrollLedgerAudit" (
      id UUID PRIMARY KEY,
      "userId" INTEGER NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
      action VARCHAR(80) NOT NULL,
      details JSONB NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX "PayrollLedgerAudit_user_date" ON "PayrollLedgerAudit" ("userId", "createdAt");`);
  },
  down: async (q: QueryInterface) => {
    await q.dropTable('PayrollLedgerAudit');
    await q.dropTable('PayrollLedger');
  },
};
