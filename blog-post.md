# Stop Running Elasticsearch. Just Use Postgres.

You want good search. So you're evaluating Elasticsearch. Or Algolia. Or Typesense. You're about to spin up another cluster, write data sync pipelines, and add one more thing to your on-call rotation.

**Stop.**

You already have Postgres. And now Postgres has BM25—the same ranking algorithm that powers Elasticsearch, Solr, and every serious search engine on the planet.

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

You're right. It does.

Native `ts_rank` treats search as a boolean problem—documents match or they don't. It has no concept of *relevance*. A spammy doc that repeats "database" 50 times ranks higher than a helpful tutorial that mentions it twice.

**BM25 fixes this.** It's been the gold standard for search ranking since the 90s. Here's what it does:

### 1. Term Frequency Saturation
Mentioning a word 50 times doesn't make a document 50× more relevant. BM25 caps the benefit. Keyword stuffing doesn't work.

### 2. Rare Terms Matter More  
"database" appears everywhere—useless for ranking. "authentication" appears in 1 doc—that's the signal. BM25 weights rare terms higher automatically.

### 3. Length Normalization
A 50-word tip entirely about your query beats a 5,000-word manual that mentions it once. BM25 normalizes for document length.

### 4. Partial Matching
Search for "database connection pooling" and only 2 words match? Native Postgres returns nothing. BM25 returns ranked results.

---

## The Comparison

| | Native `ts_rank` | BM25 |
|---|---|---|
| Ranking | Boolean | Probabilistic |
| Spam resistance | Easily gamed | Resistant |
| Rare terms | Ignored | Weighted |
| Long docs | Favored | Normalized |
| Partial match | ❌ Fails | ✅ Works |

---

## What About Semantic Search?

BM25 handles keywords. For meaning, you need vectors.

Good news: Postgres does that too. With [pgvector](https://github.com/pgvector/pgvector) and [pgvectorscale](https://github.com/timescale/pgvectorscale), you can run hybrid search—BM25 + vectors—in one query:

```sql
-- Combine keyword + semantic search with Reciprocal Rank Fusion
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

This is how RAG systems work. Both signals. One database.

---

## Get Started

**Option 1: Try the demo**
```bash
git clone https://github.com/rajaraodv/pg_textsearch_demo.git
cd pg_textsearch_demo
npm install
# Add DATABASE_URL and OPENAI_API_KEY to .env.local
npm run setup && npm run dev
```

**Option 2: Just use it**
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

It's open source. PostgreSQL licensed. Already available on [Tiger Data](https://console.cloud.timescale.com).

**Just use Postgres.**
