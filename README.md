# pg_textsearch Demo

> **Add Google-level search to your Postgres database in 5 minutes** — for your apps and AI agents.

This demo showcases [Tiger Data's `pg_textsearch`](https://www.timescale.com/blog/introducing-pg_textsearch-true-bm25-ranking-hybrid-retrieval-postgres/) extension, which brings **BM25 ranking** and **hybrid search** directly into PostgreSQL.

## Why This Matters

| Native PostgreSQL | BM25 (pg_textsearch) |
|-------------------|----------------------|
| ❌ Boolean AND — missing one term excludes the doc | ✅ Ranked retrieval — all relevant docs scored |
| ❌ No IDF — common words weighted same as rare | ✅ Rare terms get higher importance |
| ❌ Long docs always win | ✅ Length normalization for fair ranking |
| ❌ Keyword stuffing games rankings | ✅ Term frequency saturation prevents gaming |

**Plus:** Combine with `pgvectorscale` for **hybrid search** — keyword + semantic in one query!

---

## Quick Start (5 minutes)

### 1. Create a Tiger Data Service

Sign up at [console.cloud.timescale.com](https://console.cloud.timescale.com) and create a new service.

### 2. Clone & Install

```bash
git clone https://github.com/rajaraodv/pg_textsearch_demo.git
cd pg_textsearch_demo
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your credentials:

```env
DATABASE_URL=postgresql://tsdbadmin:YOUR_PASSWORD@YOUR_HOST:YOUR_PORT/tsdb?sslmode=require
OPENAI_API_KEY=sk-proj-your-openai-api-key
```

### 4. Setup Database

```bash
node scripts/setup-database.js
```

This will:
- Enable `pg_textsearch` and `pgvectorscale` extensions
- Create the documents table with sample data
- Generate OpenAI embeddings for vector search
- Create BM25 and DiskANN indexes

### 5. Run the Demo

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and try the demo queries!

---

## Demo Scenarios

### Traditional Search
- **"database connection pooling"** — Shows Boolean AND limitation
- **"database authentication"** — Demonstrates IDF (rare term weighting)
- **"explain analyze postgresql"** — Shows length normalization

### AI Agent Queries
- **"make database faster"** — Hybrid combines keyword + semantic
- **"fix connection pool problems"** — Native fails, BM25/Vector work
- **"secure my postgres database"** — Natural language → technical docs

---

## Tech Stack

- **Next.js 15** — React framework
- **Tiger Data** — PostgreSQL cloud with extensions
- **pg_textsearch** — BM25 full-text search
- **pgvectorscale** — Vector search with DiskANN
- **OpenAI** — text-embedding-3-small for embeddings

---

## Learn More

- [pg_textsearch Documentation](https://docs.timescale.com/use-timescale/latest/extensions/pg-textsearch/)
- [Tiger Data Console](https://console.cloud.timescale.com)
- [Blog: Introducing pg_textsearch](https://www.timescale.com/blog/introducing-pg_textsearch-true-bm25-ranking-hybrid-retrieval-postgres/)

---

## License

MIT
