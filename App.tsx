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
    linkedinText: string,
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
        20,
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
        linkedinText,
      );

      setResumeData(generatedResume);
      setAppState(AppState.READY);
    } catch (error: any) {
      console.error("Error generating resume:", error);
      // Truncate long error messages
      const message = error?.message || "An unexpected error occurred.";
      setErrorMessage(
        message.length > 300 ? message.slice(0, 300) + "..." : message,
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

  const handleUpdateApiKey = (newApiKey: string) => {
    if (contextData) {
      setContextData({
        ...contextData,
        geminiApiKey: newApiKey,
      });
    }
  };

  const handleImportResume = (importedData: any) => {
    try {
      // Generate UUID helper
      const generateId = (): string => {
        if (typeof crypto !== "undefined" && crypto.randomUUID) {
          return crypto.randomUUID();
        }
        return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      };

      // Validate and sanitize education items
      const validateEducation = (edu: any): any => {
        if (!edu || typeof edu !== "object") return null;
        return {
          id: edu.id || generateId(),
          institution:
            typeof edu.institution === "string"
              ? edu.institution.slice(0, 200)
              : "Institution",
          degree:
            typeof edu.degree === "string"
              ? edu.degree.slice(0, 200)
              : "Degree",
          location:
            typeof edu.location === "string" ? edu.location.slice(0, 100) : "",
          period: typeof edu.period === "string" ? edu.period.slice(0, 50) : "",
        };
      };

      // Validate and sanitize certification items
      const validateCertification = (cert: any): any => {
        if (!cert || typeof cert !== "object") return null;
        return {
          id: cert.id || generateId(),
          name:
            typeof cert.name === "string"
              ? cert.name.slice(0, 200)
              : "Certification",
          issuer:
            typeof cert.issuer === "string"
              ? cert.issuer.slice(0, 200)
              : "Issuer",
          date: typeof cert.date === "string" ? cert.date.slice(0, 50) : "",
          credentialId:
            typeof cert.credentialId === "string"
              ? cert.credentialId.slice(0, 100)
              : undefined,
          credentialUrl:
            typeof cert.credentialUrl === "string"
              ? cert.credentialUrl.slice(0, 500)
              : undefined,
        };
      };

      // Validate and sanitize experience items
      const validateExperience = (exp: any): any => {
        if (!exp || typeof exp !== "object") return null;
        return {
          id: exp.id || generateId(),
          company:
            typeof exp.company === "string"
              ? exp.company.slice(0, 200)
              : "Company",
          title:
            typeof exp.title === "string" ? exp.title.slice(0, 200) : "Title",
          period: typeof exp.period === "string" ? exp.period.slice(0, 50) : "",
          description: Array.isArray(exp.description)
            ? exp.description
                .filter((d: any) => typeof d === "string")
                .map((d: string) => d.slice(0, 500))
                .slice(0, 10) // Max 10 bullets
            : [],
        };
      };

      // Validate and sanitize project items
      const validateProject = (proj: any): any => {
        if (!proj || typeof proj !== "object") return null;
        return {
          id: proj.id || generateId(),
          name:
            typeof proj.name === "string" ? proj.name.slice(0, 200) : "Project",
          description: Array.isArray(proj.description)
            ? proj.description
                .filter((d: any) => typeof d === "string")
                .map((d: string) => d.slice(0, 500))
                .slice(0, 10) // Max 10 bullets
            : [],
          technologies: Array.isArray(proj.technologies)
            ? proj.technologies
                .filter((t: any) => typeof t === "string")
                .map((t: string) => t.slice(0, 100))
                .slice(0, 20) // Max 20 technologies
            : [],
          url: typeof proj.url === "string" ? proj.url.slice(0, 500) : "",
          stars:
            typeof proj.stars === "number" && proj.stars >= 0 ? proj.stars : 0,
        };
      };

      // Validate and sanitize skills
      const validateSkillArray = (arr: any): string[] => {
        if (!Array.isArray(arr)) return [];
        return arr
          .filter(
            (item: any) => typeof item === "string" && item.trim().length > 0,
          )
          .map((item: string) => item.slice(0, 100))
          .slice(0, 50); // Max 50 skills per category
      };

      // Validate and sanitize imported data
      const validatedData: ResumeData = {
        fullName:
          typeof importedData.fullName === "string"
            ? importedData.fullName.slice(0, 200)
            : "Unknown",
        title:
          typeof importedData.title === "string"
            ? importedData.title.slice(0, 200)
            : "Professional",
        email:
          typeof importedData.email === "string"
            ? importedData.email.slice(0, 200)
            : "",
        phone:
          typeof importedData.phone === "string"
            ? importedData.phone.slice(0, 50)
            : "",
        githubUrl:
          typeof importedData.githubUrl === "string"
            ? importedData.githubUrl.slice(0, 500)
            : "",
        website:
          typeof importedData.website === "string"
            ? importedData.website.slice(0, 500)
            : "",
        location:
          typeof importedData.location === "string"
            ? importedData.location.slice(0, 200)
            : "",
        linkedinUrl:
          typeof importedData.linkedinUrl === "string"
            ? importedData.linkedinUrl.slice(0, 500)
            : "",
        education: Array.isArray(importedData.education)
          ? importedData.education
              .map(validateEducation)
              .filter((item): item is NonNullable<typeof item> => item !== null)
              .slice(0, 10) // Max 10 education entries
          : [],
        certifications: Array.isArray(importedData.certifications)
          ? importedData.certifications
              .map(validateCertification)
              .filter((item): item is NonNullable<typeof item> => item !== null)
              .slice(0, 20) // Max 20 certifications
          : [],
        skills: {
          languages: validateSkillArray(importedData.skills?.languages),
          frameworks: validateSkillArray(importedData.skills?.frameworks),
          tools: validateSkillArray(importedData.skills?.tools),
        },
        projects: Array.isArray(importedData.projects)
          ? importedData.projects
              .map(validateProject)
              .filter((item): item is NonNullable<typeof item> => item !== null)
              .slice(0, 20) // Max 20 projects
          : [],
        experience: Array.isArray(importedData.experience)
          ? importedData.experience
              .map(validateExperience)
              .filter((item): item is NonNullable<typeof item> => item !== null)
              .slice(0, 20) // Max 20 experience entries
          : [],
      };

      // Create mock context data for editing
      // Note: geminiApiKey will be empty for imported resumes
      // The ResumeView component will handle this by showing a prompt when AI features are used
      const mockContext = {
        user: {
          login: validatedData.fullName.toLowerCase().replace(/\s+/g, "-"),
          avatar_url: "",
          html_url: validatedData.githubUrl || "",
          name: validatedData.fullName,
          company: null,
          blog: validatedData.website || null,
          location: validatedData.location || null,
          email: validatedData.email || null,
          bio: null,
          public_repos: 0,
          followers: 0,
          following: 0,
          created_at: new Date().toISOString(),
        },
        repos: [],
        enrichedRepos: [],
        linkedinText: "",
        geminiApiKey: "", // Empty for imported resumes - will prompt user when AI features are used
      };

      setResumeData(validatedData);
      setContextData(mockContext);
      setAppState(AppState.READY);
    } catch (error: any) {
      console.error("Error importing resume:", error);
      const errorMsg =
        error?.message ||
        "Failed to import resume. Please check the file format.";
      setErrorMessage(
        errorMsg.length > 300 ? errorMsg.slice(0, 300) + "..." : errorMsg,
      );
      setAppState(AppState.ERROR);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen">
        {appState !== AppState.READY && (
          <Hero
            onStart={handleStart}
            onImportResume={handleImportResume}
            state={appState}
            errorMessage={errorMessage}
          />
        )}

        {appState === AppState.READY && resumeData && contextData && (
          <ResumeView
            data={resumeData}
            context={contextData}
            onReset={handleReset}
            onUpdateApiKey={handleUpdateApiKey}
          />
        )}
      </div>
    </ErrorBoundary>
  );
};

export default App;
