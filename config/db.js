const mysql = require('mysql2');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'webpost',
  timezone: '+07:00'
});

module.exports = pool.promise();
