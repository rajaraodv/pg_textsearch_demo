import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// OpenAI embedding function
async function getOpenAIEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not set');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text
    })
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message);
  }
  return data.data[0].embedding;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body = await request.json();
    const searchQuery = body.query;
    // IMPORTANT: Don't use default parameters as 0 is falsy in JS!
    const vectorWeight = typeof body.vectorWeight === 'number' ? body.vectorWeight : 0.5;
    const keywordWeight = typeof body.keywordWeight === 'number' ? body.keywordWeight : 0.5;
    const scoreThreshold = body.scoreThreshold;

    if (!searchQuery || typeof searchQuery !== 'string') {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    // Get query terms for analysis
    const terms = searchQuery.toLowerCase().split(/\s+/).filter(t => t.length >= 2);

    // Generate real OpenAI embedding for the query (1536 dimensions)
    const queryEmbedding = await getOpenAIEmbedding(searchQuery);

    // Check if score threshold filtering is enabled
    // RRF scores are typically between 0 and ~0.033 (1/60 + 1/60 max)
    const hasThreshold = typeof scoreThreshold === 'number' && scoreThreshold > 0;
    const thresholdValue = hasThreshold ? scoreThreshold / 1000 : 0; // Convert from UI scale (0-30) to RRF scale (0-0.03)

    // Hybrid search using Reciprocal Rank Fusion (RRF)
    // Combines pgvectorscale (DiskANN) with BM25 (pg_textsearch)
    const sql = `
      WITH vector_search AS (
        SELECT id, title, content, category, word_count,
               ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS v_rank,
               (embedding <=> $1::vector) as v_distance
        FROM documents
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT 10
      ),
      keyword_search AS (
        SELECT id, title, content, category, word_count,
               ROW_NUMBER() OVER (ORDER BY full_text <@> to_bm25query($2, 'idx_documents_bm25')) AS k_rank,
               -(full_text <@> to_bm25query($2, 'idx_documents_bm25')) as k_score
        FROM documents
        WHERE full_text <@> to_bm25query($2, 'idx_documents_bm25') < 0
        ORDER BY full_text <@> to_bm25query($2, 'idx_documents_bm25')
        LIMIT 10
      ),
      combined AS (
        SELECT 
          COALESCE(v.id, k.id) as id,
          COALESCE(v.title, k.title) as title,
          LEFT(COALESCE(v.content, k.content), 200) as content,
          COALESCE(v.category, k.category) as category,
          COALESCE(v.word_count, k.word_count) as word_count,
          v.v_rank,
          v.v_distance,
          k.k_rank,
          k.k_score,
          -- RRF formula: 1/(k + rank) where k=60 is standard
          ($3 * COALESCE(1.0 / (60 + v.v_rank), 0.0)) + 
          ($4 * COALESCE(1.0 / (60 + k.k_rank), 0.0)) AS score
        FROM vector_search v
        FULL OUTER JOIN keyword_search k ON v.id = k.id
      )
      SELECT * FROM combined
      ${hasThreshold ? `WHERE score >= $5` : ''}
      ORDER BY score DESC
      LIMIT 10
    `;

    const params = hasThreshold 
      ? [`[${queryEmbedding.join(',')}]`, searchQuery, vectorWeight, keywordWeight, thresholdValue]
      : [`[${queryEmbedding.join(',')}]`, searchQuery, vectorWeight, keywordWeight];
    
    const result = await query(sql, params);
    
    const executionTime = Date.now() - startTime;

    // Add analysis for each result
    const resultsWithAnalysis = result.rows.map(row => {
      const fullTextLower = ((row.title || '') + ' ' + (row.content || '')).toLowerCase();
      const matchedTerms = terms.filter(term => fullTextLower.includes(term));
      const termCounts: Record<string, number> = {};
      
      terms.forEach(term => {
        const regex = new RegExp(term, 'gi');
        const matches = fullTextLower.match(regex);
        termCounts[term] = matches ? matches.length : 0;
      });

      return {
        ...row,
        score: parseFloat(row.score) || 0,
        matchAnalysis: {
          matchedTerms,
          missingTerms: terms.filter(t => !matchedTerms.includes(t)),
          termCounts,
          vectorRank: row.v_rank || 'N/A',
          keywordRank: row.k_rank || 'N/A',
          vectorDistance: row.v_distance ? row.v_distance.toFixed(4) : 'N/A',
          keywordScore: row.k_score ? row.k_score.toFixed(4) : 'N/A',
          reason: row.v_rank && row.k_rank 
            ? `Found by BOTH: Vector #${row.v_rank} + Keyword #${row.k_rank}`
            : row.v_rank 
            ? `Found by VECTOR only: #${row.v_rank}`
            : `Found by KEYWORD only: #${row.k_rank}`,
          whyRanked: `RRF combines ranks: (${vectorWeight}×vector) + (${keywordWeight}×keyword)`
        }
      };
    });

    const thresholdExplanation = hasThreshold 
      ? `\n-- ✅ Score threshold: ${scoreThreshold} (filtering low-relevance results)`
      : '';

    return NextResponse.json({
      results: resultsWithAnalysis,
      query: searchQuery,
      queryTerms: terms,
      method: 'hybrid',
      vectorWeight,
      keywordWeight,
      scoreThreshold: hasThreshold ? scoreThreshold : null,
      executionTime,
      explanation: `-- Hybrid Search with Reciprocal Rank Fusion (RRF)
-- Combines pgvectorscale (DiskANN) + OpenAI embeddings with pg_textsearch (BM25)
-- Vector weight: ${vectorWeight}, Keyword weight: ${keywordWeight}
-- Query embedding: OpenAI text-embedding-3-small (1536 dims)${thresholdExplanation}

WITH vector_search AS (
  -- Semantic search using OpenAI embeddings + DiskANN index
  SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> query_embedding) AS v_rank
  FROM documents
  ORDER BY embedding <=> query_embedding
  LIMIT 10
),
keyword_search AS (
  -- Keyword search using BM25 (pg_textsearch)
  SELECT id, ROW_NUMBER() OVER (ORDER BY full_text <@> to_bm25query('${searchQuery}', 'idx')) AS k_rank
  FROM documents  
  ORDER BY full_text <@> to_bm25query('${searchQuery}', 'idx')
  LIMIT 10
)
SELECT *,
  -- RRF Score = weighted sum of 1/(60 + rank)
  (${vectorWeight} * 1/(60 + v_rank)) + (${keywordWeight} * 1/(60 + k_rank)) AS rrf_score
FROM vector_search v
FULL OUTER JOIN keyword_search k ON v.id = k.id${hasThreshold ? `\nWHERE rrf_score >= ${thresholdValue.toFixed(4)}` : ''}
ORDER BY rrf_score DESC;`,
    });
  } catch (error) {
    console.error('Hybrid search error:', error);
    return NextResponse.json(
      { error: 'Search failed', details: String(error) },
      { status: 500 }
    );
  }
}
