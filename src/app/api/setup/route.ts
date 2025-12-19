import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST() {
  try {
    // Step 1: Create extensions
    console.log('Creating extensions...');
    await query('CREATE EXTENSION IF NOT EXISTS pg_textsearch');
    
    // Step 2: Drop existing table if it exists
    console.log('Dropping existing table...');
    await query('DROP TABLE IF EXISTS documents CASCADE');
    
    // Step 3: Create documents table
    console.log('Creating documents table...');
    await query(`
      CREATE TABLE documents (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        word_count INTEGER,
        search_vector tsvector
      )
    `);
    
    // Step 4: Insert sample documents designed to highlight search problems
    console.log('Inserting sample documents...');
    
    const documents = [
      // EXCELLENT DOCUMENT - Should rank #1 for "database connection pooling"
      // Short, focused, highly relevant
      {
        title: 'Connection Pooling Best Practices',
        content: `Connection pooling is essential for database performance. A connection pool maintains 
a cache of database connections that can be reused. This eliminates the overhead of establishing 
new connections for each request. Configure your pool size based on your workload. 
Most applications need 10-20 connections. Monitor pool usage and adjust accordingly.
Idle connections should be cleaned up to free resources.`,
        category: 'best-practices',
      },
      
      // KEYWORD STUFFED SPAM - Should NOT rank high
      // Repeats "database" excessively but isn't about pooling
      {
        title: 'Database Database Database Guide',
        content: `Database database database. This database article about database topics covers database 
fundamentals. Database management is important. Database systems store data in database tables. 
Database database database database. Every database needs database administrators. 
Database performance depends on database design. Database database database.
Our database company offers database services for your database needs.`,
        category: 'spam',
      },
      
      // LONG BUT MEDIOCRE - Tests length normalization
      // Very long document that mentions topics but isn't focused
      {
        title: 'Complete Enterprise Software Architecture Manual',
        content: `This comprehensive guide covers every aspect of enterprise software architecture. 
Chapter 1: Introduction to software systems. Software is important for businesses. 
Chapter 2: Hardware considerations. Servers need proper cooling and power.
Chapter 3: Networking basics. Networks connect computers together using various protocols.
Chapter 4: Database overview. Databases store information. There are many database types.
Chapter 5: Security fundamentals. Security protects systems from unauthorized access.
Chapter 6: Performance topics. Performance is about speed. Connection management matters.
Chapter 7: Scalability patterns. Systems need to scale as usage grows over time.
Chapter 8: Monitoring approaches. Monitor your systems to detect issues early.
Chapter 9: Deployment strategies. Deploy code carefully using proper procedures.
Chapter 10: Maintenance procedures. Regular maintenance keeps systems running smoothly.
Chapter 11: Troubleshooting guide. When issues occur, investigate systematically.
Chapter 12: Best practices summary. Follow industry best practices for success.
This manual provides a complete foundation for enterprise architecture decisions.
Pool your resources effectively for optimal system utilization across the organization.`,
        category: 'general',
      },
      
      // GOOD DOCUMENT - About pooling but more technical
      {
        title: 'PostgreSQL Connection Pool Configuration',
        content: `Configure PgBouncer for PostgreSQL connection pooling. Set pool_mode to transaction 
for best performance. The max_client_conn setting limits total connections. 
Default_pool_size controls connections per database/user pair. Reserve_pool_size 
handles traffic spikes. Set server_idle_timeout to close idle backend connections.
Enable logging to monitor pool health and connection patterns.`,
        category: 'tutorial',
      },
      
      // ANOTHER SPAM - More keyword stuffing
      {
        title: 'Database Solutions for Database Problems',
        content: `Database solutions for all your database problems. Database database database.
Our database experts handle database issues. Database optimization is our specialty.
Database migrations, database backups, database recovery - we do it all.
Database database database. Contact us for database consulting services.
Professional database services from certified database administrators.`,
        category: 'spam',
      },
      
      // RELEVANT BUT MISSES ONE TERM - Tests boolean brittleness
      // Great content about connection pools but doesn't use "database"
      {
        title: 'Application Pool Management Guide',
        content: `Managing connection pools effectively improves application performance significantly.
Pools reduce latency by reusing existing connections instead of creating new ones.
Set minimum and maximum pool sizes based on your traffic patterns.
Connection validation ensures pools contain healthy connections only.
Implement proper timeout settings to handle connection failures gracefully.
Monitor pool metrics like active connections, wait times, and checkout rates.`,
        category: 'tutorial',
      },
      
      // GOOD ABOUT PERFORMANCE
      {
        title: 'Query Performance Optimization Techniques',
        content: `Optimize your queries for better performance. Use EXPLAIN ANALYZE to understand 
query plans. Create appropriate indexes for your access patterns. Avoid SELECT * 
and only fetch needed columns. Use parameterized queries to benefit from plan caching.
Consider partial indexes for filtered queries. Monitor slow query logs regularly.
Performance tuning requires understanding your specific workload characteristics.`,
        category: 'performance',
      },
      
      // GOOD ABOUT INDEX MAINTENANCE
      {
        title: 'PostgreSQL Index Maintenance with VACUUM',
        content: `Regular index maintenance keeps your database performing well. VACUUM removes 
dead tuples and frees space. ANALYZE updates statistics for the query planner.
REINDEX rebuilds corrupted or bloated indexes. Schedule maintenance during 
low-traffic periods. Monitor bloat using pg_stat_user_tables. Autovacuum handles
most maintenance automatically but manual intervention may be needed for large tables.`,
        category: 'maintenance',
      },
      
      // GOOD ABOUT TUNING
      {
        title: 'PostgreSQL Query Tuning Fundamentals',
        content: `Master PostgreSQL query tuning for optimal performance. Start with EXPLAIN 
to see the query plan. Look for sequential scans on large tables. Add indexes 
to support your queries. Tune work_mem for complex sorts and joins. 
Adjust shared_buffers based on available memory. Use connection pooling to 
handle many concurrent clients efficiently. Profile before and after changes.`,
        category: 'performance',
      },
      
      // ANOTHER DOCUMENT - About general database
      {
        title: 'Introduction to Relational Databases',
        content: `Relational databases organize data into tables with rows and columns.
SQL provides a standard language for querying and manipulating data.
Tables can be joined using foreign key relationships. Indexes speed up queries.
Transactions ensure data consistency with ACID properties. Normalization 
reduces data redundancy. Proper schema design is crucial for performance.`,
        category: 'fundamentals',
      },
    ];
    
    for (const doc of documents) {
      const wordCount = doc.content.split(/\s+/).length;
      await query(
        `INSERT INTO documents (title, content, category, word_count, search_vector)
         VALUES ($1, $2, $3, $4, to_tsvector('english', $1 || ' ' || $2))`,
        [doc.title, doc.content, doc.category, wordCount]
      );
    }
    
    // Step 5: Create GIN index for native full-text search
    console.log('Creating GIN index...');
    await query('CREATE INDEX docs_search_idx ON documents USING GIN(search_vector)');
    
    // Step 6: Create BM25 index using pg_textsearch
    console.log('Creating BM25 index...');
    await query(`CREATE INDEX docs_bm25_idx ON documents USING bm25(content)`);
    
    // Verify setup
    const countResult = await query('SELECT COUNT(*) as count FROM documents');
    const indexResult = await query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'documents'
    `);
    
    return NextResponse.json({
      success: true,
      message: 'Database setup complete!',
      documentCount: countResult.rows[0].count,
      indexes: indexResult.rows,
    });
    
  } catch (error) {
    console.error('Setup error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'POST to this endpoint to setup the database',
    warning: 'This will drop and recreate the documents table',
  });
}

