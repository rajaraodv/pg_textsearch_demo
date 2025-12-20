import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Estimate IDF for a term based on document frequency
async function getTermStats(terms: string[]): Promise<Record<string, { docFreq: number; idf: string }>> {
  const stats: Record<string, { docFreq: number; idf: string }> = {};
  
  for (const term of terms) {
    const result = await query(
      `SELECT COUNT(*) as freq FROM documents WHERE LOWER(title || ' ' || content) LIKE $1`,
      [`%${term.toLowerCase()}%`]
    );
    const docFreq = parseInt(result.rows[0].freq);
    const totalDocs = 10; // We have 10 docs
    const idf = docFreq === 0 ? 'N/A' : (Math.log((totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1)).toFixed(2);
    stats[term] = { docFreq, idf: docFreq === 0 ? 'N/A' : idf };
  }
  
  return stats;
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

    // Get query terms for analysis (allow 2+ character terms like "db", "ai", etc.)
    const terms = searchQuery.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    
    // Get term statistics (IDF values)
    const termStats = await getTermStats(terms);

    // BM25 search using pg_textsearch
    // The <@> operator returns BM25 distance (lower = better match) with:
    // ✅ IDF weighting - rare terms matter more
    // ✅ TF saturation (k1=1.2) - diminishing returns for repetition
    // ✅ Length normalization (b=0.75) - fair comparison across doc sizes
    // ✅ Score threshold filtering - exclude low-relevance results
    
    // Build SQL with optional score threshold filter
    // Note: BM25 scores are negative (more negative = better match)
    // A threshold of -2.0 means "score must be at least 2.0"
    const hasThreshold = typeof scoreThreshold === 'number' && scoreThreshold > 0;
    
    // Always include WHERE clause to get matching documents
    // BM25 returns negative scores, so score < 0 means it matched
    const sql = hasThreshold ? `
      SELECT 
        id,
        title,
        content,
        category,
        -(full_text <@> to_bm25query($1, 'idx_documents_bm25')) as score,
        word_count
      FROM documents
      WHERE full_text <@> to_bm25query($1, 'idx_documents_bm25') < $2
      ORDER BY full_text <@> to_bm25query($1, 'idx_documents_bm25') ASC
      LIMIT 10
    ` : `
      SELECT 
        id,
        title,
        content,
        category,
        -(full_text <@> to_bm25query($1, 'idx_documents_bm25')) as score,
        word_count
      FROM documents
      WHERE full_text <@> to_bm25query($1, 'idx_documents_bm25') < 0
      ORDER BY full_text <@> to_bm25query($1, 'idx_documents_bm25') ASC
      LIMIT 10
    `;

    const params = hasThreshold ? [searchQuery, -scoreThreshold] : [searchQuery];
    const result = await query(sql, params);
    const executionTime = Date.now() - startTime;

    // Calculate average doc length for normalization explanation
    const avgLength = 45; // Approximate average

    // Add match analysis for each result
    const resultsWithAnalysis = result.rows.map(row => {
      const fullTextLower = (row.title + ' ' + row.content).toLowerCase();
      const matchedTerms = terms.filter(term => fullTextLower.includes(term));
      const termCounts: Record<string, number> = {};
      
      terms.forEach(term => {
        const regex = new RegExp(term, 'gi');
        const matches = fullTextLower.match(regex);
        termCounts[term] = matches ? matches.length : 0;
      });

      // Calculate contribution explanation
      const contributions = terms.map(term => {
        const count = termCounts[term];
        const stat = termStats[term];
        if (count === 0) return null;
        return {
          term,
          count,
          idf: stat.idf,
          docFreq: stat.docFreq,
          contribution: stat.docFreq <= 3 ? 'HIGH' : stat.docFreq <= 7 ? 'MEDIUM' : 'LOW'
        };
      }).filter(Boolean);

      const lengthFactor = row.word_count < avgLength ? 'boost (shorter than avg)' : 
                          row.word_count > avgLength * 1.5 ? 'penalty (longer than avg)' : 'neutral';

      return {
        ...row,
        content: row.content.substring(0, 200),
        matchAnalysis: {
          matchedTerms,
          missingTerms: terms.filter(t => !matchedTerms.includes(t)),
          termCounts,
          contributions,
          lengthFactor,
          reason: matchedTerms.length === 0 
            ? 'No direct term matches (scored by related terms)'
            : `Matched ${matchedTerms.length}/${terms.length} terms`,
          whyRanked: contributions.length > 0
            ? `IDF boost from: ${contributions.filter(c => c && c.contribution === 'HIGH').map(c => c?.term).join(', ') || 'none'}`
            : 'Low relevance score'
        }
      };
    });

    const thresholdExplanation = hasThreshold 
      ? `\n-- ✅ Score threshold: ${scoreThreshold} (filtering low-relevance results)\nWHERE distance < -${scoreThreshold}`
      : '';

    return NextResponse.json({
      results: resultsWithAnalysis,
      query: searchQuery,
      queryTerms: terms,
      termStats,
      method: 'bm25',
      scoreThreshold: hasThreshold ? scoreThreshold : null,
      filteredCount: hasThreshold ? `Showing results with score ≥ ${scoreThreshold}` : null,
      executionTime,
      explanation: `-- BM25 Search with pg_textsearch
-- Searches: title + content (full_text column)
-- ✅ IDF weighting (rare terms weighted higher)
-- ✅ TF saturation k1=1.2 (diminishing returns)
-- ✅ Length normalization b=0.75 (fair comparison)
-- ✅ Ranked retrieval (partial matches scored)${thresholdExplanation}

SELECT 
  id, title, content, category,
  -(full_text <@> to_bm25query('${searchQuery}', 'idx_documents_bm25')) as score
FROM documents${hasThreshold ? `\nWHERE full_text <@> to_bm25query('${searchQuery}', 'idx') < -${scoreThreshold}` : ''}
ORDER BY score DESC
LIMIT 10;`,
    });
  } catch (error) {
    console.error('BM25 search error:', error);
    return NextResponse.json(
      { error: 'Search failed', details: String(error) },
      { status: 500 }
    );
  }
}

