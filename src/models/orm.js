import { Sequelize } from 'sequelize';

const sequelize = new Sequelize({
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME || 'retro-pilot',
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 5432,
  dialect: 'postgres',
});

sequelize.options.logging = () => {};

/**
 * Synchronise the database (create new tables) to match the models defined
 * above.
 *
 * WARNING: If force is set, sequelize will delete columns and create new ones
 *          if their types have changed!
 *          Use sequelize-cli and migrations instead!
 */
sequelize.sync({ force: process.env.DB_FORCE_SYNC });

export default sequelize;
