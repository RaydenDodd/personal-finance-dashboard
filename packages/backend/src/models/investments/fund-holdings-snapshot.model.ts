import type { InvestmentFundSnapshot } from '@bt/shared/types/investment-analytics';
import { Column, DataType, ForeignKey, Model, PrimaryKey, Table } from 'sequelize-typescript';

import Users from '../users.model';

export interface CompositionImportAttempt {
  kind: 'import-attempt';
  fundId: string;
  symbol: string;
  sourceId: string;
  sourceUrl?: string;
  attemptedAt: string;
  status: 'imported' | 'duplicate' | 'quarantined' | 'failed';
  error?: string;
  sha256?: string;
  rawSourceGzipBase64?: string;
  asOf?: string;
  rows?: number;
  coverage?: string;
  refresh?: boolean;
  refreshOrigin?: 'on-demand' | 'scheduled';
}
export interface CompositionRefreshConfiguration {
  kind: 'refresh-configuration';
  enabled: boolean;
  contact: string;
  updatedAt: string;
}

/** Separate analytical composition data; never changes investment/account records. */
@Table({ tableName: 'InvestmentFundSnapshots', timestamps: true })
export default class InvestmentFundSnapshots extends Model {
  @PrimaryKey @Column({ type: DataType.STRING(64) }) declare id: string;
  @ForeignKey(() => Users) @Column({ type: DataType.INTEGER, allowNull: false }) declare userId: number;
  @Column({ type: DataType.JSONB, allowNull: false }) declare data:
    | InvestmentFundSnapshot
    | CompositionImportAttempt
    | CompositionRefreshConfiguration;
}
