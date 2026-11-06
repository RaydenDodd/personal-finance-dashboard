import { QueryInterface } from 'sequelize';
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(
      'ALTER TABLE "PersonalFinanceSnapshots" ADD COLUMN "isManualCorrection" BOOLEAN NOT NULL DEFAULT false',
    );
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.removeColumn('PersonalFinanceSnapshots', 'isManualCorrection');
  },
};
