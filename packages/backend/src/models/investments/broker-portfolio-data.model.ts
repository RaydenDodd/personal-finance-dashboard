import type { BrokerData } from '@services/investments/broker-records/schema';
import { Table, Column, Model, DataType, PrimaryKey, ForeignKey } from 'sequelize-typescript';

import Portfolios from './portfolios.model';

@Table({ tableName: 'BrokerPortfolioData', timestamps: true })
export default class BrokerPortfolioData extends Model {
  @PrimaryKey
  @ForeignKey(() => Portfolios)
  @Column({ type: DataType.UUID, allowNull: false })
  declare portfolioId: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare data: BrokerData;
}
