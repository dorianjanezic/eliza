// Migration script to add trade-related columns to token_data table
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Use the known database location
const dbPath = path.join(__dirname, 'agent', 'data', 'db.sqlite');

if (!fs.existsSync(dbPath)) {
  console.error(`Database file not found at ${dbPath}`);
  console.log('Please specify the correct path to your database file');
  process.exit(1);
}

console.log(`Running migration on database at: ${dbPath}`);

// Open the database
const db = new Database(dbPath);

// Start a transaction
db.exec('BEGIN TRANSACTION;');

try {
  // Check if columns already exist to avoid errors
  const tableInfo = db.prepare("PRAGMA table_info(token_data);").all();
  const columnNames = tableInfo.map(col => col.name);

  // Add each new column if it doesn't already exist
  const newColumns = [
    { name: 'tradeId', type: 'TEXT' },
    { name: 'entryPrice', type: 'REAL' },
    { name: 'entryTime', type: 'TIMESTAMP' },
    { name: 'exitPrice', type: 'REAL' },
    { name: 'exitTime', type: 'TIMESTAMP' },
    { name: 'profitLoss', type: 'REAL' },
    { name: 'profitLossPercent', type: 'REAL' }
  ];

  // Add columns that don't exist yet
  for (const column of newColumns) {
    if (!columnNames.includes(column.name)) {
      console.log(`Adding column: ${column.name}`);
      db.exec(`ALTER TABLE token_data ADD COLUMN ${column.name} ${column.type};`);
    } else {
      console.log(`Column ${column.name} already exists, skipping`);
    }
  }

  // Commit the transaction
  db.exec('COMMIT;');
  console.log('Migration completed successfully');
} catch (error) {
  // Rollback on error
  db.exec('ROLLBACK;');
  console.error('Migration failed:', error.message);
}

// Close the database connection
db.close();
