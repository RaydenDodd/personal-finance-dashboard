import { QueryInterface } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE "PersonalFinanceSettings" ADD COLUMN income JSONB NOT NULL DEFAULT '{"revision":0,"employers":[],"paychecks":[],"plans":[]}'::jsonb`,
    );
  },
  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn('PersonalFinanceSettings', 'income');
  },
};
