import type { QueryInterface } from 'sequelize';

async function up(q: QueryInterface) {
  await q.sequelize.query(`
    CREATE TABLE "InvestmentAnalyticsRangeBases" (
      "userId" INTEGER NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
      "baseKey" TEXT NOT NULL,
      "baseBuiltAt" TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL,
      PRIMARY KEY ("userId", "baseKey", "baseBuiltAt")
    );
    ALTER TABLE "InvestmentAnalyticsReadModels"
      ADD COLUMN "rangeBaseKey" TEXT,
      ADD COLUMN "rangeBaseBuiltAt" TIMESTAMPTZ,
      ADD COLUMN "rangeOverlay" JSONB,
      ADD CONSTRAINT investment_range_reference_shape CHECK (
        ("rangeBaseKey" IS NULL AND "rangeBaseBuiltAt" IS NULL AND "rangeOverlay" IS NULL)
        OR ("rangeBaseKey" IS NOT NULL AND "rangeBaseBuiltAt" IS NOT NULL AND "rangeOverlay" IS NOT NULL AND payload IS NULL)
      ),
      ADD CONSTRAINT investment_range_base_fk FOREIGN KEY ("userId", "rangeBaseKey", "rangeBaseBuiltAt")
        REFERENCES "InvestmentAnalyticsRangeBases" ("userId", "baseKey", "baseBuiltAt") DEFERRABLE INITIALLY DEFERRED;
    CREATE INDEX investment_range_base_refs ON "InvestmentAnalyticsReadModels" ("userId", "rangeBaseKey", "rangeBaseBuiltAt")
      WHERE "rangeBaseKey" IS NOT NULL;
  `);
}

async function down(q: QueryInterface) {
  // Materialize the original full read-model shape before removing the new schema.
  await q.sequelize.transaction(async (transaction) => {
    await q.sequelize.query(`
      ALTER TABLE "InvestmentAnalyticsReadModels" DROP CONSTRAINT investment_range_reference_shape;
      UPDATE "InvestmentAnalyticsReadModels" m SET payload=b.payload || m."rangeOverlay"
      FROM "InvestmentAnalyticsRangeBases" b WHERE b."userId"=m."userId"
        AND b."baseKey"=m."rangeBaseKey" AND b."baseBuiltAt"=m."rangeBaseBuiltAt";
      ALTER TABLE "InvestmentAnalyticsReadModels" DROP CONSTRAINT investment_range_base_fk,
        DROP COLUMN "rangeBaseKey", DROP COLUMN "rangeBaseBuiltAt", DROP COLUMN "rangeOverlay";
      DROP TABLE "InvestmentAnalyticsRangeBases";
    `, { transaction });
  });
}
module.exports = { up, down };
