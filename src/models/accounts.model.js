import { DataTypes } from 'sequelize';

import sequelize from './orm';

const Accounts = sequelize.define('accounts', {
  id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: DataTypes.INTEGER,
  },
  email: {
    allowNull: false,
    type: DataTypes.TEXT,
  },
  password: {
    allowNull: true,
    type: DataTypes.TEXT,
  },
  created: {
    allowNull: true,
    type: DataTypes.BIGINT,
  },
  last_ping: {
    allowNull: true,
    type: DataTypes.BIGINT,
  },
  '2fa_token': {
    allowNull: true,
    type: DataTypes.TEXT,
  },
  admin: {
    allowNull: true,
    type: DataTypes.BOOLEAN,
  },
  email_verify_token: {
    allowNull: true,
    type: DataTypes.TEXT,
  },
  g_oauth_sub: {
    allowNull: true,
    type: DataTypes.TEXT,
  },
  two_factor_enabled: {
    allowNull: true,
    type: DataTypes.BOOLEAN,
  },
  research_enabled: {
    allowNull: false,
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  timestamps: false,
});

export default Accounts;
