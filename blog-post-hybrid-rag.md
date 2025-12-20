# What Top AI Teams Use for Search. Just in Postgres.

## The Workflow

**Classic RAG:**

```
User Query → Embed → Vector Search → Top-K Docs → LLM → Answer
```

**Hybrid RAG** (Pinecone, Weaviate, LangChain, Cohere):

```
User Query
    ├─→ BM25 Search (keywords)  ─┐
    └─→ Vector Search (meaning) ─┴─→ Combine (RRF) → Top-K Docs → LLM → Answer
```

Two search paths. Combined results. Better retrieval.

---

## What the Industry Says About BM25

### Pinecone

From [Pinecone's hybrid search documentation](https://docs.pinecone.io/guides/data/understanding-hybrid-search):

> "Hybrid search combines the strengths of dense and sparse embeddings to provide more relevant results... Sparse vectors excel at exact keyword matching, while dense vectors capture semantic relationships."

Pinecone added hybrid search in 2023. Their sparse vectors use BM25-style term weighting.

### Weaviate

From [Weaviate's hybrid search guide](https://weaviate.io/developers/weaviate/search/hybrid):

> "Hybrid search merges keyword (BM25) and vector search results... The `alpha` parameter determines the weight given to each search method."

Their implementation explicitly combines **BM25** with vector search.

### Cohere

From [Cohere's reranking best practices](https://docs.cohere.com/docs/reranking-best-practices):

> "We recommend using **BM25** or another lexical search method as a first-stage retrieval... A purely semantic search can miss highly relevant results due to a mismatch in how the embedding model interprets terms."

Cohere's Rerank product assumes BM25 as the first-stage retriever.

### LangChain

From [LangChain's EnsembleRetriever documentation](https://python.langchain.com/docs/how_to/ensemble_retriever/):

> "A common pattern is to combine a sparse retriever (like BM25) with a dense retriever (like embedding similarity)... Reciprocal Rank Fusion (RRF) is used to combine the results."

LangChain's recommended production pattern: **BM25 + embeddings + RRF**.

### Elasticsearch

From [Elasticsearch's hybrid search guide](https://www.elastic.co/guide/en/elasticsearch/reference/current/knn-search.html#_combine_approximate_knn_with_other_features):

> "You can combine kNN search with traditional query capabilities... to balance semantic understanding with keyword precision."

Elasticsearch built their entire search empire on BM25. Now they add vectors to it, not the other way around.

---

## Why Add BM25 to Vector Search?

Vector embeddings compress meaning. That's powerful for understanding intent, but it loses precision on exact terms.

| Query | Vector Search Returns | BM25 Returns |
|-------|----------------------|--------------|
| `error PG-1234` | Docs about "database errors" | Doc with exact code `PG-1234` |
| `max_connections = 100` | Docs about "connection settings" | Doc with exact value `100` |
| `PostgreSQL 15.3` | Any PostgreSQL docs | Version 15.3 specific docs |
| `John Smith` | Docs about "people" or "names" | Doc mentioning "John Smith" |

BM25 finds **exact matches**. Vector finds **related concepts**. Hybrid gets both.

---

## How Hybrid Search Works

```
Query: "fix PostgreSQL connection timeout"

BM25 finds:    Docs containing "PostgreSQL", "connection", "timeout"
Vector finds:  Docs about troubleshooting database connectivity
Hybrid:        Docs matching keywords AND meaning rank highest
```

Results are combined using [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf):

```
RRF Score = 1/(k + rank_bm25) + 1/(k + rank_vector)
```

Documents that rank well in both systems get boosted. Documents that only rank well in one still appear.

---

## Just in Postgres

You can run the same hybrid pattern with [pg_textsearch](https://github.com/timescale/pg_textsearch) and [pgvector](https://github.com/pgvector/pgvector):

```sql
-- Enable extensions
CREATE EXTENSION pg_textsearch;
CREATE EXTENSION vector;

-- Create indexes
CREATE INDEX ON docs USING bm25(content) WITH (text_config='english');
CREATE INDEX ON docs USING hnsw(embedding vector_cosine_ops);
```

Hybrid search with RRF:

```sql
WITH bm25_results AS (
  SELECT id, ROW_NUMBER() OVER (
    ORDER BY content <@> to_bm25query('PostgreSQL connection timeout')
  ) as rank
  FROM docs
  LIMIT 20
),
vector_results AS (
  SELECT id, ROW_NUMBER() OVER (
    ORDER BY embedding <=> $query_embedding
  ) as rank
  FROM docs
  LIMIT 20
)
SELECT 
  d.id, d.title,
  1.0/(60 + COALESCE(b.rank, 1000)) + 
  1.0/(60 + COALESCE(v.rank, 1000)) as rrf_score
FROM docs d
LEFT JOIN bm25_results b ON d.id = b.id
LEFT JOIN vector_results v ON d.id = v.id
WHERE b.id IS NOT NULL OR v.id IS NOT NULL
ORDER BY rrf_score DESC
LIMIT 10;
```

Same pattern as Pinecone and Weaviate. No extra infrastructure.

---

## See It In Action

We built a demo that compares all four search methods side-by-side:

- **Native PostgreSQL** - Boolean AND matching
- **BM25** - Keyword ranking (IDF, TF saturation, length normalization)
- **Vector** - Semantic similarity
- **Hybrid** - BM25 + Vector with RRF

![Demo Screenshot](./images/app-image.png)

**[Try the demo →](https://github.com/rajaraodv/pg_textsearch_demo)**

---

## Get Started

```bash
git clone https://github.com/rajaraodv/pg_textsearch_demo
cd pg_textsearch_demo
npm install
# Add DATABASE_URL and OPENAI_API_KEY to .env.local
npm run setup  # Creates tables, indexes, embeddings
npm run dev    # Opens demo at localhost:3000
```

Or add to your existing PostgreSQL:

```sql
CREATE EXTENSION pg_textsearch;
CREATE EXTENSION vector;

CREATE INDEX ON your_table USING bm25(content);
CREATE INDEX ON your_table USING hnsw(embedding vector_cosine_ops);
```

---

## References

### Industry Documentation
- [Pinecone: Understanding Hybrid Search](https://docs.pinecone.io/guides/data/understanding-hybrid-search)
- [Weaviate: Hybrid Search](https://weaviate.io/developers/weaviate/search/hybrid)
- [Cohere: Reranking Best Practices](https://docs.cohere.com/docs/reranking-best-practices)
- [LangChain: EnsembleRetriever](https://python.langchain.com/docs/how_to/ensemble_retriever/)
- [Elasticsearch: Hybrid Search](https://www.elastic.co/guide/en/elasticsearch/reference/current/knn-search.html)

### Research
- [Reciprocal Rank Fusion (Cormack et al., SIGIR 2009)](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)
- [BM25 Algorithm](https://en.wikipedia.org/wiki/Okapi_BM25)

### PostgreSQL Extensions
- [pg_textsearch](https://github.com/timescale/pg_textsearch) - BM25 for PostgreSQL
- [pgvector](https://github.com/pgvector/pgvector) - Vector similarity for PostgreSQL
- [pgvectorscale](https://github.com/timescale/pgvectorscale) - High-performance vector indexing

---

Pinecone does it. Weaviate does it. LangChain does it. Cohere does it. Elasticsearch does it.

Now you can do it too. Just in Postgres.
