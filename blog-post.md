# Google-Level Search Directly in PostgreSQL—No Elasticsearch Required

You know that feeling when you type something into Google and it just *gets* what you're looking for? The results are ranked perfectly—the most relevant stuff at the top, spam pushed down, and somehow it knows that your 3-word query matches a document that uses completely different phrasing.

**What if you could have that same search quality directly in your PostgreSQL database?**

That's exactly what [pg_textsearch](https://github.com/timescale/pg_textsearch) brings to the table. It's a new PostgreSQL extension that implements BM25—the same ranking algorithm that powers Elasticsearch, Apache Solr, and virtually every serious search engine you've ever used.

No separate search cluster. No data synchronization nightmares. No additional infrastructure to manage. Just your PostgreSQL database, doing what search engines do.

---

## The Search Infrastructure Problem

If you've built an application that needs good search, you've probably been down this road:

1. **Started with PostgreSQL's native full-text search** — `ts_rank` and `to_tsvector`. It works, but the results feel... off. Important documents get buried. Spam ranks too high.

2. **Evaluated external search services** — Elasticsearch, Algolia, Typesense, Meilisearch. They have great search quality, but now you need:
   - A separate cluster to deploy and maintain
   - Data synchronization pipelines (that inevitably get out of sync)
   - Another point of failure in your architecture
   - Often significant additional cost

3. **Accepted the tradeoff** — Either you live with mediocre native search, or you add infrastructure complexity.

**pg_textsearch changes this equation entirely.** You get Google-quality ranking directly in PostgreSQL, using the same BM25 algorithm that powers professional search engines.

---

## What is BM25? The Algorithm Behind Every Search Engine

BM25 (Best Matching 25) isn't new—it's been the workhorse of information retrieval since the 1990s. It's the default ranking algorithm in:

- **Elasticsearch** and **OpenSearch**
- **Apache Solr** and **Apache Lucene**
- **Tantivy** (Rust-based search)
- Virtually every search system that takes ranking seriously

Why is BM25 so dominant? Because it solves a fundamental problem: **How do you rank documents by relevance, not just by whether they match?**

Native PostgreSQL search (using `ts_rank`) treats search as a boolean problem—documents either match or they don't. BM25 treats search as a *ranking* problem, considering multiple factors to surface the most relevant results.

---

## The Four Things BM25 Cares About

BM25's magic comes from balancing four key factors. Let's look at each with concrete examples.

### 1. Term Frequency (TF) — But With Saturation

**The idea:** If a document mentions your search term more often, it's probably more relevant.

**The problem:** Without limits, this leads to keyword stuffing. A spammy SEO document that repeats "database database database database" 50 times would rank higher than a genuinely helpful tutorial.

**BM25's solution:** Term frequency has *diminishing returns*. The first few mentions of a word matter a lot. Additional mentions matter less and less.

```
Mentions:  1    2    3    4    5   10   50
Impact:   1.0  1.5  1.7  1.8  1.9  2.0  2.1  (approaches limit)
```

This is controlled by the `k1` parameter (default: 1.2). A higher k1 means more credit for repetition; a lower k1 means faster saturation.

**Real example:** Search for "database performance"
- **Helpful doc:** "Improve database performance with proper indexing..." (2 mentions)
- **Spam doc:** "Database database database. Learn database. Database tips..." (10 mentions)

With BM25, the helpful doc wins because additional "database" mentions barely move the score after the first few.

---

### 2. Inverse Document Frequency (IDF) — Rare Words Matter More

**The idea:** If a word appears in almost every document, it's not very useful for finding what you want. But if a word only appears in a few documents, it's highly discriminating.

**Example:** Search for "database authentication"

| Term | Appears in | IDF Weight |
|------|-----------|------------|
| "database" | 12 of 15 docs | Low (~0.3) |
| "authentication" | 1 of 15 docs | High (~2.7) |

BM25 gives "authentication" nearly 10× more weight because it's the term that actually distinguishes documents. Finding a document about authentication is much more specific than finding one that mentions "database."

**Why this matters:** Native PostgreSQL search treats all words equally. If you search for "database authentication," it ranks documents by how many times they mention either word—even though "database" appears everywhere and tells you almost nothing.

---

### 3. Document Length Normalization — Short and Focused Wins

**The idea:** A 100-word tip that's entirely about your topic is probably more relevant than a 10,000-word reference manual that briefly mentions it.

**The problem:** Longer documents naturally contain more words, so they match more queries by chance.

**BM25's solution:** Normalize by document length. A match in a short, focused document counts more than the same match in a long document.

This is controlled by the `b` parameter (default: 0.75):
- `b=0`: No length normalization (long docs have advantage)
- `b=1`: Full normalization (heavily penalizes long docs)
- `b=0.75`: Balanced (default, works well for most cases)

**Real example:** Search for "EXPLAIN ANALYZE PostgreSQL"

| Document | Length | Keyword Count | Native Rank | BM25 Rank |
|----------|--------|---------------|-------------|-----------|
| "EXPLAIN ANALYZE Quick Tip" | 15 words | 2 | #2 | **#1** |
| "Complete PostgreSQL Query Tuning Guide" | 80 words | 8 | #1 | #2 |

The long guide has more keyword matches, so native search ranks it higher. But BM25 recognizes that the short tip is *entirely* about EXPLAIN ANALYZE—it's a better result.

---

### 4. Partial Matching — No More "No Results Found"

**The idea:** If a user searches for three words and a document matches two of them really well, that's still a useful result.

**Native PostgreSQL's problem:** By default, `plainto_tsquery` uses Boolean AND—a document must contain *all* query terms to match. Search for "database connection pooling" and if a document only has "connection pooling" (missing "database"), it's excluded entirely.

**BM25's approach:** All documents are scored and ranked. Documents matching more terms rank higher, but documents matching some terms still appear. This is how Google works—you don't get "No results found" very often.

**Real example:** Search for "secure postgres database"

| Document | Matches | Native Result | BM25 Result |
|----------|---------|---------------|-------------|
| "Protecting Database Access" | "database", close semantic match for "secure" | ❌ No match | ✅ Ranked #1 |
| "PostgreSQL Security Guide" | "postgres" + related | ❌ No match | ✅ Ranked #2 |

With BM25, you get useful results even when the exact keywords don't appear.

---

## Why BM25 Beats Native PostgreSQL Search

Let's be direct about the comparison:

| Feature | Native `ts_rank` | BM25 (`pg_textsearch`) |
|---------|-----------------|------------------------|
| **Ranking model** | Boolean (match/no match) | Probabilistic relevance |
| **Term frequency** | Linear (more = better) | Saturating (diminishing returns) |
| **Rare terms** | All terms equal | Rare terms weighted higher |
| **Document length** | No normalization | Length-normalized |
| **Partial matches** | Requires all terms (AND) | Ranks by best matches |
| **Spam resistance** | Easily gamed | Resistant to keyword stuffing |

The difference is dramatic in practice. For a typical search workload, BM25 produces noticeably better results—the kind of results users expect from modern search.

---

## Hybrid Search: BM25 + Vectors for AI Applications

Here's where it gets really powerful. BM25 excels at keyword matching, but what about semantic understanding? That's where vector search comes in.

**The best modern search systems use both:**

- **BM25 (keyword search):** Fast, precise, great for exact terms
- **Vector search (semantic):** Understands meaning, handles synonyms, works with natural language

With pg_textsearch and [pgvectorscale](https://github.com/timescale/pgvectorscale), you can run hybrid search directly in PostgreSQL:

```sql
-- Hybrid search using Reciprocal Rank Fusion (RRF)
WITH bm25_results AS (
  SELECT id, title, 
         ROW_NUMBER() OVER (ORDER BY full_text <@> to_bm25query('connection problems')) as bm25_rank
  FROM documents
  ORDER BY full_text <@> to_bm25query('connection problems')
  LIMIT 20
),
vector_results AS (
  SELECT id, title,
         ROW_NUMBER() OVER (ORDER BY embedding <=> $1) as vec_rank
  FROM documents
  ORDER BY embedding <=> $1  -- $1 is the query embedding
  LIMIT 20
)
SELECT 
  COALESCE(b.id, v.id) as id,
  COALESCE(b.title, v.title) as title,
  (1.0 / (60 + COALESCE(b.bm25_rank, 1000))) + 
  (1.0 / (60 + COALESCE(v.vec_rank, 1000))) as rrf_score
FROM bm25_results b
FULL OUTER JOIN vector_results v ON b.id = v.id
ORDER BY rrf_score DESC
LIMIT 10;
```

This is exactly how RAG (Retrieval Augmented Generation) systems work—combining keyword precision with semantic understanding for AI-powered search.

---

## Getting Started in 5 Minutes

### Option 1: Try the Interactive Demo

We've built a demo app that lets you compare Native PostgreSQL, BM25, and Hybrid search side-by-side.

**1. Install the Tiger Data MCP extension in Cursor/VS Code**

The MCP (Model Context Protocol) extension connects your IDE directly to Tiger Data's cloud PostgreSQL with pg_textsearch pre-installed.

**2. Create a free Tiger Data account**

Go to [console.cloud.timescale.com](https://console.cloud.timescale.com) and create a new service. pg_textsearch is available on all services.

**3. Clone and run the demo**

```bash
git clone https://github.com/rajaraodv/pg_textsearch_demo.git
cd pg_textsearch_demo
npm install
```

**4. Configure your environment**

Create `.env.local` with your credentials:
```
DATABASE_URL=postgres://user:pass@host:port/db?sslmode=require
OPENAI_API_KEY=sk-your-key-here
```

**5. Load sample documents and start the app**

```bash
npm run setup   # Creates tables, loads documents, generates embeddings
npm run dev     # Starts the demo at http://localhost:3000
```

**6. Add your own documents**

Drop markdown files in `data/documents/` and re-run `npm run setup`:

```markdown
---
title: Your Document Title
category: tutorial
---

Your content here. This will be indexed for BM25 and vector search.
```

---

### Option 2: Use pg_textsearch Directly

If you just want to add BM25 to your existing PostgreSQL database:

**1. Enable the extension**

```sql
CREATE EXTENSION pg_textsearch;
```

**2. Create a BM25 index on your text column**

```sql
CREATE INDEX articles_search_idx ON articles 
USING bm25(content) WITH (text_config='english');
```

**3. Search with BM25 ranking**

```sql
-- Search and rank by relevance
SELECT title, content <@> to_bm25query('database performance') as score
FROM articles
ORDER BY content <@> to_bm25query('database performance')
LIMIT 10;
```

**4. Filter by score threshold**

```sql
-- Only return highly relevant results
SELECT title, content <@> to_bm25query('database performance') as score
FROM articles
WHERE content <@> to_bm25query('database performance') < -2.0
ORDER BY score
LIMIT 10;
```

That's it. You now have Google-quality search ranking in your PostgreSQL database.

---

## The Bottom Line

For years, getting good search meant adding infrastructure complexity—Elasticsearch clusters, data sync pipelines, additional operational overhead. 

pg_textsearch changes this. You get:

- ✅ **BM25 ranking** — The same algorithm powering Elasticsearch and Lucene
- ✅ **Zero additional infrastructure** — It's just PostgreSQL
- ✅ **No data synchronization** — Your search index is always in sync
- ✅ **Hybrid search ready** — Combine with pgvectorscale for semantic search
- ✅ **Production ready** — PostgreSQL license, battle-tested codebase

If you're building search for your application—whether it's a knowledge base, e-commerce catalog, documentation site, or AI agent—pg_textsearch gives you professional-grade search without the infrastructure tax.

**Ready to try it?** Check out the [pg_textsearch repo](https://github.com/timescale/pg_textsearch) or spin up a free [Tiger Data service](https://console.cloud.timescale.com) to get started.

---

*pg_textsearch is open source under the PostgreSQL license. Contributions welcome!*

