
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config();

const dbConfig = {
  connectionString: process.env.DB_CONNECTION_STRING,
};

const pool = new Pool(dbConfig);

module.exports = pool;
