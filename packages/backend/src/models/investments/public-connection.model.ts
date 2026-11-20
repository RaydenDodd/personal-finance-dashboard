import { Table, Column, Model, DataType, PrimaryKey, ForeignKey } from 'sequelize-typescript';

import Users from '../users.model';

// Credentials deliberately live outside portfolios and their public serializers.
@Table({ tableName: 'PublicPortfolioConnections', timestamps: true })
export default class PublicPortfolioConnection extends Model {
  @PrimaryKey
  @ForeignKey(() => Users)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare userId: number;
  @Column({ type: DataType.TEXT, allowNull: false })
  declare encryptedCredentials: string;
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare active: boolean;
  @Column({ type: DataType.DATE, allowNull: true })
  declare lastSyncAt: Date | null;
  @Column({ type: DataType.STRING, allowNull: true })
  declare lastError: string | null;
}
