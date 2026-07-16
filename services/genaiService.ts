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
    fullName: { type: Type.STRING, description: "Full professional name" },
    title: { type: Type.STRING, description: "Professional title that reflects expertise level and primary tech stack (e.g., 'Senior Full-Stack Engineer', 'Staff Backend Developer', 'Frontend Architect')" },
    email: { type: Type.STRING, description: "Professional email address" },
    phone: { type: Type.STRING, description: "Phone number if found in LinkedIn text or bio (format: +country code)" },
    location: { type: Type.STRING, description: "City, Country format" },
    linkedinUrl: { type: Type.STRING, description: "LinkedIn profile URL if mentioned in context" },
    education: {
      type: Type.ARRAY,
      description: "Educational background. Extract from LinkedIn text first, then GitHub bio. Leave empty array if none found - do not fabricate.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "Unique item ID. Copy the exact ID character-for-character from the current resume if editing. If creating a new item, omit or leave blank." },
          institution: { type: Type.STRING, description: "University or college name" },
          degree: { type: Type.STRING, description: "Degree type and major (e.g., 'B.S. Computer Science')" },
          location: { type: Type.STRING, description: "City, Country" },
          period: { type: Type.STRING, description: "Date range (e.g., '2018 - 2022')" }
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
          name: { type: Type.STRING, description: "Certification name (e.g., 'AI Engineering Professional Certificate')" },
          issuer: { type: Type.STRING, description: "Issuing organization (e.g., 'IBM', 'AWS', 'Google')" },
          date: { type: Type.STRING, description: "Issue date or completion date (e.g., 'Jan 2024', '2024')" },
          credentialId: { type: Type.STRING, description: "Credential ID if available" },
          credentialUrl: { type: Type.STRING, description: "Credential verification URL if available" }
        },
        required: ["name", "issuer", "date"]
      }
    },
    skills: {
      type: Type.OBJECT,
      description: "Technical skills organized by category. Be comprehensive but accurate.",
      properties: {
        languages: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Programming languages (e.g., TypeScript, Python, Go, Rust)" },
        frameworks: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Frameworks and libraries (e.g., React, Node.js, Django, TensorFlow)" },
        tools: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Developer tools, platforms, databases (e.g., Docker, AWS, PostgreSQL, Git)" }
      },
      required: ["languages", "frameworks", "tools"]
    },
    projects: {
      type: Type.ARRAY,
      description: "Exactly 2 to 3 most impressive, high-impact projects. Limit this section strictly to keep the entire resume on a single page.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "Unique item ID. Copy the exact ID character-for-character from the current resume if editing. If creating a new item, omit or leave blank." },
          name: { type: Type.STRING, description: "Project name (use repo name or cleaned-up version)" },
          description: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "1 to 2 concise, technology-focused, impact-driven bullet points (max 120 characters each). Focus heavily on What was done, How (using specific packages/tools/libraries), and Measurable outcome. Default to 2, but use exactly 1 if requested by the user."
          },
          technologies: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Key technologies used (3-6 items)" },
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
          title: { type: Type.STRING, description: "Job title" },
          company: { type: Type.STRING, description: "Company or organization name" },
          period: { type: Type.STRING, description: "Date range (e.g., 'Jan 2022 - Present')" },
          description: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "1 to 2 highly concise, technology-focused, and results-driven bullet points (max 120 characters each). Highlight specific achievements, specific packages/tools/libraries used, and quantifiable metrics. Default to 2, but use exactly 1 if requested by the user."
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

=== STRICT ONE-PAGE CONSTRAINT & CONCISENESS (CRITICAL) ===
To guarantee this resume fits perfectly on EXACTLY one page (A4/Letter):
1. LIMIT professional experience (Experience section) to exactly the top 2-3 most recent or relevant roles.
2. LIMIT projects (Projects section) to exactly 2-3 of the most relevant or high-scoring projects.
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
7. Any claim of a performance metric (e.g., "reduced latency by 40%", "achieved sub-50ms responses") MUST be reasonable, logical, and directly tied to the technologies used (e.g., only mention caching speedups if the project actually used a cache like Redis, Memcached, or browser localStorage).

Uplift basic phrasing into powerful, high-altitude software engineering lingo, but stay 100% truthful, factual, and anchored in the real code files and dependencies.

=== ATS OPTIMIZATION RULES ===
1. Use STANDARD section headers: "Education", "Experience", "Projects", "Technical Skills"
2. NO special characters, emojis, or unicode symbols
3. Use FULL technology names first, then abbreviations: "JavaScript (JS)", "Amazon Web Services (AWS)"
4. Include KEYWORDS from job descriptions naturally in bullets
5. Use simple, clean formatting - no tables, columns, or graphics
6. Spell out acronyms on first use
7. Use standard date formats: "Jan 2023 - Present" or "2021 - 2023"

=== LRBT/ATS BULLET POINT FRAMEWORKS ===
Every bullet point MUST follow ONE of these proven frameworks for maximum ATS/LRBT scoring:

**WHO Framework** (What you did, How you did it, Outcome achieved):
- "Developed [WHAT] using [HOW/technologies] resulting in [OUTCOME with metrics]"
- Example: "Developed real-time notification system using WebSockets and Redis, reducing latency by 60%"

**CAN Framework** (Challenge, Action, Numbers/Results):
- "[CHALLENGE faced] → [ACTION taken] → [NUMBERS/measurable result]"
- Example: "Scaling bottleneck with 10K users → Implemented horizontal scaling with Kubernetes → Achieved 99.9% uptime"

**FOCUS Framework** (Format, Outcome, Clarity, Uniqueness, Structure):
- Clear action verb + unique contribution + structured outcome
- Example: "Architected microservices migration using Go and Kafka, reducing deployment time from 2 hours to 15 minutes"

**TRP Framework** (Task, Result, Performance metric):
- "[TASK] achieving [RESULT] with [PERFORMANCE METRIC]"
- Example: "Optimized database queries achieving 3x faster page loads with 40% reduction in server costs"

CRITICAL: Each bullet MUST contain:
- Strong ACTION VERB
- SPECIFIC technologies/tools/packages used (no generic descriptions)
- QUANTIFIABLE outcome/metric (%, numbers, scale, time saved, cost reduction)

=== SECTION GUIDELINES ===

1. PROFESSIONAL TITLE:
   - Use industry-standard titles that ATS recognizes
   - Format: "[Seniority] [Specialization] [Engineer/Developer]"
   - Good: "Senior Software Engineer", "Full Stack Developer", "Backend Engineer"

2. EDUCATION:
   - Extract ONLY from LinkedIn text or GitHub bio (DO NOT fabricate)
   - Limit to top 1-2 entries.

3. CERTIFICATIONS & LICENSES:
   - Extract from LinkedIn text (DO NOT fabricate)
   - Limit to top 2-3 most relevant items.

4. EXPERIENCE:
   - Extract from LinkedIn or fallback to Open Source Contributor.
   - Limit to exactly 2-3 most recent or relevant roles.
   - Exactly 1 to 2 highly concise bullet points per role (max 120 characters each). Default to 2 bullet points, but use exactly 1 if asked. Focus strictly on What was done, specific packages/libraries/tools used, and measurable outcome.

5. PROJECTS (USE DEEP ANALYSIS DATA):
   - Repos are sorted by qualityScore. Select EXACTLY 2-3 BEST projects.
   - **CRITICAL: NO DUPLICATION WITH EXPERIENCE SECTION**
   - **CRITICAL: MERGE RELATED REPOSITORIES INTO SINGLE PROJECTS** (e.g. merge [name]-frontend and [name]-backend into [name]). Combine technologies and describe the full product.
   - **MANDATORY RULES FOR PROJECT DESCRIPTIONS:**
     * Use ACTUAL dependencies from the dependencies array (specific packages/libraries from package.json, requirements.txt, go.mod, Cargo.toml, etc.).
     * Exactly 1 to 2 bullet points per project. Limit each bullet point to a maximum of 120 characters. Default to 2 bullet points, but use exactly 1 if requested by the user. Focus heavily on technologies used and quantifiable results.
     * Bullet 1: "Developed [projectType] using [3-4 actual dependencies] resulting in [outcome]"
     * Bullet 2: "Implemented [key feature] achieving [result] with [performance/deployment status]" (Omit this bullet if generating exactly 1 bullet point per project).

6. TECHNICAL SKILLS:
   - Categorize into Languages, Frameworks, and Tools. Format as comma-separated lists.

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

  return data;
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
You are an ATS-Optimized Resume Editor making precise, targeted edits while maintaining ATS compatibility.

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

=== STRICT ONE-PAGE CONSTRAINT & CONCISENESS (CRITICAL) ===
The entire resume MUST fit perfectly on EXACTLY one page (A4/Letter).
1. LIMITS ON QUANTITY: The 2-3 role limit in the Experience section and 2-3 project limit in the Projects section apply ONLY if the user explicitly requests to condense the resume or specifically asks to edit/truncate/add items in those respective sections.
2. PRESERVE UNTOUCHED SECTIONS: If the user is performing a targeted edit (e.g., updating skills, education, certifications, or editing a specific single project), you MUST preserve all existing roles and projects exactly as they are without deleting, merging, or truncating them to meet the 2-3 limit, while still ensuring the newly edited content is highly concise.
3. Every bullet point MUST be highly concise (maximum 120 characters per bullet) and fit on a single line when rendered. Avoid long, wordy descriptions or paragraph narrative.
4. Focus heavily on What was done, What specific libraries/tools/frameworks were used, and What the measurable outcome/result was.
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
7. Any claim of a performance metric (e.g., "reduced latency by 40%", "achieved sub-50ms responses") MUST be reasonable, logical, and directly tied to the technologies used (e.g., only mention caching speedups if the project actually used a cache like Redis, Memcached, or browser localStorage).

Uplift basic phrasing into powerful, high-altitude software engineering lingo, but stay 100% truthful, factual, and anchored in the real code files and dependencies.

=== CRITICAL RULES ===

1. PRESERVATION & USER INTENT (CRITICAL):
   - ONLY modify what the user EXPLICITLY asks to change (e.g. if adding a project or fixing a specific item).
   - **PRESERVE ALL ITEM IDs**: You MUST copy the 'id' field character-for-character from the current resume JSON into the corresponding items in the new resume JSON. Do NOT generate new IDs or drop existing ones.
   - Copy unchanged sections EXACTLY (including all IDs).
   - **CRITICAL**: If the user explicitly asks to make descriptions "1 line", "1 bullet point", or "shorten/condense", ALWAYS prioritize this request and generate EXACTLY 1 highly concise bullet point per project/experience.

2. ATS/LRBT OPTIMIZATION (Apply to ALL changes):
   - Use standard action verbs: Developed, Implemented, Designed, Led, Optimized, Built, Engineered, Architected
   - Include measurable results: percentages, numbers, scale, cost savings
   - Use full technology names: "JavaScript (JS)", "Amazon Web Services (AWS)"
   - NO special characters, emojis, or fancy formatting
   - Keep bullet points extremely concise (max 120 characters)

3. MANDATORY BULLET FRAMEWORKS (WHO/CAN/FOCUS/TRP):
   Every bullet MUST follow one of these LRBT-optimized frameworks:
   
   **WHO** (What, How, Outcome):
   - "Developed [WHAT] using [HOW/tech] resulting in [OUTCOME with metrics]"
   
   **CAN** (Challenge, Action, Numbers):
   - "[Challenge] → [Action taken] → [Quantifiable result]"
   
   **FOCUS** (Format, Outcome, Clarity, Uniqueness, Structure):
   - Clear verb + unique contribution + structured measurable outcome
   
   **TRP** (Task, Result, Performance):
   - "[Task] achieving [Result] with [Performance metric]"

4. WHEN ADDING CONTENT:
   - Projects: Find in REPOSITORIES or LinkedIn context. Create 1 to 2 concise bullets using WHO/CAN/TRP frameworks (max 120 characters each). Default to 2, but use exactly 1 if requested by the user.
   - Experience: Extract from LinkedIn context. Create 1 to 2 bullets using frameworks above (max 120 characters each). Default to 2, but use exactly 1 if requested by the user.
   - Skills: Add to appropriate category (languages/frameworks/tools)
   - **CRITICAL**: If adding a project, ensure it's NOT already mentioned in Experience section (no work projects in Projects section)

5. BULLET POINT REQUIREMENTS:
   - Start with strong ACTION VERB
   - Include SPECIFIC technologies (not generic terms)
   - End with QUANTIFIABLE outcome (%, numbers, time, scale, cost)
   - Example: "Built scalable API using Express.js and PostgreSQL, reducing latency by 40%"

6. COMMON REQUESTS:
   - "Make it more impactful" → Add metrics and stronger verbs, apply WHO/CAN frameworks
   - "Add project X" → Create entry with tech stack and 1-2 framework-compliant bullets (max 120 chars each)
   - "Condense / 1 line / 1 bullet" → Keep only exactly 1 concise, high-impact bullet point per item using TRP format for brevity
   - "More technical" → Add specific technologies, architectures, methodologies
   - "Target [role]" → Emphasize relevant skills using industry keywords

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

  // Re-hydrate links just in case AI dropped them or added new projects without URLs
  newData.projects = newData.projects.map(p => {
    // Try exact match first
    let realRepo = context.repos.find(r => r.name.toLowerCase() === p.name.toLowerCase());

    // If no exact match, try to find related repos (for merged projects)
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

    // Recover ID from currentResume if omitted by AI
    let matchedId = p.id;
    if (!matchedId && currentResume.projects) {
      const existingMatch = currentResume.projects.find(pr =>
        pr.name?.toLowerCase() === p.name?.toLowerCase()
      );
      if (existingMatch) {
        matchedId = existingMatch.id;
      }
    }

    return {
      ...p,
      id: matchedId || generateId(),
      url: realRepo ? realRepo.html_url : (p.url || ''),
      homepage: realRepo?.homepage || p.homepage || '',
      isPrivate: realRepo?.private || false,
      stars: realRepo ? realRepo.stargazers_count : (p.stars || 0),
      description: p.description || [],
      technologies: p.technologies || []
    };
  });

  // Ensure experience items have IDs with smart recovery fallback using composite matches
  const consumedExperienceIds = new Set<string>();
  newData.experience.forEach(e => {
    if (e.id) consumedExperienceIds.add(e.id);
  });

  newData.experience = newData.experience.map(e => {
    let matchedId = e.id;
    if (!matchedId && currentResume.experience) {
      // Look for a unique composite match of both company AND title
      const existingMatch = currentResume.experience.find(ex =>
        !consumedExperienceIds.has(ex.id) &&
        ex.company?.toLowerCase() === e.company?.toLowerCase() &&
        ex.title?.toLowerCase() === e.title?.toLowerCase()
      );
      if (existingMatch) {
        matchedId = existingMatch.id;
        consumedExperienceIds.add(existingMatch.id);
      }
    }
    return {
      ...e,
      id: matchedId || generateId(),
      description: e.description || []
    };
  });

  // Ensure education items have IDs with smart recovery fallback using composite matches
  const consumedEducationIds = new Set<string>();
  newData.education.forEach(e => {
    if (e.id) consumedEducationIds.add(e.id);
  });

  newData.education = newData.education.map(e => {
    let matchedId = e.id;
    if (!matchedId && currentResume.education) {
      // Look for a unique composite match of both institution AND degree
      const existingMatch = currentResume.education.find(ed =>
        !consumedEducationIds.has(ed.id) &&
        ed.institution?.toLowerCase() === e.institution?.toLowerCase() &&
        ed.degree?.toLowerCase() === e.degree?.toLowerCase()
      );
      if (existingMatch) {
        matchedId = existingMatch.id;
        consumedEducationIds.add(existingMatch.id);
      }
    }
    return {
      ...e,
      id: matchedId || generateId()
    };
  });

  // Ensure certification items have IDs with smart recovery fallback using composite matches
  const consumedCertificationIds = new Set<string>();
  (newData.certifications || []).forEach(c => {
    if (c.id) consumedCertificationIds.add(c.id);
  });

  newData.certifications = (newData.certifications || []).map(c => {
    let matchedId = c.id;
    if (!matchedId && currentResume.certifications) {
      // Look for a unique composite match of both name AND issuer
      const existingMatch = currentResume.certifications.find(ce =>
        !consumedCertificationIds.has(ce.id) &&
        ce.name?.toLowerCase() === c.name?.toLowerCase() &&
        ce.issuer?.toLowerCase() === c.issuer?.toLowerCase()
      );
      if (existingMatch) {
        matchedId = existingMatch.id;
        consumedCertificationIds.add(existingMatch.id);
      }
    }
    return {
      ...c,
      id: matchedId || generateId()
    };
  });

  return newData;
};