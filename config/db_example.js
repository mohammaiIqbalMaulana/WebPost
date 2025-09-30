const mysql = require('mysql2');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'username database anda',
  password: 'password database anda',
  database: 'nama database anda',
  timezone: '+07:00'
});

module.exports = pool.promise();
