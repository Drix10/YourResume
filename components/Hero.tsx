import React, { useState } from "react";
import { AppState } from "../types";

interface HeroProps {
  onStart: (
    githubToken: string,
    geminiApiKey: string,
    linkedinText: string,
  ) => void;
  onImportResume: (resumeData: any) => void;
  state: AppState;
  errorMessage?: string;
}

const Hero: React.FC<HeroProps> = ({
  onStart,
  onImportResume,
  state,
  errorMessage,
}) => {
  const [githubToken, setGithubToken] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [linkedinText, setLinkedinText] = useState("");

  const [formError, setFormError] = useState("");
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [importError, setImportError] = useState("");
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [isProcessingPdf, setIsProcessingPdf] = useState(false);
  const fileReaderRef = React.useRef<FileReader | null>(null);
  const pdfAbortControllerRef = React.useRef<AbortController | null>(null);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      // Abort any ongoing file read
      if (fileReaderRef.current && fileReaderRef.current.readyState === 1) {
        fileReaderRef.current.abort();
      }
      // Abort any ongoing PDF processing
      if (pdfAbortControllerRef.current) {
        pdfAbortControllerRef.current.abort();
        pdfAbortControllerRef.current = null;
      }
    };
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Clear previous errors
    setImportError("");

    const isJson = file.name.toLowerCase().endsWith(".json");
    const isPdf = file.name.toLowerCase().endsWith(".pdf");

    // Validate file type
    if (!isJson && !isPdf) {
      setImportError("Please upload a JSON or PDF file");
      return;
    }

    // Validate file size (max 10MB for PDF, 5MB for JSON)
    const maxSize = isPdf ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setImportError(`File too large (max ${isPdf ? "10" : "5"}MB)`);
      return;
    }

    if (isJson) {
      handleJsonUpload(file);
    } else if (isPdf) {
      await handlePdfUpload(file);
    }

    // Reset input so same file can be uploaded again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleJsonUpload = (file: File) => {
    // Clear previous errors
    setImportError("");

    // Abort any previous read operation
    if (fileReaderRef.current && fileReaderRef.current.readyState === 1) {
      fileReaderRef.current.abort();
    }

    const reader = new FileReader();
    fileReaderRef.current = reader;

    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;

        // Validate content exists
        if (!content || content.trim().length === 0) {
          setImportError("JSON file is empty");
          fileReaderRef.current = null;
          return;
        }

        // Validate content size (max 1MB for JSON)
        if (content.length > 1024 * 1024) {
          setImportError("JSON file too large (max 1MB)");
          fileReaderRef.current = null;
          return;
        }

        const resumeData = JSON.parse(content);

        // Basic validation
        if (!resumeData.fullName || !resumeData.title) {
          setImportError(
            "Invalid resume format: missing required fields (fullName, title)",
          );
          fileReaderRef.current = null;
          return;
        }

        // Validate structure
        if (resumeData.education && !Array.isArray(resumeData.education)) {
          setImportError("Invalid resume format: education must be an array");
          fileReaderRef.current = null;
          return;
        }
        if (resumeData.experience && !Array.isArray(resumeData.experience)) {
          setImportError("Invalid resume format: experience must be an array");
          fileReaderRef.current = null;
          return;
        }
        if (resumeData.projects && !Array.isArray(resumeData.projects)) {
          setImportError("Invalid resume format: projects must be an array");
          fileReaderRef.current = null;
          return;
        }

        setImportError("");
        fileReaderRef.current = null;
        onImportResume(resumeData);
      } catch (error: any) {
        const errorMsg = error?.message?.includes("JSON")
          ? "Invalid JSON format. Please ensure the file is valid JSON."
          : "Failed to parse JSON file. Please ensure it's a valid resume export.";
        setImportError(errorMsg);
        fileReaderRef.current = null;
      }
    };

    reader.onerror = () => {
      setImportError("Failed to read file. Please try again.");
      fileReaderRef.current = null;
    };

    reader.onabort = () => {
      fileReaderRef.current = null;
    };

    reader.readAsText(file);
  };

  const handlePdfUpload = async (file: File) => {
    // Check if Gemini API key is available BEFORE starting
    if (!geminiApiKey || geminiApiKey.trim().length === 0) {
      setImportError(
        "Gemini API key required to parse PDF. Please enter your API key below first, then upload your PDF.",
      );
      return;
    }

    setIsProcessingPdf(true);
    setImportError("");

    // Create abort controller for this request
    const abortController = new AbortController();
    pdfAbortControllerRef.current = abortController;

    // Set timeout for PDF processing (90 seconds max)
    const timeoutId = setTimeout(() => {
      if (abortController && !abortController.signal.aborted) {
        abortController.abort();
        setImportError(
          "PDF processing timed out. Please try again or use JSON export.",
        );
        setIsProcessingPdf(false);
        pdfAbortControllerRef.current = null;
      }
    }, 90000);

    try {
      // Convert PDF file to base64
      const arrayBuffer = await file.arrayBuffer();
      const base64Data = btoa(
        new Uint8Array(arrayBuffer).reduce(
          (data, byte) => data + String.fromCharCode(byte),
          "",
        ),
      );

      // Use Gemini AI to parse the PDF directly
      const { GoogleGenAI } = await import("@google/genai");
      const genAI = new GoogleGenAI({ apiKey: geminiApiKey.trim() });

      const prompt = `
Extract all information from this resume PDF and return structured JSON data.

Return ONLY valid JSON matching this structure:
{
  "fullName": "string",
  "title": "string (professional title)",
  "email": "string",
  "phone": "string",
  "location": "string (City, Country)",
  "linkedinUrl": "string",
  "githubUrl": "string",
  "website": "string",
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "location": "string",
      "period": "string"
    }
  ],
  "experience": [
    {
      "company": "string",
      "title": "string",
      "period": "string",
      "description": ["array of bullet point strings"]
    }
  ],
  "projects": [
    {
      "name": "string",
      "description": ["array of bullet point strings"],
      "technologies": ["array of technology strings"],
      "url": "string",
      "stars": 0
    }
  ],
  "skills": {
    "languages": ["array of programming languages"],
    "frameworks": ["array of frameworks/libraries"],
    "tools": ["array of tools/platforms/databases"]
  }
}

CRITICAL RULES:
1. Extract ALL information accurately from the PDF
2. Preserve ALL bullet points exactly as written
3. If a field is not found, use empty string "" or empty array []
4. Ensure all URLs include https:// protocol
5. Parse dates carefully (e.g., "Jan 2020 - Present", "2018 - 2022")
6. Extract ALL technical skills mentioned
`;

      const response = await genAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: base64Data,
                },
              },
            ],
          },
        ],
        config: {
          temperature: 0.1,
        },
      });

      // Check if aborted before processing response
      if (abortController.signal.aborted) {
        return;
      }

      clearTimeout(timeoutId);

      const responseText = response.text;

      if (!responseText || responseText.trim().length === 0) {
        throw new Error(
          "AI returned empty response. Please try again or use JSON export.",
        );
      }

      // Clean up response - remove markdown code blocks if present
      let cleanedText = responseText.trim();
      if (cleanedText.startsWith("```json")) {
        cleanedText = cleanedText
          .replace(/^```json\s*/, "")
          .replace(/```\s*$/, "");
      } else if (cleanedText.startsWith("```")) {
        cleanedText = cleanedText.replace(/^```\s*/, "").replace(/```\s*$/, "");
      }

      let resumeData;
      try {
        resumeData = JSON.parse(cleanedText.trim());
      } catch (parseError) {
        throw new Error(
          "AI returned invalid JSON. Please try again or use JSON export.",
        );
      }

      // Basic validation
      if (!resumeData || typeof resumeData !== "object") {
        throw new Error(
          "AI returned invalid data. Please try again or use JSON export.",
        );
      }

      if (!resumeData.fullName || !resumeData.title) {
        throw new Error(
          "Could not extract name and title from PDF. Please ensure your PDF contains clear resume information, or use JSON export.",
        );
      }

      // Check if aborted before updating state
      if (abortController.signal.aborted) {
        return;
      }

      // Success!
      setImportError("");
      setIsProcessingPdf(false);
      pdfAbortControllerRef.current = null;
      onImportResume(resumeData);
    } catch (error: any) {
      // Check if aborted - don't update state if so
      if (abortController.signal.aborted) {
        return;
      }

      clearTimeout(timeoutId);

      let errorMsg = "Failed to parse PDF. ";

      if (
        error?.message?.includes("API Key") ||
        error?.message?.includes("API_KEY") ||
        error?.message?.includes("INVALID_ARGUMENT")
      ) {
        errorMsg =
          "Invalid Gemini API key. Please check your API key and try again.";
      } else if (
        error?.message?.includes("quota") ||
        error?.message?.includes("rate limit") ||
        error?.message?.includes("429") ||
        error?.message?.includes("RESOURCE_EXHAUSTED")
      ) {
        errorMsg =
          "API rate limit exceeded. Please wait a moment and try again.";
      } else if (error?.message?.includes("timeout")) {
        errorMsg = "Request timed out. Please try again with a smaller PDF.";
      } else if (
        error?.message?.includes("invalid JSON") ||
        error?.message?.includes("JSON") ||
        error?.message?.includes("parse")
      ) {
        errorMsg =
          "AI returned invalid format. Please try again or use JSON export.";
      } else if (
        error?.message?.includes("network") ||
        error?.message?.includes("fetch") ||
        error?.message?.includes("Failed to fetch")
      ) {
        errorMsg =
          "Network error. Please check your internet connection and try again.";
      } else if (error?.message) {
        const msg = error.message;
        if (msg.length > 200) {
          errorMsg = msg.slice(0, 200) + "... Please try JSON export instead.";
        } else {
          errorMsg = msg + " Please try JSON export if the issue persists.";
        }
      } else {
        errorMsg =
          "Unexpected error occurred. Please try again or use JSON export.";
      }

      setImportError(errorMsg);
      setIsProcessingPdf(false);
      pdfAbortControllerRef.current = null;
    }
  };

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
            {/* Import Resume Section */}
            <div className="mb-8 p-6 bg-[#232838] border border-[#3e4559] rounded">
              <h3 className="text-sm font-bold text-[#F4F4F0] uppercase tracking-wider mb-3">
                Already Have a Resume?
              </h3>
              <p className="text-xs text-[#a0a09a] mb-4">
                Upload your previously exported resume JSON or any PDF resume to
                edit it. <strong className="text-[#D4A15A]">Tip:</strong> JSON
                export is more reliable than PDF for complex resumes.
              </p>

              {/* Show API key requirement for PDF uploads */}
              {!geminiApiKey.trim() && (
                <div className="mb-3 p-3 bg-[#D4A15A]/10 border-l-4 border-[#D4A15A] text-[#D4A15A] text-xs">
                  <strong>Note:</strong> PDF parsing requires a Gemini API key.
                  Please enter your API key below first, or upload a JSON file.
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.pdf"
                onChange={handleFileUpload}
                className="hidden"
                id="resume-upload"
                disabled={isProcessingPdf || isLoading}
              />
              <label
                htmlFor="resume-upload"
                className={`block w-full bg-[#768068] hover:bg-[#5f6854] text-white font-serif font-bold py-3 px-6 text-center transition-colors ${
                  isProcessingPdf || isLoading
                    ? "opacity-50 cursor-not-allowed"
                    : "cursor-pointer"
                }`}
              >
                {isProcessingPdf
                  ? "⏳ Processing PDF..."
                  : isLoading
                    ? "⏳ Please wait..."
                    : "📁 Upload Resume (JSON or PDF)"}
              </label>
              {importError && (
                <div className="mt-3 p-3 bg-[#EF5350]/10 border-l-4 border-[#EF5350] text-[#EF5350] text-xs">
                  {importError}
                </div>
              )}
              {isProcessingPdf && (
                <div className="mt-3 p-3 bg-[#D4A15A]/10 border-l-4 border-[#D4A15A] text-[#D4A15A] text-xs">
                  Extracting text from PDF and parsing with AI... This may take
                  10-20 seconds.
                </div>
              )}
            </div>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#3e4559]"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-[#1f2330] px-2 text-[#5c637a]">
                  Or Generate New
                </span>
              </div>
            </div>

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
                    disabled={isLoading}
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
                    disabled={isLoading}
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
                  disabled={isLoading}
                />
                <p className="text-[10px] text-[#5c637a] mt-2 text-right">
                  {linkedinText.length.toLocaleString()} / 50,000 characters
                </p>
              </div>

              <button
                type="submit"
                disabled={
                  !githubToken.trim() || !geminiApiKey.trim() || isLoading
                }
                className="w-full bg-[#EF5350] hover:bg-[#D34542] text-white font-serif font-bold py-5 px-8 shadow-lg transition-transform transform active:translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed flex justify-between items-center group"
                aria-label="Generate resume from GitHub data"
              >
                <span>{isLoading ? "GENERATING..." : "GENERATE RESUME"}</span>
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

              <div className="flex items-center justify-center gap-4 pt-6 border-t border-[#3e4559] mt-6">
                <span className="text-xs text-[#5c637a]">
                  Built by{" "}
                  <a
                    href="https://github.com/Drix10"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#a0a09a] hover:text-[#D4A15A] transition-colors"
                  >
                    @Drix10
                  </a>
                </span>
                <span className="text-[#3e4559]">•</span>
                <a
                  href="https://github.com/Drix10/YourResume"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs text-[#a0a09a] hover:text-[#D4A15A] transition-colors"
                >
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                  <span>Star on GitHub</span>
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
