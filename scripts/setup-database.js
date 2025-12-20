#!/usr/bin/env node

/**
 * BM25 Demo Database Setup Script
 * 
 * This script sets up the complete database for the BM25 demo:
 * 1. Creates the documents table
 * 2. Enables required extensions (pg_textsearch, vectorscale)
 * 3. Reads documents from data/documents/ folder
 * 4. Inserts documents into the database
 * 5. Generates OpenAI embeddings for all documents
 * 6. Creates BM25 and DiskANN indexes
 * 
 * Required environment variables (from .env.local):
 * - DATABASE_URL: PostgreSQL connection string
 * - OPENAI_API_KEY: OpenAI API key for generating embeddings
 * 
 * Usage: node scripts/setup-database.js
 * 
 * To add your own documents:
 * 1. Create a new .md file in data/documents/
 * 2. Add frontmatter with title and category
 * 3. Add your content after the frontmatter
 * 4. Run this script to reload all documents
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
// DOCUMENT LOADING FROM FILES
// ============================================================================

/**
 * Parse a markdown file with YAML frontmatter
 * Format:
 * ---
 * title: Document Title
 * category: category-name
 * ---
 * 
 * Document content goes here...
 */
function parseMarkdownFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  
  // Check for frontmatter
  if (!content.startsWith('---')) {
    throw new Error(`File ${filePath} is missing frontmatter`);
  }
  
  // Find the end of frontmatter
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    throw new Error(`File ${filePath} has invalid frontmatter (missing closing ---)`);
  }
  
  // Parse frontmatter
  const frontmatter = content.substring(3, endIndex).trim();
  const frontmatterLines = frontmatter.split('\n');
  const metadata = {};
  
  for (const line of frontmatterLines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      metadata[key] = value;
    }
  }
  
  // Get content after frontmatter
  const documentContent = content.substring(endIndex + 3).trim();
  
  if (!metadata.title) {
    throw new Error(`File ${filePath} is missing required 'title' in frontmatter`);
  }
  
  return {
    title: metadata.title,
    content: documentContent,
    category: metadata.category || 'general',
    sourceFile: path.basename(filePath)
  };
}

/**
 * Load all documents from the data/documents/ folder
 */
function loadDocumentsFromFolder() {
  const docsFolder = path.join(__dirname, '..', 'data', 'documents');
  
  if (!fs.existsSync(docsFolder)) {
    console.error(`❌ Documents folder not found: ${docsFolder}`);
    console.error('   Please create the folder and add .md files');
    process.exit(1);
  }
  
  const files = fs.readdirSync(docsFolder).filter(f => 
    f.endsWith('.md') && !f.toLowerCase().startsWith('readme')
  );
  
  if (files.length === 0) {
    console.error(`❌ No .md files found in ${docsFolder}`);
    process.exit(1);
  }
  
  console.log(`Found ${files.length} document files in data/documents/\n`);
  
  const documents = [];
  
  for (const file of files) {
    const filePath = path.join(docsFolder, file);
    try {
      const doc = parseMarkdownFile(filePath);
      documents.push(doc);
    } catch (e) {
      console.error(`  ⚠ Error parsing ${file}: ${e.message}`);
    }
  }
  
  return documents;
}

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

async function insertDocuments(documents) {
  console.log('Step 4: Inserting documents from files...');
  
  for (const doc of documents) {
    const wordCount = (doc.title + ' ' + doc.content).split(/\s+/).length;
    
    await pool.query(`
      INSERT INTO documents (title, content, category, word_count, search_vector)
      VALUES ($1, $2, $3, $4, to_tsvector('english', $1 || ' ' || $2))
    `, [doc.title, doc.content, doc.category, wordCount]);
    
    console.log(`  ✓ Inserted: "${doc.title}" (from ${doc.sourceFile})`);
  }
  console.log(`  ✓ Inserted ${documents.length} documents total\n`);
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
  
  // Load documents from files
  const documents = loadDocumentsFromFolder();
  
  if (documents.length === 0) {
    console.error('❌ No valid documents loaded');
    process.exit(1);
  }
  
  try {
    await dropExistingTables();
    await enableExtensions();
    await createTable();
    await insertDocuments(documents);
    await generateEmbeddings();
    await createIndexes();
    await verifySetup();
    
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    ✅ Setup Complete!                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log('You can now run the demo app with: npm run dev\n');
    console.log('To add your own documents:');
    console.log('  1. Create a new .md file in data/documents/');
    console.log('  2. Add frontmatter (title, category) and content');
    console.log('  3. Run: npm run setup\n');
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

main();
