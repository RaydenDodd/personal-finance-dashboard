import { QueryInterface } from 'sequelize';
module.exports = {
  up: async (q: QueryInterface) =>
    q.sequelize.transaction(async (transaction) => {
      await q.sequelize.query(
        `ALTER TABLE "PersonalFinanceSnapshots" ALTER COLUMN "accountId" DROP NOT NULL;
    ALTER TABLE "PersonalFinanceSnapshots" ADD COLUMN "nativeAccountId" UUID REFERENCES "Accounts"(id) ON DELETE CASCADE;
    ALTER TABLE "PersonalFinanceSnapshots" ADD CONSTRAINT "PersonalFinanceSnapshots_identity" CHECK ("accountId" IS NOT NULL OR "nativeAccountId" IS NOT NULL);
    CREATE INDEX "PersonalFinanceSnapshots_native_date" ON "PersonalFinanceSnapshots" ("userId","nativeAccountId",date) WHERE "nativeAccountId" IS NOT NULL;`,
        { transaction },
      );
    }),
  down: async (q: QueryInterface) =>
    q.sequelize.transaction(async (transaction) => {
      // Raw provider evidence must be exported before a rollback can remove its identity column.
      const [rows] = await q.sequelize.query(
        'SELECT id FROM "PersonalFinanceSnapshots" WHERE "accountId" IS NULL LIMIT 1',
        { transaction },
      );
      if (rows.length) throw Error('Preserve native provider valuations before rolling this migration back');
      await q.sequelize.query(
        'ALTER TABLE "PersonalFinanceSnapshots" DROP CONSTRAINT "PersonalFinanceSnapshots_identity"; DROP INDEX "PersonalFinanceSnapshots_native_date"; ALTER TABLE "PersonalFinanceSnapshots" DROP COLUMN "nativeAccountId"; ALTER TABLE "PersonalFinanceSnapshots" ALTER COLUMN "accountId" SET NOT NULL;',
        { transaction },
      );
    }),
};
