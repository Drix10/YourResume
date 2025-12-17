import React, { useState } from "react";
import { AppState } from "../types";

interface HeroProps {
  onStart: (
    githubToken: string,
    geminiApiKey: string,
    linkedinText: string
  ) => void;
  state: AppState;
  errorMessage?: string;
}

const Hero: React.FC<HeroProps> = ({ onStart, state, errorMessage }) => {
  const [githubToken, setGithubToken] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [linkedinText, setLinkedinText] = useState("");

  const [formError, setFormError] = useState("");
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    const trimmedGithubToken = githubToken.trim();
    const trimmedGeminiKey = geminiApiKey.trim();

    // Validation with length limits
    if (!trimmedGithubToken) {
      setFormError("GitHub token is required");
      return;
    }

    if (trimmedGithubToken.length > 500) {
      setFormError("GitHub token is too long (max 500 characters)");
      return;
    }

    if (!trimmedGeminiKey) {
      setFormError("Gemini API key is required");
      return;
    }

    if (trimmedGeminiKey.length > 500) {
      setFormError("Gemini API key is too long (max 500 characters)");
      return;
    }

    if (linkedinText.length > 50000) {
      setFormError("LinkedIn text is too long (max 50,000 characters)");
      return;
    }

    // Basic sanitization - remove any HTML tags from LinkedIn text
    const sanitizedLinkedin = linkedinText.replace(/<[^>]*>/g, "");
    onStart(trimmedGithubToken, trimmedGeminiKey, sanitizedLinkedin);
  };

  const isLoading =
    state === AppState.FETCHING_GITHUB || state === AppState.ANALYZING_AI;

  return (
    <div className="min-h-screen bg-[#181B26] text-[#F4F4F0] flex flex-col md:flex-row relative overflow-hidden">
      {/* 1. Left Column: Typography & Brand */}
      <div className="w-full md:w-1/2 p-8 md:p-16 flex flex-col justify-center relative z-10">
        <div className="mb-6">
          <span className="inline-block py-1 px-3 rounded-full bg-[#232838] border border-[#3e4559] text-[#D4A15A] text-xs font-bold tracking-widest uppercase">
            AI Career Architect
          </span>
        </div>

        <h1 className="text-5xl md:text-7xl font-serif font-bold leading-[1.1] mb-6 text-[#F4F4F0]">
          The Code <br />
          <span className="text-[#768068]">Behind The</span> <br />
          Career.
        </h1>

        <p className="text-lg text-[#a0a09a] max-w-md leading-relaxed border-l-2 border-[#D4A15A] pl-6">
          We translate your raw GitHub commit history into a sophisticated,
          executive-level resume. Zero fluff. Pure signal.
        </p>

        {/* Decorative elements for left column */}
        <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-[#232838] rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse"></div>
      </div>

      {/* 2. Right Column: Interaction Area */}
      <div className="w-full md:w-1/2 bg-[#1f2330] p-8 md:p-16 flex flex-col justify-center relative border-l border-[#2B2B2B]">
        {/* Error Message */}
        {state === AppState.ERROR && (
          <div className="mb-6 p-4 bg-[#EF5350]/10 border-l-4 border-[#EF5350] text-[#EF5350] text-sm">
            <strong>Error:</strong>{" "}
            {errorMessage ||
              "Connection failed. Please verify your token and try again."}
          </div>
        )}
        {/* Form Validation Error */}
        {formError && (
          <div className="mb-6 p-4 bg-[#EF5350]/10 border-l-4 border-[#EF5350] text-[#EF5350] text-sm">
            <strong>Validation Error:</strong> {formError}
          </div>
        )}

        {!isLoading ? (
          <div className="max-w-md mx-auto w-full">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-[#F4F4F0] uppercase tracking-wider mb-2">
                  GitHub Token
                </label>
                <div className="relative">
                  <input
                    type={showGithubToken ? "text" : "password"}
                    placeholder="ghp_xxxxxxxxxxxx"
                    className="w-full bg-[#181B26] text-[#F4F4F0] border border-[#3e4559] rounded-none border-b-2 px-4 py-4 pr-12 focus:outline-none focus:border-[#D4A15A] placeholder-[#5c637a] font-mono text-sm transition-colors"
                    value={githubToken}
                    onChange={(e) =>
                      setGithubToken(e.target.value.slice(0, 500))
                    }
                    required
                    maxLength={500}
                  />
                  <button
                    type="button"
                    onClick={() => setShowGithubToken(!showGithubToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5c637a] hover:text-[#D4A15A] transition-colors text-sm"
                    aria-label={showGithubToken ? "Hide token" : "Show token"}
                  >
                    {showGithubToken ? "Hide" : "Show"}
                  </button>
                </div>
                <p className="text-[10px] text-[#5c637a] mt-2 text-right">
                  Required scopes: <code>repo</code>, <code>read:user</code>
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#F4F4F0] uppercase tracking-wider mb-2">
                  Gemini API Key
                </label>
                <div className="relative">
                  <input
                    type={showGeminiKey ? "text" : "password"}
                    placeholder="AIzaSy..."
                    className="w-full bg-[#181B26] text-[#F4F4F0] border border-[#3e4559] rounded-none border-b-2 px-4 py-4 pr-12 focus:outline-none focus:border-[#D4A15A] placeholder-[#5c637a] font-mono text-sm transition-colors"
                    value={geminiApiKey}
                    onChange={(e) =>
                      setGeminiApiKey(e.target.value.slice(0, 500))
                    }
                    required
                    maxLength={500}
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeminiKey(!showGeminiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5c637a] hover:text-[#D4A15A] transition-colors text-sm"
                    aria-label={showGeminiKey ? "Hide key" : "Show key"}
                  >
                    {showGeminiKey ? "Hide" : "Show"}
                  </button>
                </div>
                <p className="text-[10px] text-[#5c637a] mt-2 text-right">
                  Get your key at{" "}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#D4A15A] hover:underline"
                  >
                    Google AI Studio
                  </a>
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#F4F4F0] uppercase tracking-wider mb-2">
                  FULL LINKEDIN PROFILE IMPORT (Recommended)
                </label>
                <textarea
                  placeholder="Pro Tip: Open your LinkedIn profile, press Ctrl+A (Select All) -> Copy -> Paste everything here. We'll extract your history ensuring the result is perfect."
                  className="w-full bg-[#181B26] text-[#F4F4F0] border border-[#3e4559] rounded-none border-b-2 px-4 py-4 focus:outline-none focus:border-[#D4A15A] placeholder-[#5c637a] text-sm min-h-[120px] transition-colors resize-none"
                  value={linkedinText}
                  onChange={(e) =>
                    setLinkedinText(e.target.value.slice(0, 50000))
                  }
                  maxLength={50000}
                />
                <p className="text-[10px] text-[#5c637a] mt-2 text-right">
                  {linkedinText.length.toLocaleString()} / 50,000 characters
                </p>
              </div>

              <button
                type="submit"
                disabled={!githubToken.trim() || !geminiApiKey.trim()}
                className="w-full bg-[#EF5350] hover:bg-[#D34542] text-white font-serif font-bold py-5 px-8 shadow-lg transition-transform transform active:translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed flex justify-between items-center group"
                aria-label="Generate resume from GitHub data"
              >
                <span>GENERATE RESUME</span>
                <span
                  className="group-hover:translate-x-1 transition-transform"
                  aria-hidden="true"
                >
                  →
                </span>
              </button>

              <div className="text-center pt-4">
                <a
                  href="https://github.com/settings/tokens/new?scopes=repo,read:user"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-[#a0a09a] hover:text-[#D4A15A] border-b border-transparent hover:border-[#D4A15A] transition-colors pb-0.5"
                >
                  Need a token? Create one here.
                </a>
              </div>
            </form>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center max-w-md mx-auto w-full text-center space-y-8">
            <div className="w-24 h-24 border-4 border-[#232838] border-t-[#D4A15A] rounded-full animate-spin"></div>
            <div>
              <h3 className="text-2xl font-serif font-bold text-[#F4F4F0] mb-2">
                Processing
              </h3>
              <p className="text-[#a0a09a] font-mono text-sm">
                {state === AppState.FETCHING_GITHUB
                  ? ">> FETCHING_REPOSITORIES..."
                  : ">> ANALYZING_ARCHITECTURES..."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Hero;
