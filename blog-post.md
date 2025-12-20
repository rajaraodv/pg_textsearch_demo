# Stop Running Elasticsearch. Just Use Postgres.

You want good search. So you're evaluating Elasticsearch. Or Algolia. Or Typesense. You're about to spin up another cluster, write data sync pipelines, and add one more thing to your on-call rotation.

**Stop.**

You already have Postgres. And now Postgres has BM25.

BM25 is the ranking algorithm behind Elasticsearch, Solr, Lucene, and virtually every production search system. It's also the retrieval backbone of modern AI: LangChain, LlamaIndex, Cohere Rerank, and most RAG pipelines use BM25 for first-stage retrieval before reranking. When AI search tools like Perplexity or ChatGPT with browsing fetch documents, BM25 is doing the heavy lifting.

```sql
CREATE EXTENSION pg_textsearch;
CREATE INDEX ON articles USING bm25(content);

SELECT * FROM articles 
ORDER BY content <@> to_bm25query('database performance')
LIMIT 10;
```

That's it. Google-quality search ranking. In your existing database. No new infrastructure.

---

## "But Native Postgres Search Sucks"

You're right. It does. Let me show you why.

Say you have these documents:

```
📄 Database Connection Pooling Guide
   "Database connection pooling improves application performance. A pool 
   maintains reusable connections. Configure pool size based on workload."

📄 Database Fundamentals
   "Database fundamentals every developer should know. Database design 
   principles. Normalization techniques. Basic indexing strategies."

📄 PostgreSQL Authentication Setup  
   "Set up PostgreSQL database authentication methods. Configure pg_hba.conf 
   for password, certificate, and LDAP authentication. Manage user roles."

📄 Generic Blog Post (spam)
   "Database database database. Learn about database. Database is important. 
   Database database database. More database info. Database database database."

📄 EXPLAIN ANALYZE Quick Tip (15 words)
   "Use EXPLAIN ANALYZE to find slow PostgreSQL queries. Shows execution 
   plan and actual timing."

📄 Complete PostgreSQL Query Tuning Guide (80 words)
   "This comprehensive PostgreSQL guide covers query tuning and optimization. 
   PostgreSQL query performance depends on proper use of EXPLAIN and EXPLAIN 
   ANALYZE. Run EXPLAIN ANALYZE on slow queries. The EXPLAIN output shows the 
   query planner decisions. PostgreSQL indexing improves query speed..."
```

Now watch what happens with different searches:

### Problem 1: Keyword Stuffing Wins

**Search:** `database`

| Native Postgres | BM25 |
|-----------------|------|
| #1: Generic Blog Post (12 mentions!) | #1: Connection Pooling Guide |
| #2: Connection Pooling Guide | #2: Database Fundamentals |
| #3: Database Fundamentals | #3: Generic Blog Post (pushed down) |

Native counts keywords. More = better. BM25 applies **term frequency saturation**: after a few mentions, additional repetitions barely help. Spam loses.

### Problem 2: Common Words Dominate

**Search:** `database authentication`

Native treats both words equally. But "database" appears in 10+ docs. It tells you nothing. "Authentication" appears in only 1 doc. That's the signal.

BM25 uses **Inverse Document Frequency (IDF)**. Rare terms get higher weight. The authentication doc jumps to #1 because "authentication" is the discriminating term.

### Problem 3: Long Docs Always Win

**Search:** `EXPLAIN ANALYZE`

| Native Postgres | BM25 |
|-----------------|------|
| #1: Complete Tuning Guide (8 mentions) | #1: Quick EXPLAIN Tip |
| #2: Quick EXPLAIN Tip (2 mentions) | #2: Complete Tuning Guide |

The long guide has more keyword matches, so native ranks it higher. But the short tip is *entirely* about EXPLAIN ANALYZE. It's a better result. BM25 uses **length normalization** to fix this.

### Problem 4: All-or-Nothing Matching

**Search:** `database connection pooling`

Native Postgres uses Boolean AND by default (`plainto_tsquery`). Only docs with ALL three terms match. Result: 2 documents.

You could switch to OR (`to_tsquery` with `|`). Now you get 13 results. But:
- Rankings become flat (many docs score identical 0.02)
- Spam still ranks in the middle
- Hard to tell relevant from irrelevant

BM25 does **ranked retrieval** properly. Every doc gets a meaningful score based on how well it matches. Docs with 2 of 3 terms rank lower than docs with all 3, but they still appear with differentiated scores.

---

## What About Semantic Search?

BM25 handles keywords. For meaning, you need vectors.

Here's the thing: **the best AI retrieval systems use both.** Pure vector search misses exact matches. Pure keyword search misses synonyms. Hybrid search wins.

This is why LangChain's `EnsembleRetriever` combines BM25 + vectors. Why Cohere recommends BM25 first-stage retrieval before reranking. Why Anthropic and OpenAI use hybrid retrieval in their RAG pipelines.

Good news: Postgres does hybrid too. With [pgvector](https://github.com/pgvector/pgvector) and [pgvectorscale](https://github.com/timescale/pgvectorscale), you can run BM25 + vectors in one query:

```sql
-- Hybrid search with Reciprocal Rank Fusion (same technique used by Cohere, Pinecone)
WITH bm25 AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY content <@> to_bm25query($1)) as rank
  FROM docs LIMIT 20
),
vector AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $2) as rank  
  FROM docs LIMIT 20
)
SELECT id, 1.0/(60+bm25.rank) + 1.0/(60+vector.rank) as score
FROM bm25 FULL JOIN vector USING (id)
ORDER BY score DESC LIMIT 10;
```

Both signals. One database. No external services.

---

## See It For Yourself

We built a demo that runs all four search methods side-by-side: Native Postgres, BM25, Vector, and Hybrid. Same query, same documents, different results. You'll see exactly why BM25 wins.

![Demo App](./app-image.png)

Type a query. Watch Native Postgres fail on partial matches while BM25 finds what you need. See how Vector search understands meaning. Watch Hybrid combine both for the best results. No hand-waving. Just run queries and compare.

**Clone it:**
```bash
git clone https://github.com/rajaraodv/pg_textsearch_demo.git
cd pg_textsearch_demo
npm install
# Add DATABASE_URL and OPENAI_API_KEY to .env.local
npm run setup && npm run dev
```

**Or just use pg_textsearch directly:**
```sql
CREATE EXTENSION pg_textsearch;
CREATE INDEX docs_idx ON documents USING bm25(content) WITH (text_config='english');

SELECT title, content <@> to_bm25query('your search') as score
FROM documents
ORDER BY score
LIMIT 10;
```

---

## The Point

You don't need Elasticsearch. You don't need Algolia. You don't need another service to sync, monitor, and pay for.

You need [pg_textsearch](https://github.com/timescale/pg_textsearch).

It's fully open source under the [PostgreSQL license](https://opensource.org/licenses/PostgreSQL), the same highly permissive license as Postgres itself. Use it anywhere, for anything, no strings attached.

Already available on [Tiger Data](https://console.cloud.timescale.com).

**Just use Postgres.**
