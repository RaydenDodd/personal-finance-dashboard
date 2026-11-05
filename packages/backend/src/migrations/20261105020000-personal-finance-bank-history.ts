import { QueryInterface } from 'sequelize';
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(
      'ALTER TABLE "PersonalFinanceSettings" ADD COLUMN "bankHistoryMappings" JSONB NOT NULL DEFAULT \'[]\'::jsonb',
    );
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.removeColumn('PersonalFinanceSettings', 'bankHistoryMappings');
  },
};
