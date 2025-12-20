'use client';

import { useState, useEffect } from 'react';

type TermContribution = {
  term: string;
  count: number;
  idf: string;
  docFreq: number;
  contribution: 'HIGH' | 'MEDIUM' | 'LOW';
};

type MatchAnalysis = {
  matchedTerms: string[];
  missingTerms: string[];
  termCounts: Record<string, number>;
  contributions?: TermContribution[];
  lengthFactor?: string;
  vectorRank?: number | string;
  keywordRank?: number | string;
  vectorDistance?: string;
  keywordScore?: string;
  reason: string;
  whyRanked: string;
};

type SearchResult = {
  id: number;
  title: string;
  content: string;
  category: string;
  score: number;
  word_count?: number;
  headline?: string;
  matchAnalysis?: MatchAnalysis;
};

type SearchResponse = {
  results: SearchResult[];
  query: string;
  queryTerms?: string[];
  termStats?: Record<string, { docFreq: number; idf: string }>;
  method: string;
  executionTime: number;
  explanation: string;
  scoreThreshold?: number | null;
  filteredCount?: string | null;
} | {
  error: string;
  details?: string;
};

// Helper function to create a content snippet with highlighted matched terms
function ContentSnippet({ content, matchedTerms, maxLength = 120 }: { content: string; matchedTerms?: string[]; maxLength?: number }) {
  if (!content) return null;
  
  // Truncate content to maxLength
  let snippet = content.length > maxLength ? content.substring(0, maxLength) + '...' : content;
  
  if (!matchedTerms || matchedTerms.length === 0) {
    return <p className="text-[10px] text-[var(--tiger-muted)] mt-1 leading-relaxed">{snippet}</p>;
  }
  
  // Create a regex pattern for all matched terms (case insensitive)
  const pattern = new RegExp(`(${matchedTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  
  // Split by matched terms and highlight them
  const parts = snippet.split(pattern);
  
  return (
    <p className="text-[10px] text-[var(--tiger-muted)] mt-1 leading-relaxed">
      {parts.map((part, i) => {
        const isMatch = matchedTerms.some(term => part.toLowerCase() === term.toLowerCase());
        return isMatch ? (
          <span key={i} className="text-[var(--tiger-yellow)] font-medium">{part}</span>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </p>
  );
}

const DEMO_QUERIES = [
  // Keyword Search - showing partial matching and typo handling
  { 
    query: 'db connection pooling', 
    description: '"db" doesn\'t match "database" — see which terms match (✓) vs miss (✗)',
    highlight: 'partial-1',
    category: 'keyword'
  },
  { 
    query: 'datab connection pooling', 
    description: 'Typo "datab" doesn\'t match — BM25 still finds results via other terms',
    highlight: 'partial-2',
    category: 'keyword'
  },
  { 
    query: 'database connection pooling', 
    description: 'All terms match — compare Native (requires ALL) vs BM25 (ranks by relevance)',
    highlight: 'full-match',
    category: 'keyword'
  },
  // IDF - rare term weighting
  { 
    query: 'database authentication', 
    description: '"authentication" (1/14 docs) weighted higher than "database" (8/14 docs)',
    highlight: 'idf',
    category: 'idf'
  },
  // Length normalization
  { 
    query: 'explain analyze postgresql', 
    description: 'Short focused doc ranks higher than long doc with more keyword occurrences',
    highlight: 'length',
    category: 'length'
  },
  // AI/Agent scenarios
  { 
    query: 'fix my connection pool problems', 
    description: '🤖 Native: 0 results. BM25/Vector/Hybrid: all find troubleshooting guide.',
    highlight: 'agent-troubleshoot',
    category: 'agent'
  },
  { 
    query: 'secure my postgres database', 
    description: '🤖 Native: 0 results. BM25/Vector/Hybrid: find security docs.',
    highlight: 'agent-security',
    category: 'agent'
  },
];

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('db connection pooling');
  const [nativeResults, setNativeResults] = useState<SearchResponse | null>(null);
  const [bm25Results, setBm25Results] = useState<SearchResponse | null>(null);
  const [vectorResults, setVectorResults] = useState<SearchResponse | null>(null);
  const [hybridResults, setHybridResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState<'unknown' | 'ready' | 'error'>('unknown');
  const [currentScenario, setCurrentScenario] = useState<string | null>('partial-1');
  // Single slider: 0 = 100% keyword, 50 = 50/50, 100 = 100% vector
  const [hybridMix, setHybridMix] = useState(50);
  // BM25 score threshold filter (0 = disabled, 1-5 = filter low scores)
  const [scoreThreshold, setScoreThreshold] = useState(0);
  // Hybrid score threshold filter (0 = disabled, RRF scores are small ~0.01-0.03)
  const [hybridThreshold, setHybridThreshold] = useState(0);

  const keywordWeight = (100 - hybridMix) / 100;
  const vectorWeight = hybridMix / 100;

  const checkDatabase = async () => {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setDbStatus(data.status === 'ok' ? 'ready' : 'error');
    } catch {
      setDbStatus('error');
    }
  };

  const runSearch = async () => {
    setLoading(true);
    try {
      const [nativeRes, bm25Res, vectorRes, hybridRes] = await Promise.all([
        fetch('/api/search/native', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: searchQuery }),
        }),
        fetch('/api/search/bm25', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            query: searchQuery,
            scoreThreshold: scoreThreshold > 0 ? scoreThreshold : undefined 
          }),
        }),
        fetch('/api/search/vector', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: searchQuery }),
        }),
        fetch('/api/search/hybrid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            query: searchQuery,
            vectorWeight,
            keywordWeight,
            scoreThreshold: hybridThreshold > 0 ? hybridThreshold : undefined
          }),
        }),
      ]);

      const nativeData = await nativeRes.json();
      const bm25Data = await bm25Res.json();
      const vectorData = await vectorRes.json();
      const hybridData = await hybridRes.json();

      setNativeResults(nativeData);
      setBm25Results(bm25Data);
      setVectorResults(vectorData);
      setHybridResults(hybridData);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  // Re-run hybrid search when sliders change
  useEffect(() => {
    if (hybridResults && searchQuery) {
      const currentKeywordWeight = (100 - hybridMix) / 100;
      const currentVectorWeight = hybridMix / 100;
      
      const updateHybrid = async () => {
        try {
          const res = await fetch('/api/search/hybrid', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              query: searchQuery,
              vectorWeight: currentVectorWeight,
              keywordWeight: currentKeywordWeight,
              scoreThreshold: hybridThreshold > 0 ? hybridThreshold : undefined
            }),
          });
          const data = await res.json();
          setHybridResults(data);
        } catch (error) {
          console.error('Hybrid search update failed:', error);
        }
      };
      const timeout = setTimeout(updateHybrid, 300); // Debounce
      return () => clearTimeout(timeout);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hybridMix, hybridThreshold]);

  // Re-run BM25 search when score threshold changes
  useEffect(() => {
    if (bm25Results && searchQuery) {
      const updateBm25 = async () => {
        try {
          const res = await fetch('/api/search/bm25', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              query: searchQuery,
              scoreThreshold: scoreThreshold > 0 ? scoreThreshold : undefined
            }),
          });
          const data = await res.json();
          setBm25Results(data);
        } catch (error) {
          console.error('BM25 search update failed:', error);
        }
      };
      const timeout = setTimeout(updateBm25, 300); // Debounce
      return () => clearTimeout(timeout);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoreThreshold]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      runSearch();
    }
  };

  // Helper to run a demo query when clicking scenario buttons
  const runDemoQuery = (query: string, scenario: string) => {
    setSearchQuery(query);
    setCurrentScenario(scenario);
    // Run search with the new query (need to pass it directly since state won't update immediately)
    runSearchWithQuery(query);
  };

  // Version of runSearch that accepts a query parameter directly
  const runSearchWithQuery = async (query: string) => {
    setLoading(true);
    try {
      const [nativeRes, bm25Res, vectorRes, hybridRes] = await Promise.all([
        fetch('/api/search/native', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        }),
        fetch('/api/search/bm25', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            query,
            scoreThreshold: scoreThreshold > 0 ? scoreThreshold : undefined 
          }),
        }),
        fetch('/api/search/vector', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        }),
        fetch('/api/search/hybrid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            query,
            vectorWeight,
            keywordWeight,
            scoreThreshold: hybridThreshold > 0 ? hybridThreshold : undefined
          }),
        }),
      ]);

      const nativeData = await nativeRes.json();
      const bm25Data = await bm25Res.json();
      const vectorData = await vectorRes.json();
      const hybridData = await hybridRes.json();

      setNativeResults(nativeData);
      setBm25Results(bm25Data);
      setVectorResults(vectorData);
      setHybridResults(hybridData);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gradient-tiger min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--tiger-border)] bg-[var(--tiger-darker)]">
        <div className="max-w-[1800px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[var(--tiger-yellow)] flex items-center justify-center">
              <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold">pg_textsearch Demo</h1>
              <p className="text-xs text-[var(--tiger-muted)]">BM25 + Hybrid Search for PostgreSQL</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={checkDatabase}
              className="text-xs text-[var(--tiger-muted)] hover:text-white transition-colors"
            >
              {dbStatus === 'unknown' && '● Check DB'}
              {dbStatus === 'ready' && <span className="text-[var(--tiger-success)]">● Connected</span>}
              {dbStatus === 'error' && <span className="text-[var(--tiger-error)]">● Disconnected</span>}
            </button>
            <a
              href="https://docs.timescale.com/use-timescale/latest/extensions/pg-textsearch/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[var(--tiger-muted)] hover:text-white"
            >
              Docs →
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-[1800px] mx-auto px-6 py-6">
        {/* Search Section */}
        <div className="mb-6">
          <div className="flex gap-3 mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search technical documentation..."
              className="search-input flex-1 px-4 py-3 text-sm"
            />
            <button
              onClick={runSearch}
              disabled={loading}
              className="px-6 py-3 bg-[var(--tiger-yellow)] text-black font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2 text-sm"
            >
              {loading ? <div className="spinner" /> : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Search
                </>
              )}
            </button>
          </div>

          {/* Demo Queries */}
          <div className="mt-4 p-4 rounded-lg bg-[var(--tiger-card)] border border-[var(--tiger-border)]">
            <div className="text-xs text-[var(--tiger-muted)] mb-3">Try these examples to see how different search methods compare:</div>
            
            {/* Keyword Search */}
            <div className="mb-3">
              <div className="text-[10px] uppercase tracking-wider text-[var(--tiger-muted)] mb-2 font-medium">Keyword Search</div>
              <div className="flex flex-wrap gap-2">
                {DEMO_QUERIES.filter(q => q.category === 'keyword').map((item) => (
                  <button
                    key={item.query}
                    onClick={() => runDemoQuery(item.query, item.highlight)}
                    disabled={loading}
                    className={`group text-xs px-3 py-2 rounded-md border transition-all disabled:opacity-50 text-left ${
                      currentScenario === item.highlight 
                        ? 'bg-[var(--tiger-yellow)] border-[var(--tiger-yellow)] text-black' 
                        : 'bg-[var(--tiger-dark)] border-[var(--tiger-border)] text-white hover:border-[var(--tiger-yellow)]'
                    }`}
                    title={item.description}
                  >
                    <div className="font-medium font-mono">{item.query}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* IDF & Length Normalization */}
            <div className="mb-3 flex flex-wrap gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--tiger-muted)] mb-2 font-medium">Rare Term Weighting (IDF)</div>
                <div className="flex flex-wrap gap-2">
                  {DEMO_QUERIES.filter(q => q.category === 'idf').map((item) => (
                    <button
                      key={item.query}
                      onClick={() => runDemoQuery(item.query, item.highlight)}
                      disabled={loading}
                      className={`group text-xs px-3 py-2 rounded-md border transition-all disabled:opacity-50 text-left ${
                        currentScenario === item.highlight 
                          ? 'bg-[var(--tiger-yellow)] border-[var(--tiger-yellow)] text-black' 
                          : 'bg-[var(--tiger-dark)] border-[var(--tiger-border)] text-white hover:border-[var(--tiger-yellow)]'
                      }`}
                      title={item.description}
                    >
                      <div className="font-medium font-mono">{item.query}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--tiger-muted)] mb-2 font-medium">Length Normalization</div>
                <div className="flex flex-wrap gap-2">
                  {DEMO_QUERIES.filter(q => q.category === 'length').map((item) => (
                    <button
                      key={item.query}
                      onClick={() => runDemoQuery(item.query, item.highlight)}
                      disabled={loading}
                      className={`group text-xs px-3 py-2 rounded-md border transition-all disabled:opacity-50 text-left ${
                        currentScenario === item.highlight 
                          ? 'bg-[var(--tiger-yellow)] border-[var(--tiger-yellow)] text-black' 
                          : 'bg-[var(--tiger-dark)] border-[var(--tiger-border)] text-white hover:border-[var(--tiger-yellow)]'
                      }`}
                      title={item.description}
                    >
                      <div className="font-medium font-mono">{item.query}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Agentic Queries */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--tiger-yellow)] mb-2 font-medium">🤖 Agentic Queries</div>
              <div className="flex flex-wrap gap-2">
                {DEMO_QUERIES.filter(q => q.category === 'agent').map((item) => (
                  <button
                    key={item.query}
                    onClick={() => runDemoQuery(item.query, item.highlight)}
                    disabled={loading}
                    className={`group text-xs px-3 py-2 rounded-md border transition-all disabled:opacity-50 text-left ${
                      currentScenario === item.highlight 
                        ? 'bg-[var(--tiger-yellow)] border-[var(--tiger-yellow)] text-black' 
                        : 'bg-[var(--tiger-dark)] border-[var(--tiger-border)] text-white hover:border-[var(--tiger-yellow)]'
                    }`}
                    title={item.description}
                  >
                    <div className="font-medium font-mono">{item.query}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Scenario Explanation */}
          {currentScenario && (
            <div className="mt-4 p-4 rounded-lg bg-[var(--tiger-card)] border border-[var(--tiger-border)]">
              {currentScenario === 'partial-1' && (
                <div>
                  <h3 className="text-sm font-medium text-white mb-1">Partial Match: &quot;db&quot; ≠ &quot;database&quot;</h3>
                  <p className="text-xs text-[var(--tiger-muted)] leading-relaxed">
                    &quot;db&quot; doesn&apos;t match &quot;database&quot; — see the <span className="text-red-400">✗ db</span> in results.
                    Native requires ALL terms to match. BM25 still returns results ranked by the terms that DO match.
                  </p>
                </div>
              )}

              {currentScenario === 'partial-2' && (
                <div>
                  <h3 className="text-sm font-medium text-white mb-1">Typo Handling: &quot;datab&quot;</h3>
                  <p className="text-xs text-[var(--tiger-muted)] leading-relaxed">
                    The typo &quot;datab&quot; doesn&apos;t match any document. Native fails completely.
                    BM25 still finds relevant results via &quot;connection&quot; and &quot;pooling&quot;.
                  </p>
                </div>
              )}

              {currentScenario === 'full-match' && (
                <div>
                  <h3 className="text-sm font-medium text-white mb-1">Full Match: All Terms Present</h3>
                  <p className="text-xs text-[var(--tiger-muted)] leading-relaxed">
                    All three terms match. Native requires ALL terms (Boolean AND). 
                    BM25 ranks by relevance — documents with rare terms rank higher.
                  </p>
                </div>
              )}
              
              {currentScenario === 'idf' && (
                <div>
                  <h3 className="text-sm font-medium text-white mb-1">IDF: Rare Terms Are More Meaningful</h3>
                  <p className="text-xs text-[var(--tiger-muted)] leading-relaxed">
                    &quot;database&quot; appears in 8/14 docs — too common. &quot;authentication&quot; appears in only 1/14 docs — highly discriminating.
                    BM25 weights &quot;authentication&quot; ~4× higher. The auth doc ranks #1.
                  </p>
                </div>
              )}
              
              {currentScenario === 'length' && (
                <div>
                  <h3 className="text-sm font-medium text-white mb-1">Length Normalization</h3>
                  <p className="text-xs text-[var(--tiger-muted)] leading-relaxed">
                    Long doc has more keyword occurrences. Short doc has fewer but is more focused.
                    BM25 normalizes by length (b=0.75) so the short, focused tip can rank higher.
                  </p>
                </div>
              )}

              {currentScenario === 'agent-troubleshoot' && (
                <div>
                  <h3 className="text-sm font-medium text-white mb-1">🤖 Agentic Query: Troubleshooting</h3>
                  <p className="text-xs text-[var(--tiger-muted)] leading-relaxed">
                    Native: 0 results (&quot;fix&quot; and &quot;my&quot; don&apos;t appear in docs). 
                    BM25/Vector/Hybrid understand the intent and find &quot;Connection Pool Troubleshooting Guide&quot;.
                  </p>
                </div>
              )}

              {currentScenario === 'agent-security' && (
                <div>
                  <h3 className="text-sm font-medium text-white mb-1">🤖 Agentic Query: Security</h3>
                  <p className="text-xs text-[var(--tiger-muted)] leading-relaxed">
                    Native: 0 results (&quot;secure&quot; and &quot;my&quot; don&apos;t match). 
                    Vector understands &quot;secure&quot; ≈ &quot;protect&quot; semantically. Hybrid combines keyword + semantic signals.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 4-Column Results Grid */}
        <div className="relative">
          {/* Loading Overlay */}
          {loading && (
            <div className="absolute inset-0 bg-[var(--tiger-darker)]/90 z-10 flex items-center justify-center rounded-lg">
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-2 border-[var(--tiger-yellow)] border-t-transparent rounded-full animate-spin"></div>
                <span className="text-xs text-[var(--tiger-muted)]">Searching...</span>
              </div>
            </div>
          )}
          
          <div className="grid lg:grid-cols-4 gap-4">
            {/* Column 1: Native PostgreSQL */}
            <ResultsPanel
              title="Native PostgreSQL"
              subtitle="ts_rank + Boolean AND"
              results={nativeResults}
              variant="native"
            />
          
            {/* Column 2: BM25 */}
            <div className="card p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold">BM25</h2>
                  <p className="text-xs text-[var(--tiger-muted)]">pg_textsearch</p>
                </div>
                {bm25Results && 'executionTime' in bm25Results && (
                  <span className="text-[10px] text-[var(--tiger-muted)] font-mono">
                    {bm25Results.executionTime}ms
                  </span>
                )}
              </div>

              {/* Score Threshold Filter */}
              <div className="mb-3 p-2.5 rounded-md bg-[var(--tiger-dark)] border border-[var(--tiger-border)]">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-[var(--tiger-muted)]">Score Filter</span>
                  <span className="text-[10px] font-mono text-[var(--tiger-muted)]">
                    {scoreThreshold > 0 ? `≥ ${scoreThreshold.toFixed(1)}` : 'Off'}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="3"
                  step="0.5"
                  value={scoreThreshold}
                  onChange={(e) => setScoreThreshold(parseFloat(e.target.value))}
                  className="w-full"
                  style={{
                    background: scoreThreshold > 0 
                      ? `linear-gradient(to right, var(--tiger-yellow) 0%, var(--tiger-yellow) ${(scoreThreshold/3)*100}%, var(--tiger-border) ${(scoreThreshold/3)*100}%, var(--tiger-border) 100%)`
                      : 'var(--tiger-border)'
                  }}
                />
              </div>

              {/* Term Stats */}
              {bm25Results && 'termStats' in bm25Results && bm25Results.termStats && (
                <div className="mb-3 flex flex-wrap gap-1">
                  {Object.entries(bm25Results.termStats).map(([term, stats]) => (
                    <span 
                      key={term}
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        stats.docFreq <= 3 
                          ? 'badge-yellow' 
                          : 'badge-gray'
                      }`}
                    >
                      {term} ({stats.docFreq}/10)
                    </span>
                  ))}
                </div>
              )}

              <BM25ResultsList results={bm25Results} scoreThreshold={scoreThreshold} />
              
              {bm25Results && 'explanation' in bm25Results && bm25Results.explanation && (
                <CollapsibleQueryBox explanation={bm25Results.explanation} />
              )}
            </div>
          
            {/* Column 3: Vector */}
            <div className="card p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold">Vector</h2>
                  <p className="text-xs text-[var(--tiger-muted)]">pgvectorscale + OpenAI</p>
                </div>
                {vectorResults && 'executionTime' in vectorResults && (
                  <span className="text-[10px] text-[var(--tiger-muted)] font-mono">
                    {vectorResults.executionTime}ms
                  </span>
                )}
              </div>

              <VectorResultsList results={vectorResults} />
              
              {vectorResults && 'explanation' in vectorResults && vectorResults.explanation && (
                <CollapsibleQueryBox explanation={vectorResults.explanation} />
              )}
            </div>
          
            {/* Column 4: Hybrid */}
            <div className="card p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold">Hybrid</h2>
                  <p className="text-xs text-[var(--tiger-muted)]">BM25 + Vector RRF</p>
                </div>
                {hybridResults && 'executionTime' in hybridResults && (
                  <span className="text-[10px] text-[var(--tiger-muted)] font-mono">
                    {hybridResults.executionTime}ms
                  </span>
                )}
              </div>

              {/* Hybrid Mix Slider */}
              <div className="mb-3 p-2.5 rounded-md bg-[var(--tiger-dark)] border border-[var(--tiger-border)]">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-[var(--tiger-muted)]">BM25</span>
                  <span className="text-[10px] text-[var(--tiger-muted)]">Vector</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={hybridMix}
                  onChange={(e) => setHybridMix(parseInt(e.target.value))}
                  className="w-full"
                  style={{
                    background: `linear-gradient(to right, var(--tiger-yellow) 0%, var(--tiger-yellow) ${hybridMix}%, var(--tiger-border) ${hybridMix}%, var(--tiger-border) 100%)`
                  }}
                />
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] font-mono text-[var(--tiger-yellow)]">{(keywordWeight * 100).toFixed(0)}%</span>
                  <span className="text-[10px] font-mono text-[var(--tiger-muted)]">{(vectorWeight * 100).toFixed(0)}%</span>
                </div>
              </div>

              {/* Hybrid Threshold */}
              <div className="mb-3 p-2.5 rounded-md bg-[var(--tiger-dark)] border border-[var(--tiger-border)]">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-[var(--tiger-muted)]">Score Filter</span>
                  <span className="text-[10px] font-mono text-[var(--tiger-muted)]">
                    {hybridThreshold > 0 ? `≥ ${(hybridThreshold / 1000).toFixed(3)}` : 'Off'}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="30"
                  step="1"
                  value={hybridThreshold}
                  onChange={(e) => setHybridThreshold(parseInt(e.target.value))}
                  className="w-full"
                  style={{
                    background: hybridThreshold > 0 
                      ? `linear-gradient(to right, var(--tiger-yellow) 0%, var(--tiger-yellow) ${(hybridThreshold/30)*100}%, var(--tiger-border) ${(hybridThreshold/30)*100}%, var(--tiger-border) 100%)`
                      : 'var(--tiger-border)'
                  }}
                />
              </div>

              <HybridResultsList results={hybridResults} />
              
              {hybridResults && 'explanation' in hybridResults && hybridResults.explanation && (
                <CollapsibleQueryBox explanation={hybridResults.explanation} />
              )}
            </div>
          </div>
        </div>

        {/* Footer Comparison */}
        {(nativeResults || bm25Results) && (
          <div className="mt-6 p-5 rounded-lg bg-[var(--tiger-card)] border border-[var(--tiger-border)]">
            <div className="grid md:grid-cols-4 gap-6 text-xs">
              <div>
                <div className="font-medium text-[var(--tiger-muted)] mb-2">Native PostgreSQL</div>
                <div className="space-y-1 text-[var(--tiger-muted)]">
                  <div>• Boolean AND matching</div>
                  <div>• No IDF weighting</div>
                  <div>• No length normalization</div>
                </div>
              </div>
              <div>
                <div className="font-medium text-white mb-2">BM25 (pg_textsearch)</div>
                <div className="space-y-1 text-[var(--tiger-muted)]">
                  <div className="text-[var(--tiger-success)]">✓ IDF: rare terms weighted higher</div>
                  <div className="text-[var(--tiger-success)]">✓ Ranked retrieval</div>
                  <div className="text-[var(--tiger-success)]">✓ Length normalization</div>
                </div>
              </div>
              <div>
                <div className="font-medium text-white mb-2">Vector (pgvectorscale)</div>
                <div className="space-y-1 text-[var(--tiger-muted)]">
                  <div className="text-[var(--tiger-success)]">✓ Semantic understanding</div>
                  <div className="text-[var(--tiger-success)]">✓ DiskANN index</div>
                  <div className="text-[var(--tiger-success)]">✓ OpenAI embeddings</div>
                </div>
              </div>
              <div>
                <div className="font-medium text-white mb-2">Hybrid (BM25 + Vector)</div>
                <div className="space-y-1 text-[var(--tiger-muted)]">
                  <div className="text-[var(--tiger-success)]">✓ Reciprocal Rank Fusion</div>
                  <div className="text-[var(--tiger-success)]">✓ Best of both worlds</div>
                  <div className="text-[var(--tiger-success)]">✓ Tunable balance</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ResultsPanel({
  title,
  subtitle,
  results,
  variant,
}: {
  title: string;
  subtitle: string;
  results: SearchResponse | null;
  variant: 'native' | 'bm25';
}) {
  const isNative = variant === 'native';

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-[var(--tiger-muted)]">{subtitle}</p>
        </div>
        {results && 'executionTime' in results && (
          <span className="text-[10px] text-[var(--tiger-muted)] font-mono">
            {results.executionTime}ms
          </span>
        )}
      </div>

      {/* Native: Show Boolean requirement */}
      {results && 'queryTerms' in results && results.queryTerms && isNative && (
        <div className="mb-3 flex flex-wrap gap-1 items-center">
          {results.queryTerms.map((term, i) => (
            <span key={term} className="flex items-center gap-1">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--tiger-border)] font-mono">{term}</span>
              {i < (results.queryTerms?.length || 0) - 1 && (
                <span className="text-[10px] text-[var(--tiger-error)] font-medium">AND</span>
              )}
            </span>
          ))}
        </div>
      )}

      {!results ? (
        <div className="text-center py-8 text-[var(--tiger-muted)]">
          <svg className="w-8 h-8 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-xs">Run a search</p>
        </div>
      ) : 'error' in results ? (
        <div className="text-center py-8 text-[var(--tiger-error)]">
          <p className="text-xs">Error: {(results as unknown as { error: string }).error}</p>
        </div>
      ) : !results.results || results.results.length === 0 ? (
        <div className="text-center py-8 text-[var(--tiger-muted)]">
          <p className="text-xs">No results</p>
        </div>
      ) : (
        <div className="space-y-2">
          {results.results.slice(0, 5).map((result, idx) => (
            <div
              key={result.id}
              className="p-2.5 rounded-md bg-[var(--tiger-dark)] border border-[var(--tiger-border)] hover:border-[var(--tiger-yellow)]/50 transition-colors"
            >
              <div className="flex items-start gap-2">
                <div className="w-5 h-5 rounded bg-[var(--tiger-border)] flex items-center justify-center text-[10px] font-medium shrink-0">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium text-xs">{result.title}</h3>
                    <span className="text-[10px] font-mono text-[var(--tiger-muted)] shrink-0">
                      {typeof result.score === 'number' 
                        ? result.score.toFixed(3) 
                        : parseFloat(result.score)?.toFixed(3) ?? 'N/A'}
                    </span>
                  </div>
                  
                  <ContentSnippet 
                    content={result.content} 
                    matchedTerms={result.matchAnalysis?.matchedTerms}
                  />
                  
                  {result.matchAnalysis && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {result.matchAnalysis.matchedTerms.slice(0, 3).map(term => (
                        <span key={term} className="text-[10px] px-1 py-0.5 rounded badge-green">
                          {term}
                        </span>
                      ))}
                    </div>
                  )}
                  
                  <span className="text-[10px] text-[var(--tiger-muted)]">{result.category}</span>
                </div>
              </div>
            </div>
          ))}
          
          {results.results.length > 5 && (
            <p className="text-[10px] text-[var(--tiger-muted)] text-center pt-1">
              +{results.results.length - 5} more
            </p>
          )}
        </div>
      )}

      {results && 'explanation' in results && results.explanation && (
        <CollapsibleQueryBox explanation={results.explanation} />
      )}
    </div>
  );
}

function HybridResultsList({ results }: { results: SearchResponse | null }) {
  if (!results) {
    return (
      <div className="text-center py-8 text-[var(--tiger-muted)]">
        <svg className="w-8 h-8 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <p className="text-xs">Run a search</p>
      </div>
    );
  }
  
  if ('error' in results) {
    return (
      <div className="text-center py-8 text-[var(--tiger-error)]">
        <p className="text-xs">Error: {(results as unknown as { error: string }).error}</p>
      </div>
    );
  }
  
  if (!results.results || results.results.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--tiger-muted)]">
        <p className="text-xs">No results</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {results.results.slice(0, 5).map((result, idx) => (
        <div
          key={result.id}
          className="p-2.5 rounded-md bg-[var(--tiger-dark)] border border-[var(--tiger-border)] hover:border-[var(--tiger-yellow)]/50 transition-colors"
        >
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 rounded bg-[var(--tiger-yellow)] flex items-center justify-center text-[10px] font-medium shrink-0 text-black">
              {idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium text-xs">{result.title}</h3>
                <span className="text-[10px] font-mono text-[var(--tiger-muted)] shrink-0">
                  {typeof result.score === 'number' 
                    ? result.score.toFixed(4) 
                    : parseFloat(result.score)?.toFixed(4) ?? 'N/A'}
                </span>
              </div>
              
              <ContentSnippet 
                content={result.content} 
                matchedTerms={result.matchAnalysis?.matchedTerms}
              />
              
              {result.matchAnalysis && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {result.matchAnalysis.keywordRank && result.matchAnalysis.keywordRank !== 'N/A' && (
                    <span className="text-[10px] px-1 py-0.5 rounded badge-yellow">
                      KW #{result.matchAnalysis.keywordRank}
                    </span>
                  )}
                  {result.matchAnalysis.vectorRank && result.matchAnalysis.vectorRank !== 'N/A' && (
                    <span className="text-[10px] px-1 py-0.5 rounded badge-gray">
                      Vec #{result.matchAnalysis.vectorRank}
                    </span>
                  )}
                  {result.matchAnalysis.vectorRank !== 'N/A' && result.matchAnalysis.keywordRank !== 'N/A' && (
                    <span className="text-[10px] px-1 py-0.5 rounded badge-green">
                      Both ✓
                    </span>
                  )}
                </div>
              )}
              
              <span className="text-[10px] text-[var(--tiger-muted)]">{result.category}</span>
            </div>
          </div>
        </div>
      ))}
      
      {results.results.length > 5 && (
        <p className="text-[10px] text-[var(--tiger-muted)] text-center pt-1">
          +{results.results.length - 5} more
        </p>
      )}
    </div>
  );
}

function BM25ResultsList({ results, scoreThreshold }: { results: SearchResponse | null; scoreThreshold: number }) {
  if (!results) {
    return (
      <div className="text-center py-8 text-[var(--tiger-muted)]">
        <svg className="w-8 h-8 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <p className="text-xs">Run a search</p>
      </div>
    );
  }
  
  if ('error' in results) {
    return (
      <div className="text-center py-8 text-[var(--tiger-error)]">
        <p className="text-xs">Error: {(results as unknown as { error: string }).error}</p>
      </div>
    );
  }
  
  if (!results.results || results.results.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--tiger-muted)]">
        <p className="text-xs">No results{scoreThreshold > 0 ? ` above ${scoreThreshold.toFixed(1)}` : ''}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {results.results.slice(0, 5).map((result, idx) => (
        <div
          key={result.id}
          className="p-2.5 rounded-md bg-[var(--tiger-dark)] border border-[var(--tiger-border)] hover:border-[var(--tiger-yellow)]/50 transition-colors"
        >
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 rounded bg-[var(--tiger-yellow)] flex items-center justify-center text-[10px] font-medium shrink-0 text-black">
              {idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium text-xs">{result.title}</h3>
                <span className="text-[10px] font-mono text-[var(--tiger-muted)] shrink-0">
                  {typeof result.score === 'number' 
                    ? result.score.toFixed(3) 
                    : parseFloat(result.score)?.toFixed(3) ?? 'N/A'}
                </span>
              </div>
              
              <ContentSnippet 
                content={result.content} 
                matchedTerms={result.matchAnalysis?.matchedTerms}
              />
              
              {/* Show matched and missing terms */}
              {result.matchAnalysis && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {result.matchAnalysis.matchedTerms.slice(0, 3).map(term => (
                    <span key={term} className="text-[10px] px-1 py-0.5 rounded badge-green">
                      ✓ {term}
                    </span>
                  ))}
                  {result.matchAnalysis.missingTerms.slice(0, 2).map(term => (
                    <span key={term} className="text-[10px] px-1 py-0.5 rounded badge-red opacity-60">
                      ✗ {term}
                    </span>
                  ))}
                </div>
              )}
              
              <span className="text-[10px] text-[var(--tiger-muted)]">{result.category}</span>
            </div>
          </div>
        </div>
      ))}
      
      {results.results.length > 5 && (
        <p className="text-[10px] text-[var(--tiger-muted)] text-center pt-1">
          +{results.results.length - 5} more
        </p>
      )}
    </div>
  );
}

function VectorResultsList({ results }: { results: SearchResponse | null }) {
  if (!results) {
    return (
      <div className="text-center py-8 text-[var(--tiger-muted)]">
        <svg className="w-8 h-8 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <p className="text-xs">Run a search</p>
      </div>
    );
  }
  
  if ('error' in results) {
    return (
      <div className="text-center py-8 text-[var(--tiger-error)]">
        <p className="text-xs">Error: {(results as unknown as { error: string }).error}</p>
      </div>
    );
  }
  
  if (!results.results || results.results.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--tiger-muted)]">
        <p className="text-xs">No results</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {results.results.slice(0, 5).map((result, idx) => {
        const similarity = typeof result.score === 'number' ? result.score : parseFloat(result.score) || 0;
        const similarityPct = (similarity * 100).toFixed(0);
        
        return (
          <div
            key={result.id}
            className="p-2.5 rounded-md bg-[var(--tiger-dark)] border border-[var(--tiger-border)] hover:border-[var(--tiger-yellow)]/50 transition-colors"
          >
            <div className="flex items-start gap-2">
              <div className="w-5 h-5 rounded bg-[var(--tiger-border)] flex items-center justify-center text-[10px] font-medium shrink-0">
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-xs">{result.title}</h3>
                  <span className="text-[10px] font-mono text-[var(--tiger-muted)] shrink-0">
                    {similarityPct}%
                  </span>
                </div>
                <ContentSnippet content={result.content} />
                <span className="text-[10px] text-[var(--tiger-muted)]">{result.category}</span>
              </div>
            </div>
          </div>
        );
      })}
      
      {results.results.length > 5 && (
        <p className="text-[10px] text-[var(--tiger-muted)] text-center pt-1">
          +{results.results.length - 5} more
        </p>
      )}
    </div>
  );
}

function CollapsibleQueryBox({ explanation }: { explanation: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-3 pt-3 border-t border-[var(--tiger-border)]">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between text-[10px] text-[var(--tiger-muted)] hover:text-white transition-colors"
      >
        <span className="flex items-center gap-1">
          <svg 
            className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-90' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          SQL Query
        </span>
      </button>
      
      {isOpen && (
        <div className="mt-2 p-2 rounded bg-[var(--tiger-dark)] border border-[var(--tiger-border)] overflow-x-auto">
          <pre className="text-[10px] font-mono text-[var(--tiger-muted)] whitespace-pre-wrap leading-relaxed">
            {explanation}
          </pre>
        </div>
      )}
    </div>
  );
}
