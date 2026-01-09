import React, { useState } from "react";
import {
  AppState,
  ResumeData,
  GitHubUser,
  GitHubRepo,
  EnrichedRepoData,
} from "./types";
import Hero from "./components/Hero";
import ResumeView from "./components/ResumeView";
import ErrorBoundary from "./components/ErrorBoundary";
import {
  validateToken,
  fetchAllRepos,
  enrichRepoData,
  scoreAndSortRepos,
} from "./services/githubService";
import { generateResumeFromGithub } from "./services/genaiService";

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [contextData, setContextData] = useState<{
    user: GitHubUser;
    repos: GitHubRepo[];
    enrichedRepos: EnrichedRepoData[];
    linkedinText: string;
    geminiApiKey: string;
  } | null>(null);

  const [errorMessage, setErrorMessage] = useState<string>("");

  // Track if generation is in progress to prevent double-submission
  const isGeneratingRef = React.useRef<boolean>(false);

  const handleStart = async (
    githubToken: string,
    geminiApiKey: string,
    linkedinText: string
  ) => {
    // Prevent double-submission
    if (isGeneratingRef.current) {
      return;
    }
    isGeneratingRef.current = true;

    try {
      setErrorMessage("");
      setAppState(AppState.FETCHING_GITHUB);

      // 1. Validate User & Fetch Profile
      const user = await validateToken(githubToken);

      // 2. Fetch Repos (Public & Private)
      const repos = await fetchAllRepos(githubToken, user.login);

      if (repos.length === 0) {
        throw new Error("No repositories found.");
      }

      // 3. Enrich top 20 repos with deep analysis (package.json, README, commits, etc.)
      // Pass username to track user's actual contributions
      const enrichedRepos = await enrichRepoData(
        githubToken,
        repos,
        user.login,
        20
      );

      // 4. Score and sort repos intelligently (filters out org repos with minimal contribution)
      const scoredRepos = scoreAndSortRepos(enrichedRepos, user.login);

      setContextData({
        user,
        repos,
        enrichedRepos: scoredRepos,
        linkedinText,
        geminiApiKey,
      });
      setAppState(AppState.ANALYZING_AI);

      // 5. Generate Resume with Gemini (using scored & enriched data)
      const generatedResume = await generateResumeFromGithub(
        geminiApiKey,
        user,
        repos,
        scoredRepos,
        linkedinText
      );

      setResumeData(generatedResume);
      setAppState(AppState.READY);
    } catch (error: any) {
      console.error("Error generating resume:", error);
      // Truncate long error messages
      const message = error?.message || "An unexpected error occurred.";
      setErrorMessage(
        message.length > 300 ? message.slice(0, 300) + "..." : message
      );
      setAppState(AppState.ERROR);
    } finally {
      isGeneratingRef.current = false;
    }
  };

  const handleReset = () => {
    setResumeData(null);
    setContextData(null);
    setAppState(AppState.IDLE);
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen">
        {appState !== AppState.READY && (
          <Hero
            onStart={handleStart}
            state={appState}
            errorMessage={errorMessage}
          />
        )}

        {appState === AppState.READY && resumeData && contextData && (
          <ResumeView
            data={resumeData}
            context={contextData}
            onReset={handleReset}
          />
        )}
      </div>
    </ErrorBoundary>
  );
};

export default App;
