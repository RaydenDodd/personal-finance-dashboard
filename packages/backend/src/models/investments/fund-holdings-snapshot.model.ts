import type { InvestmentFundSnapshot } from '@bt/shared/types/investment-analytics';
import { Column, DataType, ForeignKey, Model, PrimaryKey, Table } from 'sequelize-typescript';

import Users from '../users.model';

/** Separate analytical composition data; never changes investment/account records. */
@Table({ tableName: 'InvestmentFundSnapshots', timestamps: true })
export default class InvestmentFundSnapshots extends Model {
  @PrimaryKey @Column({ type: DataType.STRING(64) }) declare id: string;
  @ForeignKey(() => Users) @Column({ type: DataType.INTEGER, allowNull: false }) declare userId: number;
  @Column({ type: DataType.JSONB, allowNull: false }) declare data: InvestmentFundSnapshot;
}
