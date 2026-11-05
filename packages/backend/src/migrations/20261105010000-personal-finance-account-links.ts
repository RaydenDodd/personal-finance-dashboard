import { QueryInterface } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE "PersonalFinanceAccountLinks" (
          "userId" INTEGER NOT NULL REFERENCES "Users"(id) ON DELETE CASCADE,
          "accountId" UUID NOT NULL REFERENCES "PersonalFinanceAccounts"(id) ON DELETE CASCADE,
          "nativeAccountId" UUID NOT NULL REFERENCES "Accounts"(id) ON DELETE CASCADE,
          PRIMARY KEY ("accountId", "nativeAccountId"),
          UNIQUE ("userId", "nativeAccountId")
        );
        INSERT INTO "PersonalFinanceAccountLinks" ("userId", "accountId", "nativeAccountId")
          SELECT "userId", id, "nativeAccountId" FROM "PersonalFinanceAccounts" WHERE "nativeAccountId" IS NOT NULL;
      `,
        { transaction },
      );
    });
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.dropTable('PersonalFinanceAccountLinks');
  },
};
