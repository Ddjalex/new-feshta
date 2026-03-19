const db = require('./config/db');

(async () => {
  try {
    const res = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position");
    console.log('users columns:', res.rows.map(r => r.column_name).join(', '));
  } catch (e) {
    console.error('QUERY ERR', e.message);
  }
})();