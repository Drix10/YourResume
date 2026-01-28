import React, { useState, useEffect, useMemo } from "react";
import { ResumeData, GitHubUser, GitHubRepo, EnrichedRepoData } from "../types";
import { updateResumeWithAI } from "../services/genaiService";
import { sanitizeUrl, validateResumeData } from "../utils/validation";
import { RESUME_DENSITY, TIMING } from "../constants";

// Generate UUID with fallback for older browsers - shared utility
const generateId = (): string => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
};

interface ResumeViewProps {
  data: ResumeData;
  context: {
    user: GitHubUser;
    repos: GitHubRepo[];
    enrichedRepos: EnrichedRepoData[];
    linkedinText: string;
    geminiApiKey: string;
  };
  onReset: () => void;
  onUpdateApiKey?: (apiKey: string) => void;
}

const ResumeView: React.FC<ResumeViewProps> = ({
  data,
  context,
  onReset,
  onUpdateApiKey,
}) => {
  const [resume, setResume] = useState<ResumeData>(data);
  const [isEditing, setIsEditing] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [showApiKeyPrompt, setShowApiKeyPrompt] = useState(false);
  const [tempApiKey, setTempApiKey] = useState("");
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [showPrintInstructions, setShowPrintInstructions] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiSuccess, setAiSuccess] = useState(false);
  const printTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const lastAiRequestRef = React.useRef<number>(0);
  const modalRef = React.useRef<HTMLDivElement | null>(null);
  const apiKeyModalRef = React.useRef<HTMLDivElement | null>(null);
  const successTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const pendingRetryRef = React.useRef<boolean>(false);

  useEffect(() => {
    setResume(data);
  }, [data]);

  // Cleanup timeout on unmount - FIXED: Don't call setState in cleanup
  useEffect(() => {
    return () => {
      if (printTimeoutRef.current) {
        clearTimeout(printTimeoutRef.current);
        printTimeoutRef.current = null;
      }
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = null;
      }
      // Note: Don't call setState in cleanup - component is unmounting
      // Drag state will be garbage collected automatically
    };
  }, []);

  // Focus trap and keyboard handling for print modal
  useEffect(() => {
    if (!showPrintInstructions || !modalRef.current) {
      return;
    }

    const modal = modalRef.current;
    const previousActiveElement = document.activeElement as HTMLElement;

    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[
      focusableElements.length - 1
    ] as HTMLElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Close on Escape
      if (e.key === "Escape") {
        setShowPrintInstructions(false);
        return;
      }

      // Focus trap on Tab
      if (e.key === "Tab") {
        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    firstElement?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [showPrintInstructions]);

  // Focus trap and keyboard handling for API Key modal
  useEffect(() => {
    if (!showApiKeyPrompt || !apiKeyModalRef.current) {
      return;
    }

    const modal = apiKeyModalRef.current;
    const previousActiveElement = document.activeElement as HTMLElement;

    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[
      focusableElements.length - 1
    ] as HTMLElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Close on Escape
      if (e.key === "Escape") {
        setShowApiKeyPrompt(false);
        setTempApiKey("");
        pendingRetryRef.current = false;
        return;
      }

      // Focus trap on Tab
      if (e.key === "Tab") {
        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    firstElement?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [showApiKeyPrompt]);

  // Handle retry after API key is updated
  useEffect(() => {
    if (
      pendingRetryRef.current &&
      context.geminiApiKey &&
      context.geminiApiKey.trim().length > 0 &&
      aiPrompt.trim().length > 0
    ) {
      pendingRetryRef.current = false;
      // Trigger the AI update with the new API key
      handleAiUpdate(new Event("submit") as any);
    }
  }, [context.geminiApiKey, aiPrompt]);

  const [printError, setPrintError] = useState("");

  const handlePrint = () => {
    setPrintError("");
    setShowPrintInstructions(true);
  };

  const handleExportJSON = () => {
    let url: string | null = null;
    let link: HTMLAnchorElement | null = null;

    try {
      // Create a clean copy of the resume data
      const exportData = {
        ...resume,
        // Add metadata
        exportedAt: new Date().toISOString(),
        version: "1.0",
      };

      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: "application/json" });

      // Validate blob creation
      if (!dataBlob || dataBlob.size === 0) {
        throw new Error("Failed to create export file");
      }

      url = URL.createObjectURL(dataBlob);

      // Sanitize filename - remove special characters and limit length
      const sanitizeFilename = (name: string): string => {
        if (!name || typeof name !== "string" || name.trim().length === 0) {
          return "Resume";
        }
        return name
          .replace(/[^a-zA-Z0-9\s_-]/g, "") // Remove special chars
          .replace(/\s+/g, "_") // Replace spaces with underscores
          .slice(0, 50); // Limit length
      };

      const filename = `${sanitizeFilename(resume.fullName)}_Resume.json`;

      link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();

      // Clean up immediately
      if (link.parentNode) {
        document.body.removeChild(link);
      }

      // Clean up the URL object
      setTimeout(() => {
        if (url) URL.revokeObjectURL(url);
      }, 100);
    } catch (error) {
      console.error("Failed to export JSON:", error);
      alert("Failed to export resume. Please try again.");

      // Ensure cleanup even on error
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {
          console.error("Failed to revoke URL:", e);
        }
      }
      if (link && link.parentNode) {
        try {
          document.body.removeChild(link);
        } catch (e) {
          console.error("Failed to remove link:", e);
        }
      }
    }
  };

  const proceedToPrint = () => {
    // Validate resume data before printing
    const validation = validateResumeData({
      email: resume.email,
      phone: resume.phone,
      githubUrl: resume.githubUrl,
      linkedinUrl: resume.linkedinUrl,
      website: resume.website,
    });

    if (!validation.valid) {
      setPrintError(
        `Please fix the following issues before printing:\n${validation.errors.join(
          "\n",
        )}`,
      );
      return;
    }

    setShowPrintInstructions(false);
    const originalTitle = document.title;
    document.title = resume.fullName || "Resume";

    // Clear any existing timeout
    if (printTimeoutRef.current) {
      clearTimeout(printTimeoutRef.current);
    }

    printTimeoutRef.current = setTimeout(() => {
      window.print();
      document.title = originalTitle;
      printTimeoutRef.current = null;
    }, TIMING.PRINT_TITLE_DELAY);
  };

  const handleChange = (field: keyof ResumeData, value: any) => {
    // Sanitize URLs before saving
    if (
      field === "githubUrl" ||
      field === "linkedinUrl" ||
      field === "website"
    ) {
      value = sanitizeUrl(value);
    }
    setResume((prev) => ({ ...prev, [field]: value }));
  };

  const handleNestedChange = (
    section: "education" | "experience" | "projects",
    index: number,
    field: string,
    value: any,
  ) => {
    setResume((prev) => {
      const sectionArray = [...(prev[section] as any[])];
      sectionArray[index] = { ...sectionArray[index], [field]: value };
      return { ...prev, [section]: sectionArray };
    });
  };

  const handleArrayStringChange = (
    section: "experience" | "projects",
    itemIndex: number,
    field: "description",
    value: string,
  ) => {
    const lines = value.split("\n");
    handleNestedChange(section, itemIndex, field, lines);
  };

  const handleSkillChange = (
    category: keyof ResumeData["skills"],
    value: string,
  ) => {
    const items = value.split(",").map((s) => s.trim());
    setResume((prev) => {
      const currentSkills = prev.skills || {
        languages: [],
        frameworks: [],
        tools: [],
      };
      return { ...prev, skills: { ...currentSkills, [category]: items } };
    });
  };

  const addItem = (section: "education" | "experience" | "projects") => {
    setResume((prev) => {
      const newArray = [...(prev[section] as any[])];
      if (section === "education")
        newArray.push({
          id: generateId(),
          institution: "Institution",
          degree: "Degree",
          location: "Location",
          period: "Date",
        });
      if (section === "experience")
        newArray.push({
          id: generateId(),
          company: "Company",
          title: "Title",
          period: "Date",
          description: ["Description"],
        });
      if (section === "projects")
        newArray.push({
          id: generateId(),
          name: "Project Name",
          technologies: ["Tech"],
          description: ["Description"],
          url: "",
          stars: 0,
        });
      return { ...prev, [section]: newArray };
    });
  };

  const removeItem = (
    section: "education" | "experience" | "projects",
    index: number,
  ) => {
    setResume((prev) => {
      const newArray = [...(prev[section] as any[])];
      newArray.splice(index, 1);
      return { ...prev, [section]: newArray };
    });
  };

  // Item drag and drop - track section + index to avoid cross-section visual glitches
  const [draggedItem, setDraggedItem] = useState<{
    section: string;
    index: number;
  } | null>(null);
  const [dragOverItem, setDragOverItem] = useState<{
    section: string;
    index: number;
  } | null>(null);

  const handleDragStart = (
    section: "education" | "experience" | "projects",
    index: number,
  ) => {
    setDraggedItem({ section, index });
  };

  const handleDragOver = (
    e: React.DragEvent,
    section: "education" | "experience" | "projects",
    index: number,
  ) => {
    e.preventDefault();
    // Only show drop indicator if dragging within the same section
    if (draggedItem?.section === section) {
      setDragOverItem({ section, index });
    }
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverItem(null);
  };

  const handleDrop = (
    section: "education" | "experience" | "projects",
    dropIndex: number,
  ) => {
    if (!draggedItem || draggedItem.section !== section) {
      handleDragEnd();
      return;
    }
    const fromIndex = draggedItem.index;
    if (fromIndex === dropIndex) {
      handleDragEnd();
      return;
    }
    setResume((prev) => {
      const newArray = [...(prev[section] as any[])];

      // Safety check: ensure indices are valid
      if (
        fromIndex < 0 ||
        fromIndex >= newArray.length ||
        dropIndex < 0 ||
        dropIndex >= newArray.length
      ) {
        return prev;
      }

      const [movedItem] = newArray.splice(fromIndex, 1);
      newArray.splice(dropIndex, 0, movedItem);
      return { ...prev, [section]: newArray };
    });
    handleDragEnd();
  };

  // Section drag and drop
  type SectionType = "education" | "experience" | "projects" | "skills";
  const [sectionOrder, setSectionOrder] = useState<SectionType[]>([
    "education",
    "experience",
    "projects",
    "skills",
  ]);
  const [draggedSection, setDraggedSection] = useState<SectionType | null>(
    null,
  );
  const [dragOverSection, setDragOverSection] = useState<SectionType | null>(
    null,
  );

  const handleSectionDragStart = (section: SectionType) => {
    setDraggedSection(section);
  };

  const handleSectionDragOver = (e: React.DragEvent, section: SectionType) => {
    e.preventDefault();
    if (draggedSection && draggedSection !== section) {
      setDragOverSection(section);
    }
  };

  const handleSectionDragEnd = () => {
    setDraggedSection(null);
    setDragOverSection(null);
  };

  const handleSectionDrop = (targetSection: SectionType) => {
    if (!draggedSection || draggedSection === targetSection) {
      handleSectionDragEnd();
      return;
    }
    setSectionOrder((prev) => {
      const newOrder = [...prev];
      const fromIndex = newOrder.indexOf(draggedSection);
      const toIndex = newOrder.indexOf(targetSection);
      if (fromIndex !== -1 && toIndex !== -1) {
        newOrder.splice(fromIndex, 1);
        newOrder.splice(toIndex, 0, draggedSection);
      }
      return newOrder;
    });
    handleSectionDragEnd();
  };

  const sectionNames: Record<SectionType, string> = {
    education: "Education",
    experience: "Experience",
    projects: "Projects",
    skills: "Technical Skills",
  };

  const handleAiUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedPrompt = aiPrompt.trim();
    if (!trimmedPrompt || isAiProcessing) return;

    // Check if we have a Gemini API key (might be missing for imported resumes)
    if (!context.geminiApiKey || context.geminiApiKey.trim().length === 0) {
      // Show API key prompt modal
      setShowApiKeyPrompt(true);
      return;
    }

    // Prevent rapid-fire AI requests
    const now = Date.now();
    if (now - lastAiRequestRef.current < TIMING.AI_REQUEST_COOLDOWN) {
      setAiError("Please wait a moment before making another AI request.");
      return;
    }
    lastAiRequestRef.current = now;

    setIsAiProcessing(true);
    setAiError("");
    setAiSuccess(false);

    // Store current prompt in case component unmounts
    const currentPrompt = trimmedPrompt;

    try {
      const updatedResume = await updateResumeWithAI(
        context.geminiApiKey,
        resume,
        currentPrompt,
        context,
      );

      // Check if component is still mounted before updating state
      setResume(updatedResume);
      setAiPrompt("");

      // Show success message
      setAiSuccess(true);

      // Clear success message after 3 seconds
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
      successTimeoutRef.current = setTimeout(() => {
        setAiSuccess(false);
        successTimeoutRef.current = null;
      }, 3000);
    } catch (error: any) {
      console.error("AI Update failed", error);
      let errorMsg = "Failed to update resume. Please try again.";

      // Provide more specific error messages
      if (error?.message?.includes("API Key")) {
        errorMsg = "API Key error. Please check your configuration.";
      } else if (
        error?.message?.includes("rate limit") ||
        error?.message?.includes("quota")
      ) {
        errorMsg = "API rate limit exceeded. Please try again later.";
      } else if (
        error?.message?.includes("network") ||
        error?.message?.includes("fetch")
      ) {
        errorMsg = "Network error. Please check your internet connection.";
      } else if (error?.message) {
        // Truncate long error messages
        errorMsg =
          error.message.length > 200
            ? error.message.slice(0, 200) + "..."
            : error.message;
      }

      setAiError(errorMsg);
    } finally {
      setIsAiProcessing(false);
    }
  };

  // Safely display URL without protocol, with XSS protection
  const displayUrl = (url: string): string => {
    if (!url || typeof url !== "string") return "";

    // Sanitize first
    const sanitized = sanitizeUrl(url);
    if (!sanitized) return "";

    // Remove protocol and trailing slash for display
    return sanitized
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/\/$/, "")
      .slice(0, 50); // Limit length for display
  };

  // Calculate estimated page count based on content - memoized for performance
  const estimatedPages = useMemo(() => {
    const A4_HEIGHT_MM = 297;
    const PADDING_MM = 12.7 * 2; // 0.5in top + bottom
    const USABLE_HEIGHT_MM = A4_HEIGHT_MM - PADDING_MM;

    // Rough estimates (in mm)
    const HEADER_HEIGHT = 35;
    const SECTION_HEADER_HEIGHT = 8;
    const EDUCATION_ITEM_HEIGHT = 15;
    const EXPERIENCE_ITEM_HEIGHT = 25;
    const PROJECT_ITEM_HEIGHT = 20;
    const SKILLS_HEIGHT = 25;

    let totalHeight = HEADER_HEIGHT;

    // Education
    if (resume.education?.length > 0) {
      totalHeight +=
        SECTION_HEADER_HEIGHT + resume.education.length * EDUCATION_ITEM_HEIGHT;
    }

    // Experience
    if (resume.experience?.length > 0) {
      const expHeight = resume.experience.reduce((acc, exp) => {
        return (
          acc + EXPERIENCE_ITEM_HEIGHT + (exp.description?.length || 0) * 4
        );
      }, 0);
      totalHeight += SECTION_HEADER_HEIGHT + expHeight;
    }

    // Projects
    if (resume.projects?.length > 0) {
      const projHeight = resume.projects.reduce((acc, proj) => {
        return acc + PROJECT_ITEM_HEIGHT + (proj.description?.length || 0) * 4;
      }, 0);
      totalHeight += SECTION_HEADER_HEIGHT + projHeight;
    }

    // Skills
    totalHeight += SECTION_HEADER_HEIGHT + SKILLS_HEIGHT;

    // Ensure at least 1 page, even for minimal content
    const pages = Math.ceil(totalHeight / USABLE_HEIGHT_MM);
    return Math.max(1, pages);
  }, [resume.education, resume.experience, resume.projects, resume.skills]);

  const contentDensityClass = useMemo(() => {
    const experienceDesc =
      resume.experience?.reduce(
        (acc, exp) => acc + (exp.description?.length || 0),
        0,
      ) || 0;
    const projectsDesc =
      resume.projects?.reduce(
        (acc, proj) => acc + (proj.description?.length || 0),
        0,
      ) || 0;
    const totalBullets = experienceDesc + projectsDesc;
    const totalItems =
      (resume.education?.length || 0) +
      (resume.experience?.length || 0) +
      (resume.projects?.length || 0);
    const totalSkills =
      (resume.skills?.languages?.length || 0) +
      (resume.skills?.frameworks?.length || 0) +
      (resume.skills?.tools?.length || 0);
    const densityScore = totalBullets + totalItems * 2 + totalSkills;

    if (densityScore > RESUME_DENSITY.ULTRA_COMPACT_THRESHOLD)
      return "resume-ultra-compact";
    if (densityScore > RESUME_DENSITY.COMPACT_THRESHOLD)
      return "resume-compact";
    return "";
  }, [resume.education, resume.experience, resume.projects, resume.skills]);

  return (
    <div className="min-h-screen bg-[#181B26] py-10 px-4 md:px-0 print:bg-white print:p-0">
      {/* Print Instructions Modal */}
      {showPrintInstructions && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 no-print"
          role="dialog"
          aria-modal="true"
          aria-labelledby="print-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPrintInstructions(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowPrintInstructions(false);
          }}
        >
          <div
            ref={modalRef}
            className="bg-[#1f2330] border-2 border-[#D4A15A] rounded-lg max-w-2xl w-full p-8 shadow-2xl"
          >
            <h2
              id="print-modal-title"
              className="text-2xl font-serif font-bold text-[#F4F4F0] mb-4"
            >
              📄 Clean PDF Export Instructions
            </h2>
            <div className="bg-[#232838] border border-[#3e4559] rounded p-4 mb-6">
              <p className="text-[#F4F4F0] mb-4 leading-relaxed">
                To get a{" "}
                <strong className="text-[#D4A15A]">
                  clean resume without browser headers/footers
                </strong>{" "}
                (date, time, URL), follow these steps:
              </p>
              <ol className="space-y-3 text-[#a0a09a] list-decimal list-inside">
                <li className="leading-relaxed">
                  <strong className="text-[#F4F4F0]">
                    In the print dialog
                  </strong>
                  , look for{" "}
                  <span className="text-[#D4A15A] font-mono">
                    "More settings"
                  </span>{" "}
                  or <span className="text-[#D4A15A] font-mono">"Options"</span>
                </li>
                <li className="leading-relaxed">
                  <strong className="text-[#F4F4F0]">Uncheck</strong> the box
                  labeled{" "}
                  <span className="text-[#D4A15A] font-mono">
                    "Headers and footers"
                  </span>
                </li>
                <li className="leading-relaxed">
                  <strong className="text-[#F4F4F0]">Set margins</strong> to{" "}
                  <span className="text-[#D4A15A] font-mono">"Default"</span> or{" "}
                  <span className="text-[#D4A15A] font-mono">"None"</span> (CSS
                  handles spacing)
                </li>
                <li className="leading-relaxed">
                  <strong className="text-[#F4F4F0]">Select</strong>{" "}
                  <span className="text-[#D4A15A] font-mono">
                    "Save as PDF"
                  </span>{" "}
                  as destination
                </li>
                <li className="leading-relaxed">
                  <strong className="text-[#F4F4F0]">Click Save</strong> - Your
                  resume will be clean! ✨
                </li>
              </ol>
            </div>
            <div className="bg-[#EF5350]/10 border-l-4 border-[#EF5350] p-4 mb-6">
              <p className="text-[#F4F4F0] text-sm">
                <strong>Note:</strong> Browser headers/footers are a browser
                setting, not controllable by the website. This is a one-time
                setup - your browser will remember this preference!
              </p>
            </div>
            {printError && (
              <div className="bg-[#EF5350]/10 border-l-4 border-[#EF5350] p-4 mb-6 text-[#EF5350] text-sm whitespace-pre-line">
                {printError}
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowPrintInstructions(false);
                  setPrintError("");
                }}
                className="px-6 py-3 bg-[#232838] text-[#a0a09a] hover:text-white border border-[#3e4559] rounded font-serif transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={proceedToPrint}
                className="px-6 py-3 bg-[#EF5350] hover:bg-[#D34542] text-white rounded font-serif font-bold shadow-lg transition-all"
              >
                Got it! Open Print Dialog →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* API Key Prompt Modal */}
      {showApiKeyPrompt && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 no-print"
          role="dialog"
          aria-modal="true"
          aria-labelledby="api-key-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowApiKeyPrompt(false);
              setTempApiKey("");
              pendingRetryRef.current = false;
            }
          }}
        >
          <div
            ref={apiKeyModalRef}
            className="bg-[#1f2330] border-2 border-[#D4A15A] rounded-lg max-w-md w-full p-8 shadow-2xl"
          >
            <h2
              id="api-key-modal-title"
              className="text-2xl font-serif font-bold text-[#F4F4F0] mb-4"
            >
              🔑 Gemini API Key Required
            </h2>
            <p className="text-[#a0a09a] mb-6">
              AI features require a Gemini API key. Enter your key below to
              enable AI-powered resume editing.
            </p>
            <div className="mb-6">
              <label className="block text-xs font-bold text-[#F4F4F0] uppercase tracking-wider mb-2">
                Gemini API Key
              </label>
              <input
                type="password"
                placeholder="AIzaSy..."
                className="w-full bg-[#181B26] text-[#F4F4F0] border border-[#3e4559] rounded px-4 py-3 focus:outline-none focus:border-[#D4A15A] placeholder-[#5c637a] font-mono text-sm"
                value={tempApiKey}
                onChange={(e) => setTempApiKey(e.target.value)}
                maxLength={500}
                autoFocus
              />
              <p className="text-[10px] text-[#5c637a] mt-2">
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
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowApiKeyPrompt(false);
                  setTempApiKey("");
                  pendingRetryRef.current = false;
                }}
                className="px-6 py-3 bg-[#232838] text-[#a0a09a] hover:text-white border border-[#3e4559] rounded font-serif transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (tempApiKey.trim() && onUpdateApiKey) {
                    onUpdateApiKey(tempApiKey.trim());
                    setShowApiKeyPrompt(false);
                    setTempApiKey("");
                    // Set pending retry flag - the useEffect will handle the actual retry
                    pendingRetryRef.current = true;
                  }
                }}
                disabled={!tempApiKey.trim()}
                className="px-6 py-3 bg-[#D4A15A] hover:bg-[#C29250] text-[#181B26] rounded font-serif font-bold shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save & Continue
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-[210mm] mx-auto mb-6 flex flex-col gap-4 no-print sticky top-0 z-[200] bg-[#181B26]/95 backdrop-blur py-4 px-2 rounded-b-lg border-b border-[#2B2B2B]">
        <div className="flex justify-between items-center w-full">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => {
                if (
                  confirm(
                    "Are you sure you want to create a new resume? All unsaved changes will be lost.",
                  )
                ) {
                  onReset();
                }
              }}
              className="text-slate-400 hover:text-white flex items-center gap-2 transition-colors text-sm"
              aria-label="Create new resume"
            >
              ← Create New
            </button>
            <div className="text-xs text-[#a0a09a] bg-[#232838] px-3 py-1 rounded border border-[#3e4559]">
              📄 ~{estimatedPages} {estimatedPages === 1 ? "page" : "pages"}
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setIsEditing(!isEditing)}
              className={`px-5 py-2 rounded font-serif text-sm transition-all ${
                isEditing
                  ? "bg-[#768068] text-white shadow-sm"
                  : "bg-[#232838] text-[#a0a09a] hover:text-white border border-[#3e4559]"
              }`}
            >
              {isEditing ? "Finish Editing" : "Edit Content"}
            </button>
            <button
              type="button"
              onClick={handleExportJSON}
              className="bg-[#768068] hover:bg-[#5f6854] text-white px-5 py-2 rounded font-serif font-bold shadow-md transition-all text-sm active:translate-y-0.5"
              aria-label="Export resume as JSON for later editing"
              title="Download as JSON to edit later"
            >
              💾 Export JSON
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="bg-[#EF5350] hover:bg-[#D34542] text-white px-5 py-2 rounded font-serif font-bold shadow-md transition-all text-sm active:translate-y-0.5"
              aria-label="Download resume as PDF"
            >
              Download PDF
            </button>
          </div>
        </div>
        <form onSubmit={handleAiUpdate} className="w-full flex gap-3">
          <input
            type="text"
            value={aiPrompt}
            onChange={(e) => {
              setAiPrompt(e.target.value.slice(0, 500));
              if (aiError) setAiError("");
              if (aiSuccess) setAiSuccess(false);
            }}
            placeholder="Refine with AI (e.g., 'Make the tone more executive')..."
            className="flex-1 bg-[#232838] text-[#F4F4F0] placeholder-[#5c637a] border border-[#3e4559] px-4 py-2 text-sm font-serif focus:outline-none focus:border-[#D4A15A] transition-colors"
            disabled={isAiProcessing}
            maxLength={500}
          />
          <button
            type="submit"
            disabled={!aiPrompt.trim() || isAiProcessing}
            className={`px-5 py-2 font-serif text-sm transition-all ${
              isAiProcessing
                ? "bg-[#D4A15A] text-[#181B26] cursor-wait"
                : !aiPrompt.trim()
                  ? "bg-[#3e4559] text-[#5c637a] cursor-not-allowed"
                  : "bg-[#D4A15A] hover:bg-[#C29250] text-[#181B26]"
            }`}
          >
            {isAiProcessing ? "Refining..." : "AI Refine"}
          </button>
        </form>
        {aiSuccess && (
          <div className="text-xs text-[#768068] flex items-center gap-1.5">
            <svg
              className="w-3.5 h-3.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            Resume refined successfully
          </div>
        )}
        {aiError && <div className="text-xs text-[#EF5350]">{aiError}</div>}
      </div>

      {/* Resume content */}
      <div className="max-w-[210mm] mx-auto">
        <div
          className={`resume-page bg-white text-black font-serif leading-normal p-[0.5in] shadow-lg transition-all duration-300 ${
            isEditing ? "ring-2 ring-[#768068]/50" : ""
          } ${contentDensityClass}`}
        >
          <header className="text-center mb-5">
            {isEditing ? (
              <input
                className="text-[28pt] font-normal tracking-wide mb-1 text-black w-full text-center border-b border-dashed border-gray-300 focus:border-blue-500 outline-none bg-transparent uppercase"
                value={resume.fullName}
                onChange={(e) => handleChange("fullName", e.target.value)}
              />
            ) : (
              <h1 className="text-[28pt] font-normal tracking-[0.15em] mb-1 text-black uppercase">
                {resume.fullName}
              </h1>
            )}

            {/* Title and Location on same line */}
            <div className="text-[9.5pt] text-gray-600 mb-3 flex items-center justify-center gap-2">
              {isEditing ? (
                <div className="flex flex-col gap-1 w-full max-w-md mx-auto">
                  <input
                    className="text-center border-b border-gray-200 bg-transparent outline-none text-[9.5pt]"
                    placeholder="Professional Title"
                    value={resume.title}
                    onChange={(e) => handleChange("title", e.target.value)}
                  />
                  <input
                    className="text-center border-b border-gray-200 bg-transparent outline-none text-[9.5pt]"
                    placeholder="Location (City, Country)"
                    value={resume.location}
                    onChange={(e) => handleChange("location", e.target.value)}
                  />
                </div>
              ) : (
                <>
                  {resume.title && <span>{resume.title}</span>}
                  {resume.title && resume.location && <span>•</span>}
                  {resume.location && <span>{resume.location}</span>}
                </>
              )}
            </div>

            <div className="text-[9pt] flex justify-center flex-wrap gap-x-3 gap-y-1 text-black items-center">
              {isEditing ? (
                <div className="flex flex-col gap-2 w-full max-w-lg mx-auto">
                  <input
                    className="text-center border-b border-gray-200 bg-transparent outline-none text-[9pt]"
                    placeholder="Phone (e.g., +1234567890)"
                    value={resume.phone || ""}
                    onChange={(e) => handleChange("phone", e.target.value)}
                  />
                  <input
                    className="text-center border-b border-gray-200 bg-transparent outline-none text-[9pt]"
                    placeholder="Email"
                    value={resume.email}
                    onChange={(e) => handleChange("email", e.target.value)}
                  />
                  <input
                    className="text-center border-b border-gray-200 bg-transparent outline-none text-[9pt]"
                    placeholder="LinkedIn URL"
                    value={resume.linkedinUrl || ""}
                    onChange={(e) =>
                      handleChange("linkedinUrl", e.target.value)
                    }
                  />
                  <input
                    className="text-center border-b border-gray-200 bg-transparent outline-none text-[9pt]"
                    placeholder="GitHub URL"
                    value={resume.githubUrl}
                    onChange={(e) => handleChange("githubUrl", e.target.value)}
                  />
                  <input
                    className="text-center border-b border-gray-200 bg-transparent outline-none text-[9pt]"
                    placeholder="Website/Portfolio"
                    value={resume.website}
                    onChange={(e) => handleChange("website", e.target.value)}
                  />
                </div>
              ) : (
                <>
                  {resume.phone && (
                    <span className="flex items-center gap-1.5">
                      <svg
                        className="w-3 h-3"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                      </svg>
                      <a
                        href={`tel:${resume.phone}`}
                        className="hover:underline"
                      >
                        {resume.phone}
                      </a>
                    </span>
                  )}
                  {resume.email && (
                    <span className="flex items-center gap-1.5">
                      <svg
                        className="w-3 h-3"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                        <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                      </svg>
                      <a
                        href={`mailto:${resume.email}`}
                        className="hover:underline"
                      >
                        {resume.email}
                      </a>
                    </span>
                  )}
                  {resume.linkedinUrl && (
                    <span className="flex items-center gap-1.5">
                      <svg
                        className="w-3 h-3"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                      </svg>
                      <a
                        href={resume.linkedinUrl}
                        className="hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {displayUrl(resume.linkedinUrl)}
                      </a>
                    </span>
                  )}
                  {resume.githubUrl && (
                    <span className="flex items-center gap-1.5">
                      <svg
                        className="w-3 h-3"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          fillRule="evenodd"
                          d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <a
                        href={resume.githubUrl}
                        className="hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {displayUrl(resume.githubUrl)}
                      </a>
                    </span>
                  )}
                  {resume.website && (
                    <span className="flex items-center gap-1.5">
                      <svg
                        className="w-3 h-3"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <a
                        href={resume.website}
                        className="hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {displayUrl(resume.website)}
                      </a>
                    </span>
                  )}
                </>
              )}
            </div>
          </header>

          {sectionOrder.map((sectionKey) => {
            if (sectionKey === "education") {
              return (
                <section
                  key="education"
                  className={`mb-4 resume-section ${
                    draggedSection === "education" ? "opacity-50" : ""
                  } ${
                    dragOverSection === "education"
                      ? "border-t-4 border-blue-500"
                      : ""
                  }`}
                  draggable={isEditing}
                  onDragStart={(e) => {
                    e.stopPropagation();
                    handleSectionDragStart("education");
                  }}
                  onDragOver={(e) => handleSectionDragOver(e, "education")}
                  onDragEnd={handleSectionDragEnd}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleSectionDrop("education");
                  }}
                >
                  <div className="flex justify-between items-center border-b border-black mb-2 pb-0.5">
                    {isEditing && (
                      <span className="text-gray-400 cursor-grab mr-2 no-print text-lg">
                        ⋮⋮
                      </span>
                    )}
                    <h2 className="text-[11pt] font-bold uppercase tracking-wider flex-1">
                      {sectionNames.education}
                    </h2>
                    {isEditing && (
                      <button
                        type="button"
                        onClick={() => addItem("education")}
                        className="text-xs bg-green-100 text-green-700 px-2 rounded"
                      >
                        + Add
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {(!resume.education || resume.education.length === 0) &&
                      !isEditing && (
                        <p className="text-[10pt] text-gray-500 italic">
                          No education information available
                        </p>
                      )}
                    {resume.education?.map((edu, idx) => (
                      <div
                        key={edu.id}
                        className={`flex flex-col relative group education-item resume-item ${
                          isEditing
                            ? "cursor-move hover:bg-gray-50 rounded p-1 -m-1"
                            : ""
                        } ${
                          draggedItem?.section === "education" &&
                          draggedItem?.index === idx
                            ? "opacity-50"
                            : ""
                        } ${
                          dragOverItem?.section === "education" &&
                          dragOverItem?.index === idx
                            ? "border-t-2 border-blue-500"
                            : ""
                        }`}
                        draggable={isEditing}
                        onDragStart={() => handleDragStart("education", idx)}
                        onDragOver={(e) => handleDragOver(e, "education", idx)}
                        onDragEnd={handleDragEnd}
                        onDrop={() => handleDrop("education", idx)}
                      >
                        {isEditing && (
                          <span className="absolute -left-5 top-1/2 -translate-y-1/2 text-gray-300 cursor-grab no-print">
                            ⋮⋮
                          </span>
                        )}
                        {isEditing && (
                          <button
                            type="button"
                            onClick={() => removeItem("education", idx)}
                            className="absolute -left-10 top-0 text-red-400 hover:text-red-600 no-print"
                            aria-label={`Remove ${edu.institution}`}
                          >
                            ×
                          </button>
                        )}
                        <div className="flex justify-between items-baseline">
                          {isEditing ? (
                            <input
                              className="font-bold text-[11pt] w-1/2 border-b border-gray-200 bg-transparent outline-none"
                              value={edu.institution}
                              onChange={(e) =>
                                handleNestedChange(
                                  "education",
                                  idx,
                                  "institution",
                                  e.target.value,
                                )
                              }
                            />
                          ) : (
                            <span className="font-bold text-[11pt]">
                              {edu.institution}
                            </span>
                          )}
                          {isEditing ? (
                            <input
                              className="text-[10pt] text-right border-b border-gray-200 bg-transparent outline-none"
                              value={edu.location}
                              onChange={(e) =>
                                handleNestedChange(
                                  "education",
                                  idx,
                                  "location",
                                  e.target.value,
                                )
                              }
                            />
                          ) : (
                            <span className="text-[10pt]">{edu.location}</span>
                          )}
                        </div>
                        <div className="flex justify-between items-baseline italic text-[10pt]">
                          {isEditing ? (
                            <input
                              className="w-1/2 border-b border-gray-200 bg-transparent outline-none"
                              value={edu.degree}
                              onChange={(e) =>
                                handleNestedChange(
                                  "education",
                                  idx,
                                  "degree",
                                  e.target.value,
                                )
                              }
                            />
                          ) : (
                            <span>{edu.degree}</span>
                          )}
                          {isEditing ? (
                            <input
                              className="text-right border-b border-gray-200 bg-transparent outline-none"
                              value={edu.period}
                              onChange={(e) =>
                                handleNestedChange(
                                  "education",
                                  idx,
                                  "period",
                                  e.target.value,
                                )
                              }
                            />
                          ) : (
                            <span>{edu.period}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            }

            if (sectionKey === "experience") {
              return (
                <section
                  key="experience"
                  className={`mb-4 resume-section allow-break ${
                    draggedSection === "experience" ? "opacity-50" : ""
                  } ${
                    dragOverSection === "experience"
                      ? "border-t-4 border-blue-500"
                      : ""
                  }`}
                  draggable={isEditing}
                  onDragStart={(e) => {
                    e.stopPropagation();
                    handleSectionDragStart("experience");
                  }}
                  onDragOver={(e) => handleSectionDragOver(e, "experience")}
                  onDragEnd={handleSectionDragEnd}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleSectionDrop("experience");
                  }}
                >
                  <div className="flex justify-between items-center border-b border-black mb-2 pb-0.5">
                    {isEditing && (
                      <span className="text-gray-400 cursor-grab mr-2 no-print text-lg">
                        ⋮⋮
                      </span>
                    )}
                    <h2 className="text-[11pt] font-bold uppercase tracking-wider flex-1">
                      {sectionNames.experience}
                    </h2>
                    {isEditing && (
                      <button
                        type="button"
                        onClick={() => addItem("experience")}
                        className="text-xs bg-green-100 text-green-700 px-2 rounded"
                      >
                        + Add
                      </button>
                    )}
                  </div>
                  <div className="space-y-3">
                    {(!resume.experience || resume.experience.length === 0) &&
                      !isEditing && (
                        <p className="text-[10pt] text-gray-500 italic">
                          No experience information available
                        </p>
                      )}
                    {resume.experience?.map((exp, idx) => (
                      <div
                        key={exp.id}
                        className={`relative group experience-item resume-item ${
                          isEditing
                            ? "cursor-move hover:bg-gray-50 rounded p-1 -m-1"
                            : ""
                        } ${
                          draggedItem?.section === "experience" &&
                          draggedItem?.index === idx
                            ? "opacity-50"
                            : ""
                        } ${
                          dragOverItem?.section === "experience" &&
                          dragOverItem?.index === idx
                            ? "border-t-2 border-blue-500"
                            : ""
                        }`}
                        draggable={isEditing}
                        onDragStart={() => handleDragStart("experience", idx)}
                        onDragOver={(e) => handleDragOver(e, "experience", idx)}
                        onDragEnd={handleDragEnd}
                        onDrop={() => handleDrop("experience", idx)}
                      >
                        {isEditing && (
                          <span className="absolute -left-5 top-2 text-gray-300 cursor-grab no-print">
                            ⋮⋮
                          </span>
                        )}
                        {isEditing && (
                          <button
                            type="button"
                            onClick={() => removeItem("experience", idx)}
                            className="absolute -left-10 top-0 text-red-400 hover:text-red-600 no-print"
                            aria-label={`Remove ${exp.company}`}
                          >
                            ×
                          </button>
                        )}
                        <div className="flex justify-between items-baseline">
                          {isEditing ? (
                            <input
                              className="font-bold text-[11pt] w-1/2 border-b border-gray-200 bg-transparent outline-none"
                              value={exp.company}
                              onChange={(e) =>
                                handleNestedChange(
                                  "experience",
                                  idx,
                                  "company",
                                  e.target.value,
                                )
                              }
                            />
                          ) : (
                            <span className="font-bold text-[11pt]">
                              {exp.company}
                            </span>
                          )}
                          {isEditing ? (
                            <input
                              className="text-[10pt] text-right border-b border-gray-200 bg-transparent outline-none"
                              value={exp.period}
                              onChange={(e) =>
                                handleNestedChange(
                                  "experience",
                                  idx,
                                  "period",
                                  e.target.value,
                                )
                              }
                            />
                          ) : (
                            <span className="text-[10pt]">{exp.period}</span>
                          )}
                        </div>
                        <div className="flex justify-between items-baseline mb-1">
                          {isEditing ? (
                            <input
                              className="italic text-[10pt] w-full border-b border-gray-200 bg-transparent outline-none"
                              value={exp.title}
                              onChange={(e) =>
                                handleNestedChange(
                                  "experience",
                                  idx,
                                  "title",
                                  e.target.value,
                                )
                              }
                            />
                          ) : (
                            <span className="italic text-[10pt]">
                              {exp.title}
                            </span>
                          )}
                        </div>
                        {isEditing ? (
                          <textarea
                            className="w-full text-[10pt] border border-gray-200 rounded p-1 min-h-[80px] bg-transparent outline-none font-sans"
                            value={(exp.description || []).join("\n")}
                            onChange={(e) =>
                              handleArrayStringChange(
                                "experience",
                                idx,
                                "description",
                                e.target.value,
                              )
                            }
                          />
                        ) : (
                          <ul className="list-disc list-outside ml-4 space-y-0.5">
                            {(exp.description || []).map((desc, i) => (
                              <li key={i} className="text-[10pt] pl-1">
                                {desc}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              );
            }

            if (sectionKey === "projects") {
              return (
                <section
                  key="projects"
                  className={`mb-4 resume-section allow-break ${
                    draggedSection === "projects" ? "opacity-50" : ""
                  } ${
                    dragOverSection === "projects"
                      ? "border-t-4 border-blue-500"
                      : ""
                  }`}
                  draggable={isEditing}
                  onDragStart={(e) => {
                    e.stopPropagation();
                    handleSectionDragStart("projects");
                  }}
                  onDragOver={(e) => handleSectionDragOver(e, "projects")}
                  onDragEnd={handleSectionDragEnd}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleSectionDrop("projects");
                  }}
                >
                  <div className="flex justify-between items-center border-b border-black mb-2 pb-0.5">
                    {isEditing && (
                      <span className="text-gray-400 cursor-grab mr-2 no-print text-lg">
                        ⋮⋮
                      </span>
                    )}
                    <h2 className="text-[11pt] font-bold uppercase tracking-wider flex-1">
                      {sectionNames.projects}
                    </h2>
                    {isEditing && (
                      <button
                        type="button"
                        onClick={() => addItem("projects")}
                        className="text-xs bg-green-100 text-green-700 px-2 rounded"
                      >
                        + Add
                      </button>
                    )}
                  </div>
                  <div className="space-y-3">
                    {(!resume.projects || resume.projects.length === 0) &&
                      !isEditing && (
                        <p className="text-[10pt] text-gray-500 italic">
                          No projects available
                        </p>
                      )}
                    {resume.projects?.map((proj, idx) => (
                      <div
                        key={proj.id}
                        className={`relative group project-item resume-item ${
                          isEditing
                            ? "cursor-move hover:bg-gray-50 rounded p-1 -m-1"
                            : ""
                        } ${
                          draggedItem?.section === "projects" &&
                          draggedItem?.index === idx
                            ? "opacity-50"
                            : ""
                        } ${
                          dragOverItem?.section === "projects" &&
                          dragOverItem?.index === idx
                            ? "border-t-2 border-blue-500"
                            : ""
                        }`}
                        draggable={isEditing}
                        onDragStart={() => handleDragStart("projects", idx)}
                        onDragOver={(e) => handleDragOver(e, "projects", idx)}
                        onDragEnd={handleDragEnd}
                        onDrop={() => handleDrop("projects", idx)}
                      >
                        {isEditing && (
                          <span className="absolute -left-5 top-2 text-gray-300 cursor-grab no-print">
                            ⋮⋮
                          </span>
                        )}
                        {isEditing && (
                          <button
                            type="button"
                            onClick={() => removeItem("projects", idx)}
                            className="absolute -left-10 top-0 text-red-400 hover:text-red-600 no-print"
                            aria-label={`Remove ${proj.name}`}
                          >
                            ×
                          </button>
                        )}
                        <div className="flex justify-between items-start mb-1">
                          <div className="text-[11pt] flex-1">
                            {isEditing ? (
                              <div className="flex flex-col gap-2 mb-1">
                                <input
                                  className="font-bold border-b border-gray-200 bg-transparent outline-none"
                                  value={proj.name}
                                  onChange={(e) =>
                                    handleNestedChange(
                                      "projects",
                                      idx,
                                      "name",
                                      e.target.value,
                                    )
                                  }
                                  placeholder="Project Name"
                                />
                                <input
                                  className="italic text-[10pt] border-b border-gray-200 bg-transparent outline-none"
                                  value={proj.technologies?.join(", ") || ""}
                                  onChange={(e) =>
                                    handleNestedChange(
                                      "projects",
                                      idx,
                                      "technologies",
                                      e.target.value
                                        .split(/,\s*/)
                                        .filter(Boolean),
                                    )
                                  }
                                  placeholder="Tech 1, Tech 2"
                                />
                                <input
                                  className="text-[9pt] border-b border-gray-200 bg-transparent outline-none"
                                  value={proj.homepage || ""}
                                  onChange={(e) =>
                                    handleNestedChange(
                                      "projects",
                                      idx,
                                      "homepage",
                                      e.target.value,
                                    )
                                  }
                                  placeholder="Live URL (homepage)"
                                />
                                <input
                                  className="text-[9pt] border-b border-gray-200 bg-transparent outline-none"
                                  value={proj.url || ""}
                                  onChange={(e) =>
                                    handleNestedChange(
                                      "projects",
                                      idx,
                                      "url",
                                      e.target.value,
                                    )
                                  }
                                  placeholder="GitHub URL"
                                />
                              </div>
                            ) : (
                              <div className="flex justify-between items-start">
                                <div>
                                  <span className="font-bold">{proj.name}</span>
                                  <span className="mx-1">|</span>
                                  <span className="italic text-[10pt]">
                                    {(proj.technologies || []).join(", ")}
                                  </span>
                                </div>
                                {(proj.homepage || proj.url) && (
                                  <div className="text-[9pt] text-gray-600 flex items-center gap-2 whitespace-nowrap ml-4">
                                    {/* Smart link logic:
                                        - Homepage + Public repo = Both links
                                        - Homepage only (private repo) = Live link only
                                        - No homepage + Public repo = GitHub link only
                                        - No homepage + Private repo = No links
                                    */}
                                    {proj.homepage && (
                                      <a
                                        href={proj.homepage}
                                        className="hover:underline"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        Live Link
                                      </a>
                                    )}
                                    {proj.homepage &&
                                      !proj.isPrivate &&
                                      proj.url && <span>—</span>}
                                    {!proj.isPrivate && proj.url && (
                                      <a
                                        href={proj.url}
                                        className="hover:underline"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        GitHub
                                      </a>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        {isEditing ? (
                          <textarea
                            className="w-full text-[10pt] border border-gray-200 rounded p-1 min-h-[60px] bg-transparent outline-none font-sans"
                            value={(proj.description || []).join("\n")}
                            onChange={(e) =>
                              handleArrayStringChange(
                                "projects",
                                idx,
                                "description",
                                e.target.value,
                              )
                            }
                          />
                        ) : (
                          <ul className="list-disc list-outside ml-4 space-y-0.5">
                            {(proj.description || []).map((desc, i) => (
                              <li key={i} className="text-[10pt] pl-1">
                                {desc}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              );
            }

            if (sectionKey === "skills") {
              return (
                <section
                  key="skills"
                  className={`mb-4 resume-section ${
                    draggedSection === "skills" ? "opacity-50" : ""
                  } ${
                    dragOverSection === "skills"
                      ? "border-t-4 border-blue-500"
                      : ""
                  }`}
                  draggable={isEditing}
                  onDragStart={(e) => {
                    e.stopPropagation();
                    handleSectionDragStart("skills");
                  }}
                  onDragOver={(e) => handleSectionDragOver(e, "skills")}
                  onDragEnd={handleSectionDragEnd}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleSectionDrop("skills");
                  }}
                >
                  <div className="flex justify-between items-center border-b border-black mb-2 pb-0.5">
                    {isEditing && (
                      <span className="text-gray-400 cursor-grab mr-2 no-print text-lg">
                        ⋮⋮
                      </span>
                    )}
                    <h2 className="text-[11pt] font-bold uppercase tracking-wider flex-1">
                      {sectionNames.skills}
                    </h2>
                  </div>
                  <div className="text-[10pt] space-y-1">
                    <div className={isEditing ? "mb-2" : ""}>
                      <span className="font-bold">Languages:</span>
                      {isEditing ? (
                        <input
                          className="w-full border-b border-gray-200 ml-2 bg-transparent outline-none"
                          value={(resume.skills?.languages || []).join(", ")}
                          onChange={(e) =>
                            handleSkillChange("languages", e.target.value)
                          }
                        />
                      ) : (
                        <span className="ml-1">
                          {(resume.skills?.languages || [])
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      )}
                    </div>
                    <div className={isEditing ? "mb-2" : ""}>
                      <span className="font-bold">Frameworks:</span>
                      {isEditing ? (
                        <input
                          className="w-full border-b border-gray-200 ml-2 bg-transparent outline-none"
                          value={(resume.skills?.frameworks || []).join(", ")}
                          onChange={(e) =>
                            handleSkillChange("frameworks", e.target.value)
                          }
                        />
                      ) : (
                        <span className="ml-1">
                          {(resume.skills?.frameworks || [])
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      )}
                    </div>
                    <div className={isEditing ? "mb-2" : ""}>
                      <span className="font-bold">Developer Tools:</span>
                      {isEditing ? (
                        <input
                          className="w-full border-b border-gray-200 ml-2 bg-transparent outline-none"
                          value={(resume.skills?.tools || []).join(", ")}
                          onChange={(e) =>
                            handleSkillChange("tools", e.target.value)
                          }
                        />
                      ) : (
                        <span className="ml-1">
                          {(resume.skills?.tools || [])
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                </section>
              );
            }

            return null;
          })}
        </div>
      </div>
    </div>
  );
};

export default ResumeView;
