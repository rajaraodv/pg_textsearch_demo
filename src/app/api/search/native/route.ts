import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { query: searchQuery } = await request.json();

    if (!searchQuery || typeof searchQuery !== 'string') {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    // Get query terms for analysis
    const terms = searchQuery.toLowerCase().split(/\s+/).filter(t => t.length >= 2);

    // Native PostgreSQL full-text search using ts_rank
    // This demonstrates the limitations:
    // 1. No IDF - common words weighted same as rare ones
    // 2. No saturation - keyword stuffing works
    // 3. No length normalization - longer docs score higher
    const sql = `
      SELECT 
        id,
        title,
        content,
        category,
        ts_rank(search_vector, plainto_tsquery('english', $1)) as score,
        word_count,
        ts_headline('english', content, plainto_tsquery('english', $1), 
          'StartSel=<mark>, StopSel=</mark>, MaxWords=50, MinWords=20') as headline
      FROM documents
      WHERE search_vector @@ plainto_tsquery('english', $1)
      ORDER BY score DESC
      LIMIT 10
    `;

    const result = await query(sql, [searchQuery]);
    const executionTime = Date.now() - startTime;

    // Add match analysis for each result (searches title + content)
    const resultsWithAnalysis = result.rows.map(row => {
      const fullTextLower = (row.title + ' ' + row.content).toLowerCase();
      const matchedTerms = terms.filter(term => fullTextLower.includes(term));
      const termCounts: Record<string, number> = {};
      
      terms.forEach(term => {
        const regex = new RegExp(term, 'gi');
        const matches = fullTextLower.match(regex);
        termCounts[term] = matches ? matches.length : 0;
      });

      return {
        ...row,
        content: row.content.substring(0, 200),
        matchAnalysis: {
          matchedTerms,
          missingTerms: terms.filter(t => !matchedTerms.includes(t)),
          termCounts,
          reason: matchedTerms.length === terms.length 
            ? `✓ Contains ALL ${terms.length} query terms`
            : `Contains ${matchedTerms.length}/${terms.length} terms`,
          whyRanked: `ts_rank score based on term frequency (no IDF weighting)`
        }
      };
    });

    return NextResponse.json({
      results: resultsWithAnalysis,
      query: searchQuery,
      queryTerms: terms,
      method: 'native',
      executionTime,
      explanation: `-- Native PostgreSQL Full-Text Search
-- Uses ts_rank which has several limitations:
-- ❌ No IDF weighting (common words = rare words)
-- ❌ No term frequency saturation (keyword stuffing works)
-- ❌ No length normalization (longer docs win)
-- ❌ Boolean AND: requires ALL terms to match

SELECT 
  id, title, content, category,
  ts_rank(search_vector, plainto_tsquery('english', '${searchQuery}')) as score
FROM documents
WHERE search_vector @@ plainto_tsquery('english', '${searchQuery}')
ORDER BY score DESC
LIMIT 10;`,
    });
  } catch (error) {
    console.error('Native search error:', error);
    return NextResponse.json(
      { error: 'Search failed', details: String(error) },
      { status: 500 }
    );
  }
}

