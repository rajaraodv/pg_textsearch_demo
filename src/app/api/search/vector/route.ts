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
    const { query: searchQuery, scoreThreshold } = await request.json();

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
    // Cosine distance ranges from 0 (identical) to 2 (opposite)
    // Similarity = 1 - distance, so threshold of 0.3 means distance < 0.7
    const hasThreshold = typeof scoreThreshold === 'number' && scoreThreshold > 0;
    const distanceThreshold = hasThreshold ? 1 - (scoreThreshold / 100) : 2; // Convert similarity % to distance

    // Pure vector search using pgvectorscale (DiskANN)
    const sql = hasThreshold ? `
      SELECT 
        id,
        title,
        content,
        category,
        word_count,
        (embedding <=> $1::vector) as distance,
        1 - (embedding <=> $1::vector) as similarity
      FROM documents
      WHERE embedding IS NOT NULL
        AND (embedding <=> $1::vector) < $2
      ORDER BY embedding <=> $1::vector
      LIMIT 10
    ` : `
      SELECT 
        id,
        title,
        content,
        category,
        word_count,
        (embedding <=> $1::vector) as distance,
        1 - (embedding <=> $1::vector) as similarity
      FROM documents
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT 10
    `;

    const params = hasThreshold 
      ? [`[${queryEmbedding.join(',')}]`, distanceThreshold]
      : [`[${queryEmbedding.join(',')}]`];
    
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

      const similarity = parseFloat(row.similarity) || 0;

      return {
        ...row,
        score: similarity,
        content: row.content?.substring(0, 200),
        matchAnalysis: {
          matchedTerms,
          missingTerms: terms.filter(t => !matchedTerms.includes(t)),
          termCounts,
          similarity: (similarity * 100).toFixed(1) + '%',
          distance: parseFloat(row.distance).toFixed(4),
          reason: similarity > 0.4 
            ? `High semantic similarity (${(similarity * 100).toFixed(0)}%)`
            : similarity > 0.25
            ? `Moderate semantic similarity (${(similarity * 100).toFixed(0)}%)`
            : `Low semantic similarity (${(similarity * 100).toFixed(0)}%)`,
          whyRanked: `OpenAI embedding cosine similarity`
        }
      };
    });

    const thresholdExplanation = hasThreshold 
      ? `\n-- ✅ Similarity threshold: ${scoreThreshold}% (filtering low-relevance results)`
      : '';

    return NextResponse.json({
      results: resultsWithAnalysis,
      query: searchQuery,
      queryTerms: terms,
      method: 'vector',
      scoreThreshold: hasThreshold ? scoreThreshold : null,
      executionTime,
      explanation: `-- Pure Vector/Semantic Search (RAG-style)
-- Uses pgvectorscale with DiskANN index
-- Query embedding: OpenAI text-embedding-3-small (1536 dims)
-- Finds documents by MEANING, not keywords${thresholdExplanation}

SELECT 
  id, title, content, category,
  (embedding <=> query_embedding) as distance,
  1 - (embedding <=> query_embedding) as similarity
FROM documents
WHERE embedding IS NOT NULL${hasThreshold ? `\n  AND (embedding <=> query_embedding) < ${distanceThreshold.toFixed(2)}` : ''}
ORDER BY embedding <=> query_embedding
LIMIT 10;

-- Note: This is what a typical RAG/AI agent would use
-- to find relevant context before generating a response.`,
    });
  } catch (error) {
    console.error('Vector search error:', error);
    return NextResponse.json(
      { error: 'Search failed', details: String(error) },
      { status: 500 }
    );
  }
}

