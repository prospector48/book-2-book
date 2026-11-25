const config = require('./config');
const app = require('./app');
const db = require('./db');

db.query('SELECT 1')
  .then(() => {
    app.listen(config.port, () => console.log(`BookLoop API running on http://localhost:${config.port}`));
  })
  .catch((e) => {
    console.error('Cannot connect to the database:', e.message);
    process.exit(1);
  });
