#!/usr/bin/env node

/**
 * BM25 Demo Database Setup Script
 * 
 * This script sets up the complete database for the BM25 demo:
 * 1. Creates the documents table
 * 2. Enables required extensions (pg_textsearch, vectorscale)
 * 3. Inserts sample documents
 * 4. Generates OpenAI embeddings for all documents
 * 5. Creates BM25 and DiskANN indexes
 * 
 * Required environment variables (from .env.local):
 * - DATABASE_URL: PostgreSQL connection string
 * - OPENAI_API_KEY: OpenAI API key for generating embeddings
 * 
 * Usage: node scripts/setup-database.js
 */

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

// Load environment variables from .env.local
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    });
    console.log('✓ Loaded environment from .env.local\n');
  } else {
    console.error('❌ .env.local file not found!');
    console.error('   Please create .env.local with DATABASE_URL and OPENAI_API_KEY');
    process.exit(1);
  }
}

loadEnv();

// Validate required environment variables
const DATABASE_URL = process.env.DATABASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set in .env.local');
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY is not set in .env.local');
  process.exit(1);
}

// Remove sslmode from URL for pg module
const connectionString = DATABASE_URL.replace(/\?sslmode=require$/, '');

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

// ============================================================================
// SAMPLE DOCUMENTS DATA
// ============================================================================

// ============================================================================
// DOCUMENT DESIGN STRATEGY:
// 
// For agent queries to show Hybrid winning:
// 1. Native should FAIL (Boolean AND + missing keywords)
// 2. BM25 should find PARTIAL matches (keywords only)
// 3. Vector should find SEMANTIC matches (meaning only)
// 4. Hybrid should find the BEST answer (has BOTH keywords AND meaning)
//
// Key: Create docs where the BEST answer has both keyword AND semantic signals
// ============================================================================

const DOCUMENTS = [
  // === CONNECTION POOLING DOCS ===
  {
    title: "Database Connection Pooling Guide",
    content: "Database connection pooling improves application performance. A pool maintains reusable connections. Configure pool size based on workload. Monitor connection usage regularly.",
    category: "tutorial"
  },
  {
    title: "PgBouncer Configuration",
    content: "PgBouncer manages database connection pooling efficiently. Install PgBouncer on your server. Configure pooling mode: session, transaction, or statement. Set max_client_conn appropriately.",
    category: "tutorial"
  },
  {
    title: "Connection Pool Troubleshooting Guide",
    // BEST for "fix connection pool problems" - has troubleshooting context + connection pool keywords
    content: "Troubleshoot connection pool issues effectively. Common problems include pool exhaustion, connection leaks, and timeout errors. Monitor active connections. Check for connection leaks in application code. Increase pool size if needed.",
    category: "troubleshooting"
  },
  {
    title: "Scaling Web Applications",
    // Semantic about high-traffic but doesn't use "pooling" much
    content: "Scale your web application for high traffic. Use load balancers. Implement caching strategies. Database connections should be managed efficiently to prevent bottlenecks under load.",
    category: "architecture"
  },

  // === PERFORMANCE DOCS ===
  {
    title: "EXPLAIN ANALYZE Quick Tip",
    // SHORT doc (15 words) - focused on EXPLAIN, for length normalization demo
    content: "Use EXPLAIN ANALYZE to find slow PostgreSQL queries. Shows execution plan and actual timing.",
    category: "tip"
  },
  {
    title: "Complete PostgreSQL Query Tuning Guide",
    // LONG doc (80+ words) - comprehensive, many keyword occurrences
    // For length normalization demo: more total keyword occurrences than short doc
    content: "This comprehensive PostgreSQL guide covers query tuning and optimization. PostgreSQL query performance depends on proper use of EXPLAIN and EXPLAIN ANALYZE. Run EXPLAIN ANALYZE on slow queries. The EXPLAIN output shows the query planner decisions. PostgreSQL indexing improves query speed. Use EXPLAIN to verify index usage. ANALYZE updates PostgreSQL statistics. Monitor PostgreSQL query performance with pg_stat_statements. This PostgreSQL tuning guide helps optimize database queries.",
    category: "reference"
  },
  {
    title: "Query Performance Optimization",
    // For agent query "why are my queries slow" - semantic match, no direct keyword match
    content: "Improve slow database response times through optimization techniques. Proper indexing reduces query latency significantly. Use EXPLAIN to identify bottlenecks. Query caching helps with repeated operations. Monitor and tune regularly for best performance.",
    category: "performance"
  },
  {
    title: "Index Optimization Strategies",
    // Good for optimization but not specifically about "speed"
    content: "Optimize database indexes for better query performance. Create indexes on frequently filtered columns. Use composite indexes for multi-column queries. Remove unused indexes to speed up writes.",
    category: "performance"
  },

  // === SECURITY DOCS ===
  {
    title: "PostgreSQL Authentication Setup",
    // Has auth keywords but not "secure" or "protect"
    content: "Set up PostgreSQL authentication methods. Configure pg_hba.conf for password, certificate, and LDAP authentication. Manage user roles and permissions. Enable SSL for encrypted client connections.",
    category: "security"
  },
  {
    title: "Protecting Database Access",
    // BEST for "secure my postgres" - has "protect" (semantic to secure) + SSL/auth keywords
    content: "Protect your PostgreSQL database from unauthorized access. Implement strong authentication. Use SSL certificates for encrypted connections. Configure firewall rules. Enable audit logging for security monitoring.",
    category: "security"
  },
  {
    title: "Database Encryption Guide",
    // About encryption but not about auth/access
    content: "Encrypt sensitive data in your database. Use column-level encryption for PII. Implement transparent data encryption. Manage encryption keys securely. Comply with data protection regulations.",
    category: "security"
  },

  // === TF SATURATION DEMO ===
  {
    title: "SEO Spam: Performance Tips",
    // KEYWORD STUFFED - repeats "performance" many times (10x)
    // BM25's k1 saturation prevents this from dominating results
    content: "Performance performance performance. Database performance performance. Improve performance performance performance. Performance optimization performance tips.",
    category: "spam"
  },

  // === GENERAL/REFERENCE DOCS ===
  {
    title: "Database Fundamentals",
    content: "Database fundamentals every developer should know. Database design principles. Normalization techniques. Basic indexing strategies. Introduction to SQL queries.",
    category: "tutorial"
  },
  {
    title: "PostgreSQL Administration Handbook",
    content: "Comprehensive PostgreSQL administration guide. Covers installation, configuration, backup strategies, replication setup, monitoring solutions, and maintenance tasks for production deployments.",
    category: "reference"
  },
  {
    title: "PostgreSQL vs MySQL Comparison",
    content: "Comparing PostgreSQL and MySQL databases. PostgreSQL offers better standards compliance and advanced features. MySQL has wider hosting support. Both support replication and high availability.",
    category: "comparison"
  },

];

// ============================================================================
// OPENAI EMBEDDING FUNCTION
// ============================================================================

async function getOpenAIEmbedding(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text
    })
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(`OpenAI API error: ${data.error.message}`);
  }
  return data.data[0].embedding;
}

// ============================================================================
// SETUP FUNCTIONS
// ============================================================================

async function dropExistingTables() {
  console.log('Step 1: Dropping existing tables...');
  try {
    await pool.query('DROP TABLE IF EXISTS documents CASCADE');
    console.log('  ✓ Dropped documents table\n');
  } catch (e) {
    console.log(`  Note: ${e.message}\n`);
  }
}

async function enableExtensions() {
  console.log('Step 2: Enabling required extensions...');
  
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_textsearch');
    console.log('  ✓ pg_textsearch enabled');
  } catch (e) {
    console.log(`  ⚠ pg_textsearch: ${e.message}`);
  }

  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS vectorscale CASCADE');
    console.log('  ✓ vectorscale enabled (includes pgvector)');
  } catch (e) {
    console.log(`  ⚠ vectorscale: ${e.message}`);
  }
  
  console.log('');
}

async function createTable() {
  console.log('Step 3: Creating documents table...');
  
  await pool.query(`
    CREATE TABLE documents (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT,
      word_count INTEGER,
      search_vector TSVECTOR,
      full_text TEXT GENERATED ALWAYS AS (title || ' ' || content) STORED,
      embedding VECTOR(1536)
    )
  `);
  console.log('  ✓ Created documents table\n');
}

async function insertDocuments() {
  console.log('Step 4: Inserting sample documents...');
  
  for (const doc of DOCUMENTS) {
    const wordCount = (doc.title + ' ' + doc.content).split(/\s+/).length;
    
    await pool.query(`
      INSERT INTO documents (title, content, category, word_count, search_vector)
      VALUES ($1, $2, $3, $4, to_tsvector('english', $1 || ' ' || $2))
    `, [doc.title, doc.content, doc.category, wordCount]);
    
    console.log(`  ✓ Inserted: "${doc.title}"`);
  }
  console.log(`  ✓ Inserted ${DOCUMENTS.length} documents total\n`);
}

async function generateEmbeddings() {
  console.log('Step 5: Generating OpenAI embeddings...');
  console.log('  (Using text-embedding-3-small model, 1536 dimensions)\n');
  
  const docs = await pool.query('SELECT id, title, full_text FROM documents ORDER BY id');
  
  for (const doc of docs.rows) {
    process.stdout.write(`  ${doc.id}. "${doc.title}"... `);
    
    try {
      const embedding = await getOpenAIEmbedding(doc.full_text);
      
      await pool.query(
        'UPDATE documents SET embedding = $1 WHERE id = $2',
        [`[${embedding.join(',')}]`, doc.id]
      );
      
      console.log('✓');
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
    
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('');
}

async function createIndexes() {
  console.log('Step 6: Creating search indexes...');
  
  // GIN index for native PostgreSQL full-text search
  console.log('  Creating GIN index for native search...');
  await pool.query(`
    CREATE INDEX idx_documents_search ON documents USING GIN(search_vector)
  `);
  console.log('  ✓ GIN index created');
  
  // BM25 index for pg_textsearch
  console.log('  Creating BM25 index for pg_textsearch...');
  try {
    await pool.query(`
      CREATE INDEX idx_documents_bm25 ON documents 
      USING bm25(full_text) WITH (text_config='english')
    `);
    console.log('  ✓ BM25 index created');
  } catch (e) {
    console.log(`  ⚠ BM25 index: ${e.message}`);
  }
  
  // DiskANN index for vector search (pgvectorscale)
  console.log('  Creating DiskANN index for vector search...');
  try {
    await pool.query(`
      CREATE INDEX idx_documents_embedding ON documents 
      USING diskann(embedding)
    `);
    console.log('  ✓ DiskANN index created');
  } catch (e) {
    // Fallback to HNSW if DiskANN not available
    console.log(`  ⚠ DiskANN failed, trying HNSW fallback...`);
    try {
      await pool.query(`
        CREATE INDEX idx_documents_embedding ON documents 
        USING hnsw(embedding vector_cosine_ops)
      `);
      console.log('  ✓ HNSW index created (fallback)');
    } catch (e2) {
      console.log(`  ⚠ Vector index: ${e2.message}`);
    }
  }
  
  console.log('');
}

async function verifySetup() {
  console.log('Step 7: Verifying setup...\n');
  
  // Count documents
  const countResult = await pool.query('SELECT COUNT(*) as count FROM documents');
  console.log(`  Documents: ${countResult.rows[0].count}`);
  
  // Check embeddings
  const embResult = await pool.query(`
    SELECT COUNT(*) as count, 
           AVG(vector_dims(embedding)) as avg_dims
    FROM documents 
    WHERE embedding IS NOT NULL
  `);
  console.log(`  Embeddings: ${embResult.rows[0].count} (${embResult.rows[0].avg_dims} dimensions)`);
  
  // Check indexes
  const indexResult = await pool.query(`
    SELECT indexname FROM pg_indexes WHERE tablename = 'documents'
  `);
  console.log(`  Indexes: ${indexResult.rows.map(r => r.indexname).join(', ')}`);
  
  // Test BM25 search
  console.log('\n  Testing BM25 search for "connection pooling"...');
  try {
    const bm25Result = await pool.query(`
      SELECT title, -(full_text <@> to_bm25query('connection pooling', 'idx_documents_bm25')) as score
      FROM documents
      ORDER BY full_text <@> to_bm25query('connection pooling', 'idx_documents_bm25')
      LIMIT 3
    `);
    bm25Result.rows.forEach((r, i) => {
      console.log(`    ${i+1}. "${r.title}" (score: ${parseFloat(r.score).toFixed(4)})`);
    });
  } catch (e) {
    console.log(`    ⚠ BM25 test failed: ${e.message}`);
  }
  
  // Test vector search
  console.log('\n  Testing vector search for "secure login methods"...');
  try {
    const queryEmb = await getOpenAIEmbedding('secure login methods');
    const vecResult = await pool.query(`
      SELECT title, 1 - (embedding <=> $1::vector) as similarity
      FROM documents
      ORDER BY embedding <=> $1::vector
      LIMIT 3
    `, [`[${queryEmb.join(',')}]`]);
    vecResult.rows.forEach((r, i) => {
      console.log(`    ${i+1}. "${r.title}" (similarity: ${(parseFloat(r.similarity) * 100).toFixed(1)}%)`);
    });
  } catch (e) {
    console.log(`    ⚠ Vector test failed: ${e.message}`);
  }
  
  console.log('');
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           BM25 Demo Database Setup Script                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);
  console.log(`OpenAI Key: ${OPENAI_API_KEY.substring(0, 10)}...${OPENAI_API_KEY.slice(-4)}\n`);
  
  try {
    await dropExistingTables();
    await enableExtensions();
    await createTable();
    await insertDocuments();
    await generateEmbeddings();
    await createIndexes();
    await verifySetup();
    
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    ✅ Setup Complete!                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log('You can now run the demo app with: npm run dev\n');
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

main();

