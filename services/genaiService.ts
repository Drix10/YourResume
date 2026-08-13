import { GoogleGenAI, Type, Schema } from "@google/genai";
import { GitHubRepo, GitHubUser, ResumeData, EnrichedRepoData } from '../types';
import { GITHUB_API } from '../constants';

// Generate UUID with fallback for older browsers
const generateId = (): string => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
};



const resumeSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    fullName: { type: Type.STRING, description: "Full professional name (plain text, no emojis or special characters)" },
    title: { type: Type.STRING, description: "Standardized ATS-recognized professional title reflecting seniority and stack (e.g., 'Senior Full-Stack Engineer', 'Staff Backend Developer', 'Frontend Architect')" },
    email: { type: Type.STRING, description: "Professional email address" },
    phone: { type: Type.STRING, description: "Phone number if found in LinkedIn text or bio (format: +country code)" },
    location: { type: Type.STRING, description: "City, State/Country format" },
    linkedinUrl: { type: Type.STRING, description: "LinkedIn profile URL if mentioned in context" },
    education: {
      type: Type.ARRAY,
      description: "Educational background using standard institution and degree names. Extract from LinkedIn text first, then GitHub bio. Leave empty array if none found - do not fabricate.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "Unique item ID. Copy the exact ID character-for-character from the current resume if editing. If creating a new item, omit or leave blank." },
          institution: { type: Type.STRING, description: "University or college name" },
          degree: { type: Type.STRING, description: "Degree type and major (e.g., 'B.S. Computer Science')" },
          location: { type: Type.STRING, description: "City, Country" },
          period: { type: Type.STRING, description: "Standard ATS date range (e.g., '2018 - 2022', 'Sep 2018 - May 2022')" }
        },
        required: ["institution", "degree"]
      }
    },
    certifications: {
      type: Type.ARRAY,
      description: "Professional certifications and licenses. Extract from LinkedIn text. Include credential IDs and URLs if available. Leave empty array if none found.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "Unique item ID. Copy the exact ID character-for-character from the current resume if editing. If creating a new item, omit or leave blank." },
          name: { type: Type.STRING, description: "Certification name (e.g., 'AWS Certified Solutions Architect')" },
          issuer: { type: Type.STRING, description: "Issuing organization (e.g., 'Amazon Web Services', 'Google', 'IBM')" },
          date: { type: Type.STRING, description: "Issue date in standard ATS format (e.g., 'Jan 2024', '2024')" },
          credentialId: { type: Type.STRING, description: "Credential ID if available" },
          credentialUrl: { type: Type.STRING, description: "Credential verification URL if available" }
        },
        required: ["name", "issuer", "date"]
      }
    },
    skills: {
      type: Type.OBJECT,
      description: "Technical skills organized by standard ATS categories. Be comprehensive and accurate with canonical tech names.",
      properties: {
        languages: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Programming languages (e.g., TypeScript, Python, Go, Rust, C++)" },
        frameworks: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Frameworks and libraries (e.g., React.js, Node.js, Express.js, Django, TensorFlow)" },
        tools: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Developer tools, platforms, databases (e.g., Docker, Kubernetes, AWS, PostgreSQL, Git)" }
      },
      required: ["languages", "frameworks", "tools"]
    },
    projects: {
      type: Type.ARRAY,
      description: "Exactly 2 to 3 most impressive, high-impact technical projects. Limit this section strictly to keep the entire resume on a single page.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "Unique item ID. Copy the exact ID character-for-character from the current resume if editing. If creating a new item, omit or leave blank." },
          name: { type: Type.STRING, description: "Project name (use repo name or cleaned-up version)" },
          description: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "1 to 2 concise, ATS-optimized bullet points (max 120 characters each) starting with strong action verbs. Follow Google XYZ formula (Accomplished [X] as measured by [Y], by doing [Z])."
          },
          technologies: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Key technologies used (3-6 canonical names)" },
          url: { type: Type.STRING, description: "Repository or live URL" },
          stars: { type: Type.NUMBER, description: "GitHub stars count" }
        },
        required: ["name", "description", "technologies"]
      }
    },
    experience: {
      type: Type.ARRAY,
      description: "Exactly 2 to 3 most recent or relevant professional experiences. Limit this section strictly to ensure the resume fits on a single page.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "Unique item ID. Copy the exact ID character-for-character from the current resume if editing. If creating a new item, omit or leave blank." },
          title: { type: Type.STRING, description: "Standard ATS job title" },
          company: { type: Type.STRING, description: "Company or organization name" },
          period: { type: Type.STRING, description: "Standard ATS date range (e.g., 'Jan 2022 - Present', 'Aug 2020 - Dec 2022')" },
          description: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "1 to 2 highly concise, results-driven bullet points (max 120 characters each) starting with strong past-tense action verbs. Follow Google XYZ formula."
          }
        },
        required: ["title", "company", "period", "description"]
      }
    }
  },
  required: ["fullName", "title", "skills", "projects", "experience"]
};

// Helper to sort and format repos for context
const formatReposForContext = (repos: GitHubRepo[], limit: number = 50) => {
  if (!repos || repos.length === 0) return [];

  return repos
    .map(r => {
      // Calculate days since last update
      let daysSinceUpdate = 365;
      try {
        const date = new Date(r.updated_at);
        if (!isNaN(date.getTime())) {
          daysSinceUpdate = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
        }
      } catch {
        // Use default of 1 year
      }

      const stars = typeof r.stargazers_count === 'number' ? r.stargazers_count : 0;
      const forks = typeof r.forks_count === 'number' ? r.forks_count : 0;
      const size = typeof r.size === 'number' ? r.size : 0; // Size in KB

      // Score components:
      // 1. Stars: Extremely high weight (10000 pts per star)
      // 2. Forks: High weight (2000 pts per fork)
      // 3. Size: Metric of codebase scale (1 pt per KB, capped at 50000 to prevent massive repos from overwhelming)
      // 4. Recency: Tie breaker / secondary factor (up to 5000 pts)
      let recencyScore = 0;
      if (daysSinceUpdate < 30) recencyScore = 5000;
      else if (daysSinceUpdate < 90) recencyScore = 3000;
      else if (daysSinceUpdate < 180) recencyScore = 1500;
      else if (daysSinceUpdate < 365) recencyScore = 500;

      // Penalize forked repos in pre-sorting to prioritize original work
      const forkPenalty = r.fork ? -20000 : 0;

      const sortScore = (stars * 10000) + (forks * 2000) + Math.min(size, 50000) + recencyScore + forkPenalty;

      return {
        ...r,
        sortScore
      };
    })
    .sort((a, b) => b.sortScore - a.sortScore)
    .slice(0, limit)
    .map(r => {
      // Safe date extraction
      let updatedDate = 'unknown';
      try {
        if (r.updated_at && r.updated_at.includes('T')) {
          updatedDate = r.updated_at.split('T')[0];
        }
      } catch {
        updatedDate = 'unknown';
      }

      return {
        name: r.name,
        desc: r.description,
        lang: r.language,
        topics: r.topics,
        stars: r.stargazers_count,
        updated: updatedDate,
        isFork: r.fork,
        url: r.html_url // Include URL to map back later if needed
      };
    });
};

export const generateResumeFromGithub = async (
  apiKey: string,
  user: GitHubUser,
  repos: GitHubRepo[],
  enrichedRepos: EnrichedRepoData[],
  linkedinText: string
): Promise<ResumeData> => {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error("Gemini API Key is required. Please enter your API key.");
  }

  const trimmedApiKey = apiKey.trim();

  if (!repos || repos.length === 0) {
    throw new Error("No repositories found. Please ensure your GitHub account has at least one repository.");
  }

  const genAI = new GoogleGenAI({ apiKey: trimmedApiKey });
  const relevantRepos = formatReposForContext(repos, GITHUB_API.TOP_REPOS_FOR_INITIAL);

  // Format enriched repo data for AI (already sorted by smart scoring)
  const enrichedRepoContext = enrichedRepos.map(r => ({
    name: r.name,
    description: r.description,
    language: r.language,
    topics: r.topics,
    isPrivate: r.private,
    stars: r.stargazers_count,
    forks: r.forks_count,
    homepage: r.homepage,
    // Work metrics (important for private repos)
    commits: r.enrichedData?.commitCount,
    codeSize: r.enrichedData?.totalCodeBytes,
    languageCount: r.enrichedData?.languageCount,
    qualityScore: r.calculatedScore, // Our smart scoring
    // Deep analysis data
    packageDescription: r.enrichedData?.packageJson?.description,
    dependencies: r.enrichedData?.detectedTechnologies?.slice(0, 30), // Top 30 techs (more for diverse stacks)
    hasTests: r.enrichedData?.packageJson?.scripts?.some(s => s.includes('test')),
    hasBuild: r.enrichedData?.packageJson?.scripts?.some(s => s.includes('build')),
    hasLint: r.enrichedData?.packageJson?.scripts?.some(s => s.includes('lint')),
    hasDemo: r.enrichedData?.readme?.hasDemo,
    hasDocs: r.enrichedData?.readme?.hasDocs,
    hasMetrics: r.enrichedData?.readme?.hasMetrics,
    projectType: r.enrichedData?.readme?.projectType,
    complexity: r.enrichedData?.readme?.complexity,
    readmeLength: r.enrichedData?.readme?.length,
    techStack: r.enrichedData?.readme?.techMentions,
    // ML/Data Science indicators
    isMLProject: r.enrichedData?.isMLProject,
    isDataScience: r.enrichedData?.isDataScience,
  }));

  const prompt = `
You are an elite ATS-Optimized Resume Writer specializing in high-density, single-page tech resumes.

CANDIDATE DATA:
===============
Name: ${user.name || user.login}
Location: ${user.location || 'Not specified'}
Company: ${user.company || 'Not specified'}
Bio: ${user.bio || 'Not specified'}
Website/Blog: ${user.blog || 'None'}
Email: ${user.email || 'Not provided'}

GITHUB REPOSITORIES (Top 20 by activity/stars):
${JSON.stringify(relevantRepos, null, 2)}

DEEP REPOSITORY ANALYSIS (Top ${enrichedRepos.length} repos with package.json/requirements.txt/README analysis):
${JSON.stringify(enrichedRepoContext, null, 2)}

LINKEDIN / ADDITIONAL CONTEXT:
${linkedinText || "No additional context provided."}

TASK: Generate an ATS-optimized, professional resume JSON.

=== STRICT ATS FORMATTING & PARSING RULES (CRITICAL) ===
1. STANDARD ATS SECTION HEADERS: Use standard section names: "Education", "Experience", "Projects", "Technical Skills", "Certifications".
2. ZERO EMOJIS OR UNICODE SYMBOLS: Do NOT output emojis (🚀, 💻, ✨), non-ASCII bullet symbols (•, ★, ⚡), HTML tags, or icons. Output 100% clean ASCII plain text.
3. ACRONYM & FULL TECH NAME STANDARD: Spell out full technology names first or in skills lists, optionally followed by standard acronyms in parentheses:
   - "Amazon Web Services (AWS)", "Google Cloud Platform (GCP)", "Continuous Integration / Continuous Deployment (CI/CD)"
   - "Application Programming Interface (API)", "Object-Relational Mapping (ORM)", "Artificial Intelligence / Machine Learning (AI/ML)"
   - Canonical names: Use "React.js" (not "Reactjs"), "Node.js", "TypeScript", "JavaScript" (not "JS").
4. STANDARD ATS DATE FORMAT: Use standard dates: "Jan 2023 - Present", "Aug 2021 - Dec 2023", or "2020 - 2022". Never relative dates like "recently".
5. KEYWORD DENSITY ALIGNMENT: Ensure technologies listed in Technical Skills or Project technologies appear naturally within Experience and Project bullet points.

=== ATS ACTION VERB ENFORCEMENT & GOOGLE XYZ FORMULA (CRITICAL) ===
1. Start EVERY bullet point with a strong, high-impact past-tense ATS Action Verb (or present tense for current position).
   - APPROVED ACTION VERBS: Architected, Engineered, Designed, Implemented, Developed, Deployed, Spearheaded, Scaled, Automated, Streamlined, Reduced, Optimized, Orchestrated, Integrated, Benchmarked, Refactored.
   - FORBIDDEN PASSIVE VERBS: "worked on", "was responsible for", "assisted with", "helped with", "handled", "participated in".
2. METRICS REQUIREMENT: Quantified metrics (percentages, throughput, latency reductions, user scale) are REQUIRED ONLY when supported by supplied candidate data, repository analysis, benchmarks, README files, or LinkedIn history. When numerical metrics are NOT provided or verifiable from candidate data, write a factual technical action and implementation statement describing WHAT was built and HOW without inventing or inferring unsupported business outcomes.
3. Every bullet point MUST follow one of these frameworks:

**Google's XYZ Formula**:
- "Accomplished [X: technical achievement] as measured by [Y: verified metric if available, or factual outcome], by doing [Z: technical implementation using specific packages/frameworks]"

**WHO Framework** (What, How, Outcome):
- "Developed [WHAT] using [HOW/technologies] resulting in [OUTCOME with metrics if available]"

**CAN Framework** (Challenge, Action, Numbers):
- "[CHALLENGE faced] → [ACTION taken] → [NUMBERS/measurable result if available]"

**TRP Framework** (Task, Result, Performance metric):
- "[TASK] achieving [RESULT] with [PERFORMANCE METRIC if available]"

=== STRICT ONE-PAGE CONSTRAINT & CONCISENESS ===
To guarantee this resume fits perfectly on EXACTLY one page (A4/Letter):
1. LIMIT professional experience (Experience section) to exactly the top 2-3 most recent or relevant roles.
2. LIMIT projects (Projects section) to 1-3 verified projects based on supplied repository data. Require 2 or 3 projects ONLY when supported by verified candidate sources; do NOT invent unsupported projects.
3. Every bullet point MUST be highly concise (maximum 120 characters per bullet) and fit on a single line when rendered. Avoid wordy explanations, narrative paragraphs, or filler.
4. Focus heavily on What was done, What technologies/libraries/tools were used, and What the measurable outcome/metric was.
5. Do not duplicate information between sections.

=== SOPHISTICATED TECHNICAL LINGO & ARCHITECTURAL DEPTH (FACTUAL & VERIFIED ONLY) ===
Do NOT write simple or basic sentences (e.g., "Built a backend using Node" or "Made a website with React").
Instead, uplift the lingo to read like a Senior/Principal Engineer, BUT you MUST strictly tie this advanced lingo *only* to the actual verified technologies, languages, and dependencies present in the project's repository data, README files, or LinkedIn history. 

**STRICT ACCURACY RULES (CRITICAL):**
1. DO NOT assume or invent architectures, frameworks, or database patterns that were never used. If a repository has no Go code, do NOT mention Goroutines. If a repository has no Redis dependency, do NOT claim you built a Redis caching layer.
2. Read the 'dependencies', 'techStack', 'projectType', and 'complexity' fields of the repository carefully. Match your architectural descriptions character-for-character to these actual files.
3. If React/Next.js/Vue is used, you may talk about: "optimizing DOM reconciliation cycles", "virtualized list rendering", "reactive state machines", or "component life-cycle/re-render optimizations".
4. If Node.js is used, you may talk about: "non-blocking asynchronous event loop mechanics", "optimizing event emitters", or "handling async file streams".
5. If Go is used, you may talk about: "goroutine pooling", "channel-based message structures", or "concurrency flow multiplexing".
6. If Python or Machine Learning is used, you may talk about: "fine-tuning model weights scaling", "optimizing tensor shapes", "vector similarity queries", or "asynchronous data pipelines".
7. Quantified metrics are required ONLY when supported by supplied candidate data or repository files; otherwise, provide a factual technical action and implementation statement without inventing or inferring business outcomes.

=== SECTION GUIDELINES ===
1. PROFESSIONAL TITLE: Format: "[Seniority] [Specialization] [Engineer/Developer]" (e.g. "Senior Software Engineer", "Full Stack Developer", "Backend Engineer")
2. EDUCATION: Extract ONLY from LinkedIn text or GitHub bio (DO NOT fabricate). Limit to top 1-2 entries.
3. CERTIFICATIONS & LICENSES: Extract from LinkedIn text (DO NOT fabricate). Limit to top 2-3 items.
4. EXPERIENCE: Extract from LinkedIn or fallback to Open Source Contributor. Exactly 1 to 2 bullets per role (max 120 characters each).
5. PROJECTS: Select 1 to 3 verified projects. Require 2 or 3 projects ONLY when supported by verified repository data; prohibit inventing unsupported projects.
6. TECHNICAL SKILLS: Categorize into Languages, Frameworks, and Tools. Format as clean array lists.

Output strictly valid JSON matching the schema.
  `;

  let response;
  try {
    response = await genAI.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: resumeSchema,
        temperature: 0.3,
      }
    });
  } catch (apiError: any) {
    console.error('AI API call failed:', apiError);
    if (apiError?.message?.includes('quota') || apiError?.message?.includes('rate limit')) {
      throw new Error('AI service quota exceeded. Please try again later or check your API key limits.');
    }
    throw new Error(`AI service error: ${apiError?.message || 'Unknown error occurred'}`);
  }

  let data: ResumeData;
  try {
    const responseText = response.text || '{}';
    if (!responseText || responseText.trim().length === 0) {
      throw new Error('AI returned empty response');
    }
    data = JSON.parse(responseText) as ResumeData;

    // Validate that we got at least the required fields
    if (!data.fullName || !data.title) {
      throw new Error('AI response missing required fields');
    }
  } catch (parseError: any) {
    console.error('Failed to parse AI response:', parseError);
    throw new Error(`AI generated invalid response: ${parseError?.message || 'Parse error'}. Please try again.`);
  }

  // Ensure required fields exist with safe defaults
  data.fullName = data.fullName || user.name || user.login;
  data.title = data.title || 'Software Developer';
  data.email = data.email || user.email || '';
  data.phone = data.phone || '';
  data.location = data.location || user.location || '';
  data.linkedinUrl = data.linkedinUrl || '';
  data.education = data.education || [];
  data.certifications = data.certifications || [];
  data.experience = data.experience || [];
  data.projects = data.projects || [];
  data.skills = data.skills || { languages: [], frameworks: [], tools: [] };
  data.skills.languages = data.skills.languages || [];
  data.skills.frameworks = data.skills.frameworks || [];
  data.skills.tools = data.skills.tools || [];

  // Hydrate with real links
  data.githubUrl = user.html_url;
  data.website = user.blog || '';

  // Assign UUIDs to items that don't have them
  data.education = data.education.map(e => ({ ...e, id: e.id || generateId() }));
  data.certifications = (data.certifications || []).map(c => ({ ...c, id: c.id || generateId() }));
  data.experience = data.experience.map(e => ({ ...e, id: e.id || generateId() }));

  data.projects = data.projects.map(p => {
    // Try exact match first
    let realRepo = repos.find(r => r.name.toLowerCase() === p.name.toLowerCase());

    // If no exact match, try to find related repos (for merged projects like "idolchat" from "idolchat-app")
    if (!realRepo) {
      const projectNameLower = p.name.toLowerCase();
      // Find repos that start with the project name (e.g., "idolchat-app" starts with "idolchat")
      const relatedRepos = repos.filter(r =>
        r.name.toLowerCase().startsWith(projectNameLower + '-') ||
        r.name.toLowerCase() === projectNameLower
      );

      // Use the one with most stars, or first match
      if (relatedRepos.length > 0) {
        realRepo = relatedRepos.reduce((best, current) =>
          (current.stargazers_count || 0) > (best.stargazers_count || 0) ? current : best
        );
      }
    }

    return {
      ...p,
      id: p.id || generateId(),
      url: realRepo ? realRepo.html_url : (p.url || ''),
      homepage: realRepo?.homepage || p.homepage || '',
      isPrivate: realRepo?.private || false,
      stars: realRepo ? realRepo.stargazers_count : (p.stars || 0),
      description: p.description || [],
      technologies: p.technologies || []
    };
  });

  return sanitizeAtsData(data);
};

// Sanitize user prompt to prevent prompt injection
const sanitizeUserPrompt = (prompt: string): string => {
  if (!prompt || typeof prompt !== 'string') return '';

  // Limit length
  const maxLength = 1000;
  let sanitized = prompt.slice(0, maxLength);

  // Remove potential prompt injection patterns
  sanitized = sanitized
    .replace(/```/g, '') // Remove code blocks
    .replace(/\n{3,}/g, '\n\n') // Limit consecutive newlines
    .replace(/^(system|assistant|user|model):/gim, '') // Remove role prefixes
    .replace(/\[INST\]|\[\/INST\]/gi, '') // Remove instruction markers
    .replace(/<\|.*?\|>/g, '') // Remove special tokens
    .replace(/<<.*?>>/g, '') // Remove template markers
    .replace(/\{%.*?%\}/g, '') // Remove template tags
    .replace(/<%.*?%>/g, '') // Remove ERB-style tags
    .replace(/\$\{.*?\}/g, '') // Remove template literals
    .trim();

  return sanitized;
};

// Helper to clean non-ATS elements (emojis, unicode symbols, HTML tags, leading bullet markers) from text fields
export const cleanAtsText = (text: unknown): string => {
  if (text === null || text === undefined) return '';
  const str = typeof text === 'string' ? text : String(text);
  return str
    .normalize('NFD') // Normalize Unicode diacritics
    .replace(/[\u0300-\u036f]/g, '') // Strip combining diacritical marks
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{2022}\u{2023}\u{25E6}\u{2043}\u{2219}]/gu, '') // Remove emojis & symbols
    .replace(/^(?:[\-\*\•\>\#\–\—]+|\d+[\.\)])\s*/, '') // Remove leading list markers
    .replace(/[^\x20-\x7E]/g, '') // Remove every character outside ASCII allowlist
    .trim();
};

const ensureArray = (val: unknown): string[] => {
  if (Array.isArray(val)) {
    return val.map(v => cleanAtsText(v)).filter(Boolean);
  }
  if (typeof val === 'string' && val.trim()) {
    const cleaned = cleanAtsText(val);
    return cleaned ? [cleaned] : [];
  }
  return [];
};

export const sanitizeAtsData = (data: ResumeData): ResumeData => {
  if (!data || typeof data !== 'object') {
    return data;
  }
  return {
    ...data,
    fullName: cleanAtsText(data.fullName),
    title: cleanAtsText(data.title),
    email: cleanAtsText(data.email),
    phone: cleanAtsText(data.phone),
    location: cleanAtsText(data.location),
    linkedinUrl: typeof data.linkedinUrl === 'string' ? data.linkedinUrl.trim() : '',
    githubUrl: typeof data.githubUrl === 'string' ? data.githubUrl.trim() : '',
    website: typeof data.website === 'string' ? data.website.trim() : '',
    skills: {
      languages: ensureArray(data.skills?.languages),
      frameworks: ensureArray(data.skills?.frameworks),
      tools: ensureArray(data.skills?.tools),
    },
    education: (Array.isArray(data.education) ? data.education : []).map(e => ({
      ...e,
      institution: cleanAtsText(e?.institution),
      degree: cleanAtsText(e?.degree),
      location: cleanAtsText(e?.location),
      period: cleanAtsText(e?.period)
    })),
    certifications: (Array.isArray(data.certifications) ? data.certifications : []).map(c => ({
      ...c,
      name: cleanAtsText(c?.name),
      issuer: cleanAtsText(c?.issuer),
      date: cleanAtsText(c?.date),
      credentialId: cleanAtsText(c?.credentialId),
      credentialUrl: typeof c?.credentialUrl === 'string' ? c.credentialUrl.trim() : ''
    })),
    experience: (Array.isArray(data.experience) ? data.experience : []).map(exp => ({
      ...exp,
      title: cleanAtsText(exp?.title),
      company: cleanAtsText(exp?.company),
      period: cleanAtsText(exp?.period),
      description: ensureArray(exp?.description)
    })),
    projects: (Array.isArray(data.projects) ? data.projects : []).map(p => ({
      ...p,
      name: cleanAtsText(p?.name),
      technologies: ensureArray(p?.technologies),
      description: ensureArray(p?.description)
    }))
  };
};

export const updateResumeWithAI = async (
  apiKey: string,
  currentResume: ResumeData,
  userPrompt: string,
  context: { user: GitHubUser; repos: GitHubRepo[]; enrichedRepos: EnrichedRepoData[]; linkedinText: string }
): Promise<ResumeData> => {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('Gemini API Key is required.');
  }

  // Sanitize user input
  const sanitizedPrompt = sanitizeUserPrompt(userPrompt);
  if (!sanitizedPrompt) {
    throw new Error('Please provide a valid instruction for the AI.');
  }

  const genAI = new GoogleGenAI({ apiKey: apiKey.trim() });
  // We include more repos here (top 50) just in case the user asks for a project that wasn't in the original top 20
  const relevantRepos = formatReposForContext(context.repos, GITHUB_API.MAX_REPOS_FOR_CONTEXT);

  // Format enriched data for updates
  const enrichedRepoContext = context.enrichedRepos.map(r => ({
    name: r.name,
    description: r.description,
    dependencies: r.enrichedData?.detectedTechnologies?.slice(0, 20),
    hasTests: r.enrichedData?.packageJson?.scripts?.some(s => s.includes('test')),
    hasBuild: r.enrichedData?.packageJson?.scripts?.some(s => s.includes('build')),
    hasDemo: r.enrichedData?.readme?.hasDemo,
    hasMetrics: r.enrichedData?.readme?.hasMetrics,
    projectType: r.enrichedData?.readme?.projectType,
    complexity: r.enrichedData?.readme?.complexity,
    techStack: r.enrichedData?.readme?.techMentions,
    stars: r.stargazers_count,
    forks: r.forks_count,
  }));

  const prompt = `
You are an ATS-Optimized Resume Editor making precise, targeted edits while strictly maintaining ATS compatibility.

CURRENT RESUME:
${JSON.stringify(currentResume, null, 2)}

AVAILABLE REPOSITORIES (for adding projects/skills):
${JSON.stringify(relevantRepos, null, 2)}

ENRICHED REPOSITORY DATA (with package.json/README analysis):
${JSON.stringify(enrichedRepoContext, null, 2)}

LINKEDIN / ADDITIONAL CONTEXT (Full copy):
${context.linkedinText || "No additional context provided."}

USER CONTEXT:
- Name: ${context.user.name || context.user.login}
- Bio: ${context.user.bio || 'N/A'}

USER INSTRUCTION:
"${sanitizedPrompt}"

=== STRICT ATS FORMATTING & PARSING RULES (CRITICAL) ===
1. STANDARD ATS SECTION HEADERS: Use standard section names: "Education", "Experience", "Projects", "Technical Skills", "Certifications".
2. ZERO EMOJIS OR UNICODE SYMBOLS: Do NOT output emojis (🚀, 💻, ✨), non-ASCII bullet symbols (•, ★, ⚡), HTML tags, or icons. Output 100% clean ASCII plain text.
3. ACRONYM & FULL TECH NAME STANDARD: Use full technology names first or in skills lists, optionally followed by standard acronyms in parentheses:
   - "Amazon Web Services (AWS)", "Google Cloud Platform (GCP)", "Continuous Integration / Continuous Deployment (CI/CD)"
   - "Application Programming Interface (API)", "Object-Relational Mapping (ORM)", "Artificial Intelligence / Machine Learning (AI/ML)"
   - Canonical names: Use "React.js" (not "Reactjs"), "Node.js", "TypeScript", "JavaScript" (not "JS").
4. STANDARD ATS DATE FORMAT: Use standard dates: "Jan 2023 - Present", "Aug 2021 - Dec 2023", or "2020 - 2022". Never relative dates like "recently".
5. KEYWORD DENSITY ALIGNMENT: Ensure technologies listed in Technical Skills appear naturally inside Experience and Project bullet points.

=== ATS ACTION VERB ENFORCEMENT & GOOGLE XYZ FORMULA (CRITICAL) ===
1. Start EVERY updated bullet point with a strong, high-impact past-tense ATS Action Verb (or present tense for current position).
   - APPROVED ACTION VERBS: Architected, Engineered, Designed, Implemented, Developed, Deployed, Spearheaded, Scaled, Automated, Streamlined, Reduced, Optimized, Orchestrated, Integrated, Benchmarked, Refactored.
   - FORBIDDEN PASSIVE VERBS: "worked on", "was responsible for", "assisted with", "helped with", "handled", "participated in".
2. METRICS REQUIREMENT: Quantified metrics are REQUIRED ONLY when supported by supplied candidate data, repository analysis, benchmarks, README files, or LinkedIn history. When numerical metrics are NOT provided or verifiable from candidate data, write a factual technical action and implementation statement describing WHAT was built and HOW without inventing or inferring unsupported business outcomes.

=== STRICT ONE-PAGE CONSTRAINT & CONCISENESS (CRITICAL) ===
The entire resume MUST fit perfectly on EXACTLY one page (A4/Letter).
1. LIMITS ON QUANTITY: The 2-3 role limit in Experience and 1-3 project limit in Projects apply ONLY if the user explicitly requests to condense the resume or specifically asks to edit/truncate/add items in those respective sections.
2. PRESERVE UNTOUCHED SECTIONS: If the user is performing a targeted edit (e.g., updating skills, education, certifications, or editing a specific single project), you MUST preserve all existing roles and projects exactly as they are without deleting, merging, or truncating them to meet the 2-3 limit, while still ensuring the newly edited content is highly concise.
3. Every bullet point MUST be highly concise (maximum 120 characters per bullet) and fit on a single line when rendered. Avoid long, wordy descriptions or paragraph narrative.
4. Focus heavily on What was done, What specific libraries/tools/frameworks were used, and What the measurable outcome/result was.
5. Do not duplicate information between sections.

=== CRITICAL RULES ===
1. PRESERVATION & USER INTENT (CRITICAL):
   - ONLY modify what the user EXPLICITLY asks to change.
   - **PRESERVE ALL ITEM IDs**: Copy the 'id' field character-for-character from currentResume JSON into new resume JSON. Do NOT generate new IDs or drop existing ones.
   - Copy unchanged sections EXACTLY (including all IDs).
   - **CRITICAL**: If user explicitly asks to make descriptions "1 line", "1 bullet point", or "shorten/condense", ALWAYS prioritize this request and generate EXACTLY 1 highly concise bullet point per project/experience.

2. WHEN ADDING CONTENT:
   - Projects: Find in REPOSITORIES or LinkedIn context. Create 1 to 2 concise bullets using Google XYZ/WHO frameworks (max 120 characters each). Default to 2, but use exactly 1 if requested by user.
   - Experience: Extract from LinkedIn context. Create 1 to 2 bullets using frameworks above (max 120 characters each). Default to 2, but use exactly 1 if requested by user.
   - Skills: Add to appropriate category (languages/frameworks/tools)

Return complete resume JSON with ONLY the requested changes.
  `;

  let response;
  try {
    response = await genAI.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: resumeSchema,
        temperature: 0.3,
      }
    });
  } catch (apiError: any) {
    console.error('AI API call failed:', apiError);
    if (apiError?.message?.includes('quota') || apiError?.message?.includes('rate limit')) {
      throw new Error('AI service quota exceeded. Please try again later.');
    }
    throw new Error(`AI service error: ${apiError?.message || 'Unknown error occurred'}`);
  }

  // Parse result with error handling
  let newData: ResumeData;
  try {
    const responseText = response.text || '{}';
    if (!responseText || responseText.trim().length === 0) {
      throw new Error('AI returned empty response');
    }
    newData = JSON.parse(responseText) as ResumeData;
  } catch (parseError: any) {
    console.error('Failed to parse AI response:', parseError);
    throw new Error(`AI generated invalid response: ${parseError?.message || 'Parse error'}. Please try again.`);
  }

  // Ensure arrays exist to prevent crashes
  newData.projects = newData.projects || [];
  newData.experience = newData.experience || [];
  newData.education = newData.education || [];
  newData.certifications = newData.certifications || [];
  newData.skills = newData.skills || { languages: [], frameworks: [], tools: [] };

  // Re-hydrate & reconcile Projects IDs with currentResume
  const existingProjectIds = new Set((currentResume.projects || []).map(p => p.id));
  const consumedProjectIds = new Set<string>();

  newData.projects = newData.projects.map(p => {
    let realRepo = context.repos.find(r => r.name.toLowerCase() === p.name.toLowerCase());
    if (!realRepo) {
      const projectNameLower = p.name.toLowerCase();
      const relatedRepos = context.repos.filter(r =>
        r.name.toLowerCase().startsWith(projectNameLower + '-') ||
        r.name.toLowerCase() === projectNameLower
      );
      if (relatedRepos.length > 0) {
        realRepo = relatedRepos.reduce((best, current) =>
          (current.stargazers_count || 0) > (best.stargazers_count || 0) ? current : best
        );
      }
    }

    let finalId = '';
    if (p.id && existingProjectIds.has(p.id) && !consumedProjectIds.has(p.id)) {
      finalId = p.id;
    } else {
      const existingMatch = (currentResume.projects || []).find(ep =>
        !consumedProjectIds.has(ep.id) &&
        ep.name?.toLowerCase() === p.name?.toLowerCase()
      );
      if (existingMatch) {
        finalId = existingMatch.id;
      } else {
        finalId = (p.id && !existingProjectIds.has(p.id)) ? p.id : generateId();
      }
    }
    consumedProjectIds.add(finalId);

    return {
      ...p,
      id: finalId,
      url: realRepo ? realRepo.html_url : (p.url || ''),
      homepage: realRepo?.homepage || p.homepage || '',
      isPrivate: realRepo?.private || false,
      stars: realRepo ? realRepo.stargazers_count : (p.stars || 0),
      description: p.description || [],
      technologies: p.technologies || []
    };
  });

  // Re-hydrate & reconcile Experience IDs with currentResume
  const existingExperienceIds = new Set((currentResume.experience || []).map(e => e.id));
  const consumedExperienceIds = new Set<string>();

  newData.experience = newData.experience.map(e => {
    let finalId = '';
    if (e.id && existingExperienceIds.has(e.id) && !consumedExperienceIds.has(e.id)) {
      finalId = e.id;
    } else {
      const existingMatch = (currentResume.experience || []).find(ex =>
        !consumedExperienceIds.has(ex.id) &&
        (
          (ex.company?.toLowerCase() === e.company?.toLowerCase() && ex.title?.toLowerCase() === e.title?.toLowerCase()) ||
          ex.company?.toLowerCase() === e.company?.toLowerCase()
        )
      );
      if (existingMatch) {
        finalId = existingMatch.id;
      } else {
        finalId = (e.id && !existingExperienceIds.has(e.id)) ? e.id : generateId();
      }
    }
    consumedExperienceIds.add(finalId);

    return {
      ...e,
      id: finalId,
      description: e.description || []
    };
  });

  // Re-hydrate & reconcile Education IDs with currentResume
  const existingEducationIds = new Set((currentResume.education || []).map(e => e.id));
  const consumedEducationIds = new Set<string>();

  newData.education = newData.education.map(e => {
    let finalId = '';
    if (e.id && existingEducationIds.has(e.id) && !consumedEducationIds.has(e.id)) {
      finalId = e.id;
    } else {
      const existingMatch = (currentResume.education || []).find(ed =>
        !consumedEducationIds.has(ed.id) &&
        (
          (ed.institution?.toLowerCase() === e.institution?.toLowerCase() && ed.degree?.toLowerCase() === e.degree?.toLowerCase()) ||
          ed.institution?.toLowerCase() === e.institution?.toLowerCase()
        )
      );
      if (existingMatch) {
        finalId = existingMatch.id;
      } else {
        finalId = (e.id && !existingEducationIds.has(e.id)) ? e.id : generateId();
      }
    }
    consumedEducationIds.add(finalId);

    return {
      ...e,
      id: finalId
    };
  });

  // Re-hydrate & reconcile Certification IDs with currentResume
  const existingCertIds = new Set((currentResume.certifications || []).map(c => c.id));
  const consumedCertIds = new Set<string>();

  newData.certifications = (newData.certifications || []).map(c => {
    let finalId = '';
    if (c.id && existingCertIds.has(c.id) && !consumedCertIds.has(c.id)) {
      finalId = c.id;
    } else {
      const existingMatch = (currentResume.certifications || []).find(ce =>
        !consumedCertIds.has(ce.id) &&
        (
          (ce.name?.toLowerCase() === c.name?.toLowerCase() && ce.issuer?.toLowerCase() === c.issuer?.toLowerCase()) ||
          ce.name?.toLowerCase() === c.name?.toLowerCase()
        )
      );
      if (existingMatch) {
        finalId = existingMatch.id;
      } else {
        finalId = (c.id && !existingCertIds.has(c.id)) ? c.id : generateId();
      }
    }
    consumedCertIds.add(finalId);

    return {
      ...c,
      id: finalId
    };
  });

  return sanitizeAtsData(newData);
};