import { OpenAI } from 'openai';
import { NextResponse } from 'next/server';
import { filterPRs, DEFAULT_FILTERS, DiffItem } from '@/lib/pr-filters';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    let diffsRaw: unknown;
    try {
      ({ diffs: diffsRaw } = await request.json());
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const diffs = diffsRaw as DiffItem[];
    // Filter the PRs to get relevant ones
    const relevantPRs = filterPRs(diffs, DEFAULT_FILTERS);

    if (relevantPRs.length === 0) {
      return NextResponse.json({ error: "No relevant PRs found to generate notes for" }, { status: 400 });
    }

    // Create a stream for the response
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    const sendError = async (message: string) => {
      await writer.write(
        encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`)
      );
    };

    // Start the streaming process
    (async () => {
      try {
        for (const pr of relevantPRs) {
          // Generate developer notes
          const devStream = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: "You are a senior technical writer helping engineering teams write high-quality developer release notes. Your goal is to extract meaningful technical changes from a pull request's diff and summarize them concisely in plain English for internal developer changelogs. Focus on what changed and why — highlight refactors, bug fixes, performance improvements, API changes, and new features. Avoid vague or generic descriptions. Keep the tone professional and clear. If the purpose is not clear from the diff, make a reasonable inference and note it as such. Again make it very concise, keep it 2-3 lines." + 
                "Ignore all code in comments, and interpret exactly what was changed in the code lines (the difference) and write a very concise note explaining that meaning" +
                "Use specific filenames and that clarify what technical purpose do the CODE changes mean and why they are done in the context of the codebase. Here's an example: Refactored `useFetchDiffs` hook to use `useSWR` for improved caching and reduced re-renders. " +
                "In the note, Do NOT include any trivial code changes like version number updates, formatting changes, typo fixes etc. Keep the note limited to important and significant changes, which would be relevant for your colleagues who review your PR or work after you." +
                "In the note, briefly (very concisely) only describe the code which changes the functionality of the PR and not any trivial code changes. Make sure the developer notes are super useful and concise!"
              },
              {
                role: "user",
                content: `Given the following pull request details, generate concise developer-facing release notes. Focus on the WHAT (the technical change) and the WHY (the reason or benefit). 
              Summarize your answer in 1 sentence.
              
              Title: ${pr.description}
              
              Diff:
              \`\`\`diff
              ${pr.diff}
              \`\`\``
              }
            ],
            stream: true,
          });

          const send = async (
            section: "developer" | "marketing",
            obj: Record<string, unknown>
          ) => {
            try {
              await writer.write(
                encoder.encode(
                  `data: ${JSON.stringify({ prId: pr.id, section, ...obj })}\n\n`
                )
              );
            } catch (writeError) {
              console.error("Error writing to stream:", writeError);
              throw writeError;
            }
          };

          try {
            await send("developer", { content: "" });           // start
            for await (const chunk of devStream) {
              const content = chunk.choices[0]?.delta?.content;
              if (content) await send("developer", { content });
            }
            await send("developer", { done: true });   

            // Generate marketing notes
            const marketingStream = await openai.chat.completions.create({
              model: "gpt-4.1-mini",
              messages: [
                {
                  role: "system",
                  content: "You are a product marketer writing concise, high-impact release notes for end users. Your job is to review code diffs from a pull request and describe ONLY the functionality changes that affect the user experience. Ignore all internal code structure changes, refactors, formatting, or comments. Focus exclusively on how the change improves the product for the user — such as speed, reliability, ease of use, or new capabilities. " +
                  "Keep the tone simple and benefit-driven. Be extremely concise — 1 or 2 short sentences max. Do not use technical jargon or mention file names or internal implementation details. If there are no meaningful user-facing changes, respond with: 'No user-facing changes.'" + "Give a much simplified answer of what teh diffs actually mean for the end user" + 
                  "**Example of ideal output:**" +
                  "Loading pull requests is now faster and smoother thanks to improved data fetching."
                },
                {
                  role: "user",
                  content: `Here's a new pull request. Based only on the functionality changes in the diff, generate a short marketing-style release note that clearly explains the benefit to the user. Do not include anything about internal code, comments, or refactors. Focus strictly on how the product behavior or experience has improved from the user's point of view.

                        Title: ${pr.description}

                        Diff:
                        \`\`\`diff
                        ${pr.diff}
                        \`\`\`
                        `
                }
              ],
              stream: true,
            });

            // Write marketing notes
            await send("marketing", { content: "" });
            for await (const chunk of marketingStream) {
              const content = chunk.choices[0]?.delta?.content;
              if (content) await send("marketing", { content });
            }
            await send("marketing", { done: true }); 
          } catch (prError) {
            console.error("Error processing PR:", prError);
            await sendError(`Error processing PR ${pr.id}: ${prError instanceof Error ? prError.message : 'Unknown error'}`);
            throw prError; // Re-throw to stop processing
          }
        }
      } catch (err) {
        console.error("Streaming loop failed:", err);
        await sendError("Internal error while generating notes. Please retry.");
      } finally {
        await writer.close();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Error in generate-notes:', error);
    return NextResponse.json(
      { error: 'Failed to generate release notes' },
      { status: 500 }
    );
  }
} 