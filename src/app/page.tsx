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

const DEMO_QUERIES = [
  // Traditional search scenarios
  { 
    query: 'database connection pooling', 
    description: 'Boolean vs Ranked: Native requires ALL terms, BM25 includes partial matches',
    highlight: 'boolean',
    category: 'traditional'
  },
  { 
    query: 'database authentication', 
    description: 'IDF Weighting: "authentication" (1 doc) is weighted higher than "database" (6 docs)',
    highlight: 'idf',
    category: 'traditional'
  },
  { 
    query: 'explain analyze postgresql', 
    description: 'Length Normalization: Long doc has more keywords, but BM25 favors focused short doc',
    highlight: 'length',
    category: 'traditional'
  },
  // AI/Agent scenarios - designed to show Hybrid winning
  { 
    query: 'make database faster', 
    description: '🤖 All methods find "Making Your Database Faster". Hybrid gives strongest confidence.',
    highlight: 'agent-speed',
    category: 'agent'
  },
  { 
    query: 'fix connection pool problems', 
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
  const [searchQuery, setSearchQuery] = useState('database connection pooling');
  const [nativeResults, setNativeResults] = useState<SearchResponse | null>(null);
  const [bm25Results, setBm25Results] = useState<SearchResponse | null>(null);
  const [vectorResults, setVectorResults] = useState<SearchResponse | null>(null);
  const [hybridResults, setHybridResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState<'unknown' | 'ready' | 'error'>('unknown');
  const [currentScenario, setCurrentScenario] = useState<string | null>('boolean');
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
      <header className="border-b border-[var(--tiger-border)] bg-[var(--tiger-dark)]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1800px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[var(--tiger-orange)] to-[var(--tiger-yellow)] flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold">BM25 Search Demo</h1>
              <p className="text-sm text-[var(--tiger-muted)]">pg_textsearch vs Native PostgreSQL</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={checkDatabase}
              className="text-sm text-[var(--tiger-muted)] hover:text-white transition-colors"
            >
              {dbStatus === 'unknown' && '● Check DB'}
              {dbStatus === 'ready' && <span className="text-[var(--tiger-success)]">● Connected</span>}
              {dbStatus === 'error' && <span className="text-[var(--tiger-error)]">● Disconnected</span>}
            </button>
            <a
              href="https://www.tigerdata.com/blog/introducing-pg_textsearch-true-bm25-ranking-hybrid-retrieval-postgres"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[var(--tiger-orange)] hover:underline"
            >
              Read the Blog →
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-[1800px] mx-auto px-6 py-8">
        {/* Search Section */}
        <div className="mb-8">
          <div className="flex gap-4 mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search technical documentation..."
              className="search-input flex-1 px-5 py-4 text-lg"
            />
            <button
              onClick={runSearch}
              disabled={loading}
              className="px-8 py-4 bg-gradient-to-r from-[var(--tiger-orange)] to-[var(--tiger-yellow)] text-white font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? <div className="spinner" /> : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Compare All
                </>
              )}
            </button>
          </div>

          {/* Demo Queries - Traditional */}
          <div className="flex flex-wrap gap-2 items-center mb-2">
            <span className="text-sm text-[var(--tiger-muted)]">Traditional Search:</span>
            {DEMO_QUERIES.filter(q => q.category === 'traditional').map((item) => (
              <button
                key={item.query}
                onClick={() => runDemoQuery(item.query, item.highlight)}
                disabled={loading}
                className={`text-sm px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50 ${
                  currentScenario === item.highlight 
                    ? 'bg-[var(--tiger-orange)] border-[var(--tiger-orange)] text-white' 
                    : 'bg-[var(--tiger-dark)] border-[var(--tiger-border)] hover:border-[var(--tiger-orange)]'
                }`}
                title={item.description}
              >
                {item.query}
              </button>
            ))}
        </div>

          {/* Demo Queries - Agent/AI */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-[var(--tiger-muted)]">🤖 AI Agent Queries:</span>
            {DEMO_QUERIES.filter(q => q.category === 'agent').map((item) => (
          <button
                key={item.query}
                onClick={() => runDemoQuery(item.query, item.highlight)}
                disabled={loading}
                className={`text-sm px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50 ${
                  currentScenario === item.highlight 
                    ? 'bg-gradient-to-r from-[var(--tiger-yellow)] to-[var(--tiger-orange)] border-transparent text-white' 
                    : 'bg-[var(--tiger-dark)] border-[var(--tiger-border)] hover:border-[var(--tiger-yellow)]'
                }`}
                title={item.description}
              >
                {item.query}
          </button>
            ))}
          </div>

          {/* Scenario Explanation - Simple & Clear */}
          {currentScenario && (
            <div className="mt-4 p-4 rounded-xl bg-[var(--tiger-darker)] border border-[var(--tiger-border)]/30">
              
              {currentScenario === 'boolean' && (
                <div>
                  <div className="text-sm text-[var(--tiger-muted)] mb-2">
                    Query: <code className="text-white">&quot;database connection pooling&quot;</code>
                  </div>
                  <h3 className="text-base font-semibold text-white mb-2">Boolean AND vs Ranked Retrieval</h3>
                  <p className="text-sm text-[var(--tiger-muted)] leading-relaxed">
                    Native PostgreSQL requires documents to contain ALL three words: &quot;database&quot; AND &quot;connection&quot; AND &quot;pooling&quot;. 
                    Great articles about connection pooling that don&apos;t mention &quot;database&quot; are excluded entirely.
                    BM25 ranks all relevant documents — partial matches still appear, just scored lower.
                  </p>
                </div>
              )}
              
              {currentScenario === 'idf' && (
                <div>
                  <div className="text-sm text-[var(--tiger-muted)] mb-2">
                    Query: <code className="text-white">&quot;database authentication&quot;</code>
                  </div>
                  <h3 className="text-base font-semibold text-white mb-2">IDF: Rare Terms Are More Meaningful</h3>
                  <p className="text-sm text-[var(--tiger-muted)] leading-relaxed">
                    &quot;database&quot; appears in 6 out of 10 documents — it&apos;s too common to be useful for ranking.
                    &quot;authentication&quot; appears in only 1 document — this is the discriminating term that identifies what you actually want.
                    BM25 automatically gives ~4× higher weight to &quot;authentication&quot;. Native treats both words equally.
                  </p>
                </div>
              )}
              
              {currentScenario === 'length' && (
                <div>
                  <div className="text-sm text-[var(--tiger-muted)] mb-2">
                    Query: <code className="text-white">&quot;explain analyze postgresql&quot;</code>
                  </div>
                  <h3 className="text-base font-semibold text-white mb-2">Length Normalization</h3>
                  <p className="text-sm text-[var(--tiger-muted)] leading-relaxed">
                    The long doc (69 words) has 5× &quot;EXPLAIN&quot; and 7× &quot;PostgreSQL&quot;. The short doc (18 words) has only 2× &quot;EXPLAIN&quot; and 1× &quot;PostgreSQL&quot;.
                    Native ts_rank ranks the long doc #1 because it has more keyword occurrences.
                    BM25 with length normalization (b=0.75) ranks the short, focused tip #1 — recognizing that keyword density matters more than raw count.
                  </p>
                </div>
              )}

              {/* Agent/AI Scenarios - Designed to show Hybrid winning */}
              {currentScenario === 'agent-speed' && (
                <div>
                  <div className="text-sm text-[var(--tiger-muted)] mb-2">
                    Query: <code className="text-white">&quot;make database faster&quot;</code>
                  </div>
                  <h3 className="text-base font-semibold text-white mb-2">🤖 Hybrid Reinforces Both Signals</h3>
                  <p className="text-sm text-[var(--tiger-muted)] leading-relaxed">
                    Native returns 0 results (Boolean AND requires all terms).
                    BM25 finds &quot;Making Your Database Faster&quot; via keyword match (&quot;database&quot; + &quot;faster&quot;).
                    Vector also finds it via semantic similarity.
                    Hybrid combines BOTH signals — when a doc ranks high in both keyword AND semantic search, it gets the highest combined score.
                  </p>
                </div>
              )}

              {currentScenario === 'agent-troubleshoot' && (
                <div>
                  <div className="text-sm text-[var(--tiger-muted)] mb-2">
                    Query: <code className="text-white">&quot;fix connection pool problems&quot;</code>
                  </div>
                  <h3 className="text-base font-semibold text-white mb-2">🤖 Troubleshooting Query → Native Fails, Others Work</h3>
                  <p className="text-sm text-[var(--tiger-muted)] leading-relaxed">
                    Native returns 0 results — requires ALL terms but &quot;fix&quot; isn&apos;t in docs.
                    BM25 finds &quot;Connection Pool Troubleshooting Guide&quot; because it contains &quot;problems&quot;.
                    Vector also finds it via semantic understanding of troubleshooting context.
                    Hybrid reinforces this result by combining both keyword and semantic signals.
                  </p>
                </div>
              )}

              {currentScenario === 'agent-security' && (
                <div>
                  <div className="text-sm text-[var(--tiger-muted)] mb-2">
                    Query: <code className="text-white">&quot;secure my postgres database&quot;</code>
                  </div>
                  <h3 className="text-base font-semibold text-white mb-2">🤖 Security Query → Native Fails, Others Work</h3>
                  <p className="text-sm text-[var(--tiger-muted)] leading-relaxed">
                    Native returns 0 results — no doc matches all terms including &quot;my&quot;.
                    BM25 finds &quot;Protecting Database Access&quot; via partial keyword matches.
                    Vector understands security/protection intent and finds relevant security docs.
                    Hybrid combines both: the doc about protecting database access ranks highest.
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
            <div className="absolute inset-0 bg-[var(--tiger-dark)]/80 backdrop-blur-sm z-10 flex items-center justify-center rounded-xl">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-3 border-[var(--tiger-orange)] border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm text-[var(--tiger-muted)]">Searching all methods...</span>
              </div>
            </div>
          )}
          
          <div className="grid lg:grid-cols-4 gap-4">
            {/* Column 1: Native PostgreSQL */}
            <ResultsPanel
              title="🐘 Native PostgreSQL"
              subtitle="ts_rank + Boolean AND"
              results={nativeResults}
              variant="native"
              accentColor="var(--tiger-muted)"
            />
          
          {/* Column 2: BM25 with Score Threshold */}
          <div className="card p-5" style={{ borderTopColor: 'var(--tiger-orange)', borderTopWidth: '3px' }}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">🔥 BM25 (pg_textsearch)</h2>
                <p className="text-sm text-[var(--tiger-muted)]">IDF + Saturation + Length Norm</p>
              </div>
              {bm25Results && 'executionTime' in bm25Results && (
                <span className="text-xs text-[var(--tiger-muted)] font-mono">
                  {bm25Results.executionTime}ms
                </span>
              )}
            </div>

            {/* Score Threshold Filter */}
            <div className="mb-4 p-3 rounded-lg bg-[var(--tiger-darker)] border border-[var(--tiger-border)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-[var(--tiger-muted)]">Score Threshold Filter</span>
                <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                  scoreThreshold > 0 
                    ? 'bg-[var(--tiger-orange)]/20 text-[var(--tiger-orange)]' 
                    : 'bg-[var(--tiger-border)] text-[var(--tiger-muted)]'
                }`}>
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
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                style={{
                  background: scoreThreshold > 0 
                    ? `linear-gradient(to right, var(--tiger-orange) 0%, var(--tiger-orange) ${(scoreThreshold/3)*100}%, var(--tiger-border) ${(scoreThreshold/3)*100}%, var(--tiger-border) 100%)`
                    : 'var(--tiger-border)'
                }}
              />
              <div className="flex justify-between mt-1 text-[10px] text-[var(--tiger-muted)]">
                <span>Off</span>
                <span>1.0</span>
                <span>2.0</span>
                <span>3.0</span>
              </div>
              {scoreThreshold > 0 && (
                <p className="text-[10px] text-[var(--tiger-orange)] mt-2">
                  Filtering out results with score &lt; {scoreThreshold.toFixed(1)}
                </p>
              )}
            </div>

            {/* Term Stats Summary */}
            {bm25Results && 'termStats' in bm25Results && bm25Results.termStats && (
              <div className="mb-4 p-3 rounded-lg bg-[var(--tiger-dark)] border border-[var(--tiger-border)]">
                <div className="text-xs font-medium text-[var(--tiger-muted)] mb-2">Query Term IDF</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(bm25Results.termStats).map(([term, stats]) => (
                    <div 
                      key={term}
                      className={`px-2 py-1 rounded text-xs ${
                        stats.docFreq <= 3 
                          ? 'bg-[var(--tiger-orange)]/20 text-[var(--tiger-orange)]' 
                          : stats.docFreq <= 7
                          ? 'bg-[var(--tiger-yellow)]/20 text-[var(--tiger-yellow)]'
                          : 'bg-[var(--tiger-border)] text-[var(--tiger-muted)]'
                      }`}
                    >
                      <span className="font-mono">{term}</span>
                      <span className="ml-1 opacity-75">({stats.docFreq}/10)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Results */}
            <BM25ResultsList results={bm25Results} scoreThreshold={scoreThreshold} />
            
            {/* Collapsible SQL Query */}
            {bm25Results && 'explanation' in bm25Results && bm25Results.explanation && (
              <CollapsibleQueryBox explanation={bm25Results.explanation} accentColor="var(--tiger-orange)" />
            )}
          </div>
          
          {/* Column 3: Pure Vector Search (RAG) */}
          <div className="card overflow-hidden">
            {/* Purple top border for AI/Vector */}
            <div className="h-[3px] bg-gradient-to-r from-purple-500 to-pink-500"></div>
            <div className="p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold">🧠 Vector (RAG)</h2>
                  <p className="text-sm text-[var(--tiger-muted)]">OpenAI + pgvectorscale</p>
                </div>
                {vectorResults && 'executionTime' in vectorResults && (
                  <span className="text-xs text-[var(--tiger-muted)] font-mono">
                    {vectorResults.executionTime}ms
                  </span>
                )}
              </div>

              {/* Vector Results */}
              <VectorResultsList results={vectorResults} />
              
              {/* Collapsible SQL Query */}
              {vectorResults && 'explanation' in vectorResults && vectorResults.explanation && (
                <CollapsibleQueryBox explanation={vectorResults.explanation} accentColor="#a855f7" />
              )}
            </div>
          </div>
          
          {/* Column 4: Hybrid with Slider */}
          <div className="card overflow-hidden">
            {/* Gradient top border */}
            <div className="h-[3px] bg-gradient-to-r from-[var(--tiger-yellow)] to-[var(--tiger-orange)]"></div>
            <div className="p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">🔀 Hybrid</h2>
                <p className="text-sm text-[var(--tiger-muted)]">BM25 + Vector</p>
              </div>
              {hybridResults && 'executionTime' in hybridResults && (
                <span className="text-xs text-[var(--tiger-muted)] font-mono">
                  {hybridResults.executionTime}ms
                </span>
              )}
            </div>

            {/* Hybrid Mix Slider */}
            <div className="mb-3 p-3 rounded-xl bg-[var(--tiger-darker)]/50">
              <div className="text-xs text-[var(--tiger-muted)] mb-2">Keyword ↔ Semantic Balance</div>
              {/* Slider */}
              <input
                type="range"
                min="0"
                max="100"
                value={hybridMix}
                onChange={(e) => setHybridMix(parseInt(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer hybrid-slider"
                style={{
                  background: `linear-gradient(to right, 
                    var(--tiger-yellow) 0%, 
                    var(--tiger-yellow) ${100 - hybridMix}%, 
                    var(--tiger-orange) ${100 - hybridMix}%, 
                    var(--tiger-orange) 100%)`
                }}
              />
              
              {/* Labels */}
              <div className="flex justify-between mt-2 text-xs">
                <div className="text-[var(--tiger-yellow)]">
                  <span className="font-mono font-medium">{(keywordWeight * 100).toFixed(0)}%</span>
                  <span className="text-[var(--tiger-muted)] ml-1">BM25</span>
                </div>
                <div className="text-[var(--tiger-orange)] text-right">
                  <span className="font-mono font-medium">{(vectorWeight * 100).toFixed(0)}%</span>
                  <span className="text-[var(--tiger-muted)] ml-1">Vector</span>
                </div>
              </div>
            </div>

            {/* Hybrid Score Threshold */}
            <div className="mb-4 p-3 rounded-xl bg-[var(--tiger-darker)]/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[var(--tiger-muted)]">Score Threshold</span>
                <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                  hybridThreshold > 0 
                    ? 'bg-[var(--tiger-yellow)]/20 text-[var(--tiger-yellow)]' 
                    : 'bg-[var(--tiger-border)] text-[var(--tiger-muted)]'
                }`}>
                  {hybridThreshold > 0 ? `≥ ${(hybridThreshold / 1000).toFixed(4)}` : 'Off'}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="30"
                step="1"
                value={hybridThreshold}
                onChange={(e) => setHybridThreshold(parseInt(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                style={{
                  background: hybridThreshold > 0 
                    ? `linear-gradient(to right, var(--tiger-yellow) 0%, var(--tiger-yellow) ${(hybridThreshold/30)*100}%, var(--tiger-border) ${(hybridThreshold/30)*100}%, var(--tiger-border) 100%)`
                    : 'var(--tiger-border)'
                }}
              />
              <div className="flex justify-between mt-1 text-[10px] text-[var(--tiger-muted)]">
                <span>Off</span>
                <span>0.01</span>
                <span>0.02</span>
                <span>0.03</span>
              </div>
              {hybridThreshold > 0 && (
                <p className="text-[10px] text-[var(--tiger-yellow)] mt-2">
                  Filtering results with RRF score &lt; {(hybridThreshold / 1000).toFixed(4)}
                </p>
              )}
            </div>

            {/* Hybrid Results */}
            <HybridResultsList results={hybridResults} />
            
            {/* Collapsible SQL Query */}
            {hybridResults && 'explanation' in hybridResults && hybridResults.explanation && (
              <CollapsibleQueryBox 
                explanation={hybridResults.explanation} 
                accentColor="var(--tiger-yellow)" 
              />
            )}
            </div>
          </div>
          </div>
        </div>

        {/* Explanation Section */}
        {(nativeResults || bm25Results) && (
          <div className="mt-8 p-6 rounded-xl bg-gradient-to-r from-[var(--tiger-dark)] via-[var(--tiger-card)] to-[var(--tiger-dark)] border border-[var(--tiger-border)]/30">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-medium text-[var(--tiger-muted)] uppercase tracking-wider">Search Algorithm Comparison</h3>
              <a 
                href="https://www.tigerdata.com/docs/use-timescale/latest/extensions/pg-textsearch" 
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--tiger-orange)] hover:underline"
              >
                Documentation →
              </a>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-[var(--tiger-muted)]"></span>
                  <span className="text-sm font-medium text-[var(--tiger-muted)]">Native PostgreSQL</span>
                </div>
                <div className="space-y-2 text-xs text-[var(--tiger-muted)]">
                  <div>No IDF weighting</div>
                  <div>Boolean AND matching</div>
                  <div>No length normalization</div>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-[var(--tiger-orange)]"></span>
                  <span className="text-sm font-medium text-white">BM25 (pg_textsearch)</span>
                </div>
                <div className="space-y-2 text-xs text-[var(--tiger-muted)]">
                  <div><span className="text-[var(--tiger-success)]">✓</span> IDF: rare terms weighted higher</div>
                  <div><span className="text-[var(--tiger-success)]">✓</span> Ranked retrieval with partial matches</div>
                  <div><span className="text-[var(--tiger-success)]">✓</span> Length normalization (b=0.75)</div>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2 h-2 rounded-full bg-gradient-to-r from-[var(--tiger-yellow)] to-[var(--tiger-orange)]"></span>
                  <span className="text-sm font-medium text-white">Hybrid (BM25 + pgvectorscale)</span>
                </div>
                <div className="space-y-2 text-xs text-[var(--tiger-muted)]">
                  <div><span className="text-[var(--tiger-success)]">✓</span> pgvectorscale with DiskANN index</div>
                  <div><span className="text-[var(--tiger-success)]">✓</span> Reciprocal Rank Fusion</div>
                  <div><span className="text-[var(--tiger-success)]">✓</span> Tunable keyword/semantic balance</div>
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
  accentColor,
}: {
  title: string;
  subtitle: string;
  results: SearchResponse | null;
  variant: 'native' | 'bm25';
  accentColor: string;
}) {
  const isNative = variant === 'native';

  return (
    <div className="card p-5" style={{ borderTopColor: accentColor, borderTopWidth: '3px' }}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-[var(--tiger-muted)]">{subtitle}</p>
        </div>
        {results && 'executionTime' in results && (
          <span className="text-xs text-[var(--tiger-muted)] font-mono">
            {results.executionTime}ms
          </span>
        )}
      </div>

      {/* Term Stats Summary for BM25 */}
      {results && 'termStats' in results && results.termStats && !isNative && (
        <div className="mb-4 p-3 rounded-lg bg-[var(--tiger-dark)] border border-[var(--tiger-border)]">
          <div className="text-xs font-medium text-[var(--tiger-muted)] mb-2">Query Term IDF</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(results.termStats).map(([term, stats]) => (
              <div 
                key={term}
                className={`px-2 py-1 rounded text-xs ${
                  stats.docFreq <= 3 
                    ? 'bg-[var(--tiger-orange)]/20 text-[var(--tiger-orange)]' 
                    : stats.docFreq <= 7
                    ? 'bg-[var(--tiger-yellow)]/20 text-[var(--tiger-yellow)]'
                    : 'bg-[var(--tiger-border)] text-[var(--tiger-muted)]'
                }`}
              >
                <span className="font-mono">{term}</span>
                <span className="ml-1 opacity-75">({stats.docFreq}/10)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Native: Show Boolean requirement */}
      {results && 'queryTerms' in results && results.queryTerms && isNative && (
        <div className="mb-4 p-3 rounded-lg bg-[var(--tiger-dark)] border border-[var(--tiger-border)]">
          <div className="text-xs font-medium text-[var(--tiger-muted)] mb-2">Boolean AND</div>
          <div className="flex flex-wrap gap-1 items-center">
            {results.queryTerms.map((term, i) => (
              <span key={term} className="flex items-center gap-1">
                <span className="px-2 py-0.5 rounded bg-[var(--tiger-border)] font-mono text-xs">{term}</span>
                {i < (results.queryTerms?.length || 0) - 1 && (
                  <span className="text-[var(--tiger-error)] font-bold text-xs">AND</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {!results ? (
        <div className="text-center py-8 text-[var(--tiger-muted)]">
          <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-sm">Run a search</p>
        </div>
      ) : 'error' in results ? (
        <div className="text-center py-8 text-[var(--tiger-error)]">
          <p className="text-sm">Error: {(results as unknown as { error: string }).error}</p>
        </div>
      ) : !results.results || results.results.length === 0 ? (
        <div className="text-center py-8 text-[var(--tiger-muted)]">
          <p className="text-sm">No results found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {results.results.slice(0, 5).map((result, idx) => (
            <div
              key={result.id}
              className="p-3 rounded-lg bg-[var(--tiger-darker)] border border-[var(--tiger-border)] hover:border-[var(--tiger-orange)]/50 transition-colors"
            >
              <div className="flex items-start gap-2">
                <div className="w-6 h-6 rounded-full bg-[var(--tiger-border)] flex items-center justify-center text-xs font-bold shrink-0">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium text-sm truncate">{result.title}</h3>
                    <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[var(--tiger-border)]">
                      {typeof result.score === 'number' 
                        ? result.score.toFixed(3) 
                        : parseFloat(result.score)?.toFixed(3) ?? 'N/A'}
                    </span>
                  </div>
                  
                  {/* Match Terms */}
                  {result.matchAnalysis && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {result.matchAnalysis.matchedTerms.slice(0, 3).map(term => (
                        <span key={term} className="text-xs px-1.5 py-0.5 rounded bg-[var(--tiger-success)]/20 text-[var(--tiger-success)]">
                          {term}
                        </span>
                      ))}
                      {result.matchAnalysis.missingTerms.slice(0, 2).map(term => (
                        <span key={term} className="text-xs px-1.5 py-0.5 rounded bg-[var(--tiger-error)]/20 text-[var(--tiger-error)] line-through">
                          {term}
                    </span>
                      ))}
                    </div>
                  )}
                  
                  <span className="text-xs text-[var(--tiger-muted)]">{result.category}</span>
                </div>
              </div>
            </div>
          ))}
          
          {results.results.length > 5 && (
            <p className="text-xs text-[var(--tiger-muted)] text-center pt-2">
              +{results.results.length - 5} more results
            </p>
          )}
        </div>
      )}

      {/* Collapsible SQL Query */}
      {results && 'explanation' in results && results.explanation && (
        <CollapsibleQueryBox explanation={results.explanation} accentColor={accentColor} />
      )}
    </div>
  );
}

function HybridResultsList({ results }: { results: SearchResponse | null }) {
  if (!results) {
    return (
      <div className="text-center py-8 text-[var(--tiger-muted)]">
        <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <p className="text-sm">Run a search</p>
      </div>
    );
  }
  
  if ('error' in results) {
    return (
      <div className="text-center py-8 text-[var(--tiger-error)]">
        <p className="text-sm">Error: {(results as unknown as { error: string }).error}</p>
      </div>
    );
  }
  
  if (!results.results || results.results.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--tiger-muted)]">
        <p className="text-sm">No results found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {results.results.slice(0, 5).map((result, idx) => (
        <div
          key={result.id}
          className="p-3 rounded-lg bg-[var(--tiger-darker)] border border-[var(--tiger-border)] hover:border-[var(--tiger-orange)]/50 transition-colors"
        >
          <div className="flex items-start gap-2">
            <div className="w-6 h-6 rounded-full bg-gradient-to-r from-[var(--tiger-yellow)] to-[var(--tiger-orange)] flex items-center justify-center text-xs font-bold shrink-0 text-black">
              {idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-medium text-sm truncate">{result.title}</h3>
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-gradient-to-r from-[var(--tiger-yellow)]/20 to-[var(--tiger-orange)]/20">
                  {typeof result.score === 'number' 
                    ? result.score.toFixed(4) 
                    : parseFloat(result.score)?.toFixed(4) ?? 'N/A'}
                </span>
              </div>
              
              {/* Hybrid ranks */}
              {result.matchAnalysis && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {result.matchAnalysis.keywordRank && result.matchAnalysis.keywordRank !== 'N/A' && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--tiger-yellow)]/20 text-[var(--tiger-yellow)]">
                      KW #{result.matchAnalysis.keywordRank}
                    </span>
                  )}
                  {result.matchAnalysis.vectorRank && result.matchAnalysis.vectorRank !== 'N/A' && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--tiger-orange)]/20 text-[var(--tiger-orange)]">
                      Vec #{result.matchAnalysis.vectorRank}
                    </span>
                  )}
                  {result.matchAnalysis.vectorRank !== 'N/A' && result.matchAnalysis.keywordRank !== 'N/A' && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--tiger-success)]/20 text-[var(--tiger-success)]">
                      Both ✓
                    </span>
                  )}
                </div>
              )}
              
              <span className="text-xs text-[var(--tiger-muted)]">{result.category}</span>
            </div>
          </div>
        </div>
      ))}
      
      {results.results.length > 5 && (
        <p className="text-xs text-[var(--tiger-muted)] text-center pt-2">
          +{results.results.length - 5} more results
        </p>
      )}
    </div>
  );
}

function BM25ResultsList({ results, scoreThreshold }: { results: SearchResponse | null; scoreThreshold: number }) {
  if (!results) {
    return (
      <div className="text-center py-8 text-[var(--tiger-muted)]">
        <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <p className="text-sm">Run a search</p>
      </div>
    );
  }
  
  if ('error' in results) {
    return (
      <div className="text-center py-8 text-[var(--tiger-error)]">
        <p className="text-sm">Error: {(results as unknown as { error: string }).error}</p>
      </div>
    );
  }
  
  if (!results.results || results.results.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--tiger-muted)]">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--tiger-orange)]/10 flex items-center justify-center">
          <svg className="w-6 h-6 text-[var(--tiger-orange)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
        </div>
        <p className="text-sm">No results above threshold</p>
        {scoreThreshold > 0 && (
          <p className="text-xs mt-1">Score ≥ {scoreThreshold.toFixed(1)} required</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {results.results.slice(0, 5).map((result, idx) => (
        <div
          key={result.id}
          className="p-3 rounded-lg bg-[var(--tiger-darker)] border border-[var(--tiger-border)] hover:border-[var(--tiger-orange)]/50 transition-colors"
        >
          <div className="flex items-start gap-2">
            <div className="w-6 h-6 rounded-full bg-[var(--tiger-orange)] flex items-center justify-center text-xs font-bold shrink-0 text-black">
              {idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-medium text-sm truncate">{result.title}</h3>
                <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                  result.score >= 2.5 
                    ? 'bg-[var(--tiger-success)]/20 text-[var(--tiger-success)]'
                    : result.score >= 1.5
                    ? 'bg-[var(--tiger-orange)]/20 text-[var(--tiger-orange)]'
                    : 'bg-[var(--tiger-border)]'
                }`}>
                  {typeof result.score === 'number' 
                    ? result.score.toFixed(3) 
                    : parseFloat(result.score)?.toFixed(3) ?? 'N/A'}
                </span>
                {scoreThreshold > 0 && result.score >= scoreThreshold && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--tiger-success)]/20 text-[var(--tiger-success)]">
                    ✓ above threshold
                  </span>
                )}
              </div>
              
              {/* Match Terms */}
              {result.matchAnalysis && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {result.matchAnalysis.matchedTerms.slice(0, 3).map(term => (
                    <span key={term} className="text-xs px-1.5 py-0.5 rounded bg-[var(--tiger-success)]/20 text-[var(--tiger-success)]">
                      {term}
                    </span>
                  ))}
                  {result.matchAnalysis.missingTerms.slice(0, 2).map(term => (
                    <span key={term} className="text-xs px-1.5 py-0.5 rounded bg-[var(--tiger-error)]/20 text-[var(--tiger-error)] line-through">
                      {term}
                    </span>
                  ))}
                </div>
              )}
              
              <span className="text-xs text-[var(--tiger-muted)]">{result.category}</span>
            </div>
          </div>
        </div>
      ))}
      
      {results.results.length > 5 && (
        <p className="text-xs text-[var(--tiger-muted)] text-center pt-2">
          +{results.results.length - 5} more results
        </p>
      )}
    </div>
  );
}

// Vector Results List Component (for RAG/Semantic search)
function VectorResultsList({ results }: { results: SearchResponse | null }) {
  if (!results) {
    return (
      <div className="text-center py-8 text-[var(--tiger-muted)]">
        <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <p className="text-sm">Run a search</p>
      </div>
    );
  }
  
  if ('error' in results) {
    return (
      <div className="text-center py-8 text-[var(--tiger-error)]">
        <p className="text-sm">Error: {(results as unknown as { error: string }).error}</p>
      </div>
    );
  }
  
  if (!results.results || results.results.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--tiger-muted)]">
        <p className="text-sm">No results found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {results.results.slice(0, 5).map((result, idx) => {
        // Parse similarity from score (0-1 scale typically)
        const similarity = typeof result.score === 'number' ? result.score : parseFloat(result.score) || 0;
        const similarityPct = (similarity * 100).toFixed(0);
        
        return (
          <div
            key={result.id}
            className="p-3 rounded-lg bg-[var(--tiger-darker)] border border-[var(--tiger-border)] hover:border-purple-500/50 transition-colors"
          >
            <div className="flex items-start gap-2">
              <div className="w-6 h-6 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center text-xs font-bold shrink-0 text-white">
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-medium text-sm truncate">{result.title}</h3>
                  <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                    similarity >= 0.4 
                      ? 'bg-purple-500/20 text-purple-400'
                      : similarity >= 0.25
                      ? 'bg-pink-500/20 text-pink-400'
                      : 'bg-[var(--tiger-border)]'
                  }`}>
                    {similarityPct}% similar
                  </span>
                </div>
                
                {/* Semantic Match Info */}
                {result.matchAnalysis && (
                  <div className="mt-1">
                    <span className="text-[10px] text-purple-400/70">{result.matchAnalysis.reason || 'Semantic similarity'}</span>
                  </div>
                )}
                
                <span className="text-xs text-[var(--tiger-muted)]">{result.category}</span>
              </div>
            </div>
          </div>
        );
      })}
      
      {results.results.length > 5 && (
        <p className="text-xs text-[var(--tiger-muted)] text-center pt-2">
          +{results.results.length - 5} more results
        </p>
      )}
    </div>
  );
}

// Collapsible SQL Query Box Component
function CollapsibleQueryBox({ 
  explanation, 
  accentColor = 'var(--tiger-border)' 
}: { 
  explanation: string; 
  accentColor?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-4 border-t border-[var(--tiger-border)] pt-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between text-xs text-[var(--tiger-muted)] hover:text-white transition-colors"
      >
        <span className="flex items-center gap-2">
          <svg 
            className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span>View SQL Query</span>
        </span>
        <span className="text-[10px] opacity-50">{isOpen ? 'Click to collapse' : 'Click to expand'}</span>
      </button>
      
      {isOpen && (
        <div 
          className="mt-3 p-3 rounded-lg bg-[var(--tiger-darker)] border overflow-x-auto"
          style={{ borderColor: accentColor }}
        >
          <pre className="text-xs font-mono text-[var(--tiger-muted)] whitespace-pre-wrap leading-relaxed">
            {explanation}
            </pre>
        </div>
      )}
    </div>
  );
}
