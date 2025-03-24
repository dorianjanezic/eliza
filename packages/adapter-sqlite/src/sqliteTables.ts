export const sqliteTables = `
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

-- Table: accounts
CREATE TABLE IF NOT EXISTS "accounts" (
    "id" TEXT PRIMARY KEY,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT,
    "username" TEXT,
    "email" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "details" TEXT DEFAULT '{}' CHECK(json_valid("details")) -- Ensuring details is a valid JSON field
);

-- Table: memories
CREATE TABLE IF NOT EXISTS "memories" (
    "id" TEXT PRIMARY KEY,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "content" TEXT NOT NULL,
    "embedding" BLOB NOT NULL, -- TODO: EMBEDDING ARRAY, CONVERT TO BEST FORMAT FOR SQLITE-VSS (JSON?)
    "userId" TEXT,
    "roomId" TEXT,
    "agentId" TEXT,
    "unique" INTEGER DEFAULT 1 NOT NULL,
    FOREIGN KEY ("userId") REFERENCES "accounts"("id"),
    FOREIGN KEY ("roomId") REFERENCES "rooms"("id"),
    FOREIGN KEY ("agentId") REFERENCES "accounts"("id")
);

-- Table: goals
CREATE TABLE IF NOT EXISTS "goals" (
    "id" TEXT PRIMARY KEY,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "name" TEXT,
    "status" TEXT,
    "description" TEXT,
    "roomId" TEXT,
    "objectives" TEXT DEFAULT '[]' NOT NULL CHECK(json_valid("objectives")) -- Ensuring objectives is a valid JSON array
);

-- Table: logs
CREATE TABLE IF NOT EXISTS "logs" (
    "id" TEXT PRIMARY KEY,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "roomId" TEXT NOT NULL
);

-- Table: participants
CREATE TABLE IF NOT EXISTS "participants" (
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "roomId" TEXT,
    "userState" TEXT,
    "id" TEXT PRIMARY KEY,
    "last_message_read" TEXT,
    FOREIGN KEY ("userId") REFERENCES "accounts"("id"),
    FOREIGN KEY ("roomId") REFERENCES "rooms"("id")
);

-- Table: relationships
CREATE TABLE IF NOT EXISTS "relationships" (
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "userA" TEXT NOT NULL,
    "userB" TEXT NOT NULL,
    "status" "text",
    "id" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL,
    FOREIGN KEY ("userA") REFERENCES "accounts"("id"),
    FOREIGN KEY ("userB") REFERENCES "accounts"("id"),
    FOREIGN KEY ("userId") REFERENCES "accounts"("id")
);

-- Table: rooms
CREATE TABLE IF NOT EXISTS "rooms" (
    "id" TEXT PRIMARY KEY,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: cache
CREATE TABLE IF NOT EXISTS "cache" (
    "key" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "value" TEXT DEFAULT '{}' CHECK(json_valid("value")),
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP,
    PRIMARY KEY ("key", "agentId")
);

-- Table: tokens
CREATE TABLE IF NOT EXISTS tokens (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    metadata TEXT,
    processedAt INTEGER NOT NULL,
    agentId TEXT NOT NULL,
    FOREIGN KEY(agentId) REFERENCES accounts(id)
);

-- Table: token_data
CREATE TABLE IF NOT EXISTS "token_data" (
    "id" TEXT PRIMARY KEY,
    "tokenId" TEXT NOT NULL,
    "timestamp" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "address" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" REAL,
    "marketCap" REAL NOT NULL,
    "holderCount" INTEGER,
    "volume1hUSD" REAL,
    "volume24hUSD" REAL,
    "priceChange1h" REAL,
    "priceChange24h" REAL,
    "uniqueTraders1h" INTEGER,
    "trades1h" INTEGER,
    "topHolderPercent" REAL,
    "topHolders" TEXT CHECK(json_valid("topHolders")),
    "suspiciousDistribution" INTEGER,
    "totalBundles" INTEGER,
    "totalSolSpent" REAL,
    "currentHeldPercentage" REAL,
    "totalBundledPercentage" REAL,
    "ohlcvData" TEXT CHECK(json_valid("ohlcvData")),
    "twitterSentiment" TEXT CHECK(json_valid("twitterSentiment")),
    "currentPrediction" TEXT CHECK(json_valid("currentPrediction")),
    "checkNumber" INTEGER,
    "isInitialCheck" INTEGER DEFAULT 0,
    "checkType" TEXT,
    "predictionResultId" TEXT,
    "tradeId" TEXT,
    "entryPrice" REAL,
    "entryTime" TIMESTAMP,
    "exitPrice" REAL,
    "exitTime" TIMESTAMP,
    "profitLoss" REAL,
    "profitLossPercent" REAL,
    "agentId" TEXT NOT NULL,
    FOREIGN KEY ("agentId") REFERENCES "accounts"("id")
);

-- Index: relationships_id_key
CREATE UNIQUE INDEX IF NOT EXISTS "relationships_id_key" ON "relationships" ("id");

-- Index: memories_id_key
CREATE UNIQUE INDEX IF NOT EXISTS "memories_id_key" ON "memories" ("id");

-- Index: participants_id_key
CREATE UNIQUE INDEX IF NOT EXISTS "participants_id_key" ON "participants" ("id");

-- Index: tokens_token
CREATE INDEX IF NOT EXISTS idx_tokens_token ON tokens(token);

-- Index: tokens_agent
CREATE INDEX IF NOT EXISTS idx_tokens_agent ON tokens(agentId);

-- Index: token_data_tokenId
CREATE INDEX IF NOT EXISTS "idx_token_data_tokenId" ON "token_data" ("tokenId");

-- Index: token_data_timestamp
CREATE INDEX IF NOT EXISTS "idx_token_data_timestamp" ON "token_data" ("timestamp");

-- Index: token_data_address
CREATE INDEX IF NOT EXISTS "idx_token_data_address" ON "token_data" ("address");

-- Index: token_data_checkType
CREATE INDEX IF NOT EXISTS "idx_token_data_checkType" ON "token_data" ("checkType");

COMMIT;`;
