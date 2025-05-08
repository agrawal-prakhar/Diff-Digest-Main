"use client"; // Mark as a Client Component

import { useState } from "react";

// Define the expected structure of a diff object
interface DiffItem {
  id: string;
  description: string;
  diff: string;
  url: string; // Added URL field
}

// Define the expected structure of the API response
interface ApiResponse {
  diffs: DiffItem[];
  nextPage: number | null;
  currentPage: number;
  perPage: number;
}

export default function Home() {
  const [diffs, setDiffs] = useState<DiffItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [initialFetchDone, setInitialFetchDone] = useState<boolean>(false);
  const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);
  const [notesByPR, setNotesByPR] = useState<
  Record<string, { developer: string; marketing: string }>
>({});
 

  const fetchDiffs = async (page: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/sample-diffs?page=${page}&per_page=10`
      );
      if (!response.ok) {
        let errorMsg = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMsg = errorData.error || errorData.details || errorMsg;
        } catch {
          // Ignore if response body is not JSON
          console.warn("Failed to parse error response as JSON");
        }
        throw new Error(errorMsg);
      }
      const data: ApiResponse = await response.json();

      // Ensure we don't have duplicate PRs when appending
      setDiffs((prevDiffs) => {
        if (page === 1) return data.diffs;
        const existingIds = new Set(prevDiffs.map(d => d.id));
        const newDiffs = data.diffs.filter(d => !existingIds.has(d.id));
        return [...prevDiffs, ...newDiffs];
      });
      setCurrentPage(data.currentPage);
      setNextPage(data.nextPage);
      if (!initialFetchDone) setInitialFetchDone(true);

      // Generate notes for new PRs
      const newPRs = page === 1 ? data.diffs : data.diffs.filter(d => !notesByPR[d.id]);
      if (newPRs.length > 0) {
        generateNotes(newPRs);
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "An unknown error occurred"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleFetchClick = () => {
    setDiffs([]); // Clear existing diffs when fetching the first page again
    fetchDiffs(1);
  };

  const handleLoadMoreClick = () => {
    if (nextPage) {
      fetchDiffs(nextPage);
    }
  };

  function mergeWithOverlap(prev: string, fragment: string) {
    const max = Math.min(prev.length, fragment.length);
  
    for (let k = max; k > 0; k--) {
      if (prev.slice(-k) === fragment.slice(0, k)) {
        return prev + fragment.slice(k); // skip the overlap
      }
    }
    return prev + fragment; // no overlap found
  }
  
  const generateNotes = async (diffs: unknown[]) => {
    // Filter out PRs that already have notes and ensure unique PRs
    const pending = (diffs as DiffItem[])
      .filter(d => !notesByPR[d.id])
      .filter((d, i, arr) => arr.findIndex(item => item.id === d.id) === i);

    if (!pending.length) {
      setError("No new PRs to generate notes for");
      return;
    }

    setIsGeneratingNotes(true);
    setError(null);

    try {
      const response = await fetch("/api/generate-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diffs: pending }),
      });

      if (!response.ok) throw new Error("Request failed");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("ReadableStream not supported");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        // Add this chunk to our buffer and process complete SSE events
        buffer += decoder.decode(value, { stream: true });

        let dblNewline;
        while ((dblNewline = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, dblNewline).trim(); // one SSE event
          buffer = buffer.slice(dblNewline + 2);               // remainder

          // We only care about "data:" lines
          if (!rawEvent.startsWith("data:")) continue;

          const json = rawEvent.slice(5).trim(); // remove "data:"
          if (!json) continue;

          let payload: { type: string; content?: string; done?: boolean };
          try {
            payload = JSON.parse(json);
          } catch (e) {
            console.error("Bad SSE JSON:", e, json);
            continue;
          }

          const { prId, section, content = "", done: streamDone } = (payload as unknown) as {
            prId: string;
            section: "developer" | "marketing";
            content?: string;
            done?: boolean;
          };
          if (streamDone) continue;
          
          setNotesByPR(prev => {
            const current = prev[prId] ?? { developer: "", marketing: "" };
          
            if (section === "developer") {
              current.developer = mergeWithOverlap(current.developer, content);
            } else {
              current.marketing = mergeWithOverlap(current.marketing, content);
            }
            return { ...prev, [prId]: current };
          });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsGeneratingNotes(false);
    }
  };


  return (
    <main className="flex min-h-screen flex-col items-center p-12 sm:p-24">
      <h1 className="text-4xl font-bold mb-12">Diff Digest ✍️</h1>

      <div className="w-full max-w-4xl">
        {/* Controls Section */}
        <div className="mb-8 flex space-x-4">
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
            onClick={handleFetchClick}
            disabled={isLoading}
          >
            {isLoading && currentPage === 1
              ? "Fetching..."
              : "Fetch Latest Diffs"}
          </button>
        </div>

        {/* Results Section */}
        <div className="border border-gray-300 dark:border-gray-700 rounded-lg p-6 min-h-[300px] bg-gray-50 dark:bg-gray-800">
          <h2 className="text-2xl font-semibold mb-4">Merged Pull Requests</h2>

          {error && (
            <div className="text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30 p-3 rounded mb-4">
              Error: {error}
            </div>
          )}

          {!initialFetchDone && !isLoading && (
            <p className="text-gray-600 dark:text-gray-400">
              Click the button above to fetch the latest merged pull requests
              from the repository.
            </p>
          )}

          {initialFetchDone && diffs.length === 0 && !isLoading && !error && (
            <p className="text-gray-600 dark:text-gray-400">
              No merged pull requests found or fetched.
            </p>
          )}

          {diffs.length > 0 && (
            <ul className="space-y-3 list-disc list-inside">
              {diffs.map((item) => (
                <li key={item.id} className="mb-6">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  PR #{item.id}:
                </a>
                <span className="ml-2">{item.description}</span>
              
                {notesByPR[item.id]?.developer && (
                  <pre className="mt-2 p-2 bg-gray-100 dark:bg-gray-900 rounded whitespace-pre-wrap">
                    <strong>Dev&nbsp;notes:</strong> {notesByPR[item.id].developer}
                  </pre>
                )}
              
                {notesByPR[item.id]?.marketing && (
                  <pre className="mt-2 p-2 bg-gray-50 dark:bg-gray-800 rounded whitespace-pre-wrap">
                    <strong>Marketing:</strong> {notesByPR[item.id].marketing}
                  </pre>
                )}
              </li>
              ))}
            </ul>
          )}

        
          {isLoading && currentPage > 1 && (
            <p className="text-gray-600 dark:text-gray-400 mt-4">
              Loading more...
            </p>
          )}

          {nextPage && !isLoading && (
            <div className="mt-6">
              <button
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors disabled:opacity-50"
                onClick={handleLoadMoreClick}
                disabled={isLoading}
              >
                Load More (Page {nextPage})
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
