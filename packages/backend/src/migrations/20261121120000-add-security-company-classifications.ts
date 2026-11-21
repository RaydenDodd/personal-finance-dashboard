import { DataTypes, QueryInterface } from 'sequelize';
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'Securities',
        'companyClassifications',
        { type: DataTypes.JSONB, allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'SecurityPricings',
        'unadjustedClose',
        { type: DataTypes.DECIMAL(20, 10), allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'SecurityPricings',
        'previousClose',
        { type: DataTypes.JSONB, allowNull: true },
        { transaction },
      );
    });
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn('Securities', 'companyClassifications', { transaction });
      await queryInterface.removeColumn('SecurityPricings', 'unadjustedClose', {
        transaction,
      });
      await queryInterface.removeColumn('SecurityPricings', 'previousClose', {
        transaction,
      });
    });
  },
};
