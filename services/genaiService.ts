import { GoogleGenAI, Type, Schema } from "@google/genai";
import { GitHubRepo, GitHubUser, ResumeData, EnrichedRepoData } from '../types';
import { GITHUB_API, RESUME_SCORING } from '../constants';

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
          institution: { type: Type.STRING, description: "University or college name" },
          degree: { type: Type.STRING, description: "Degree type and major (e.g., 'B.S. Computer Science')" },
          location: { type: Type.STRING, description: "City, Country" },
          period: { type: Type.STRING, description: "Date range (e.g., '2018 - 2022')" }
        },
        required: ["institution", "degree"]
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
      description: "Top 4-6 most impressive projects. Prioritize: starred repos, recently updated, unique/complex projects.",
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Project name (use repo name or cleaned-up version)" },
          description: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "2-4 impactful bullet points. Use action verbs. Highlight: technical challenges solved, technologies used, scale/metrics if available. Format: 'Verb + what + result/impact'"
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
      description: "Professional work experience. Extract from LinkedIn first. If none found, infer from GitHub activity (e.g., 'Open Source Contributor' periods).",
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "Job title" },
          company: { type: Type.STRING, description: "Company or organization name" },
          period: { type: Type.STRING, description: "Date range (e.g., 'Jan 2022 - Present')" },
          description: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "2-4 achievement-focused bullets. Use Google XYZ format: 'Accomplished [X] as measured by [Y], by doing [Z]'. Include metrics when possible."
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
      // Safe date parsing with fallback
      let updateTime = 0;
      try {
        const date = new Date(r.updated_at);
        updateTime = isNaN(date.getTime()) ? 0 : date.getTime();
      } catch {
        updateTime = 0;
      }

      const stars = typeof r.stargazers_count === 'number' ? r.stargazers_count : 0;

      return {
        ...r,
        sortScore: updateTime + (stars * RESUME_SCORING.ONE_WEEK_MS * RESUME_SCORING.STAR_WEIGHT_MULTIPLIER)
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
    dependencies: r.enrichedData?.detectedTechnologies?.slice(0, 20), // Top 20 techs
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
  }));

  const prompt = `
You are an elite ATS-Optimized Resume Writer specializing in tech resumes that pass Applicant Tracking Systems and impress hiring managers at top companies.

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

=== ATS OPTIMIZATION RULES (CRITICAL) ===
1. Use STANDARD section headers: "Education", "Experience", "Projects", "Technical Skills"
2. NO special characters, emojis, or unicode symbols
3. Use FULL technology names first, then abbreviations: "JavaScript (JS)", "Amazon Web Services (AWS)"
4. Include KEYWORDS from job descriptions naturally in bullets
5. Use simple, clean formatting - no tables, columns, or graphics
6. Spell out acronyms on first use
7. Use standard date formats: "Jan 2023 - Present" or "2021 - 2023"

=== SECTION GUIDELINES ===

1. PROFESSIONAL TITLE:
   - Use industry-standard titles that ATS recognizes
   - Format: "[Seniority] [Specialization] [Engineer/Developer]"
   - Good: "Senior Software Engineer", "Full Stack Developer", "Backend Engineer"
   - Avoid: Creative titles like "Code Ninja", "Tech Wizard"

2. EDUCATION:
   - Extract ONLY from LinkedIn text or GitHub bio
   - DO NOT fabricate - return empty array if none found
   - Format: Institution, Degree, Location, Period
   - Include GPA only if 3.5+ or honors/awards

3. EXPERIENCE:
   - PRIMARY: Extract from LinkedIn (company, title, dates, achievements)
   - FALLBACK: "Open Source Developer" or "Freelance Software Engineer" based on GitHub activity
   - BULLET FORMAT (STAR Method):
     * Start with strong ACTION VERB (Developed, Implemented, Architected, Optimized, Led, Designed)
     * Include WHAT you did + HOW + MEASURABLE RESULT
     * Example: "Developed RESTful API using Node.js and Express, reducing response time by 40% and handling 10K+ daily requests"
   - 3-5 bullets per role, most impactful first
   - Include technologies used in each bullet naturally

4. PROJECTS (USE DEEP ANALYSIS DATA - THIS IS CRITICAL):
   - Repos are ALREADY SORTED by qualityScore (considers commits, code size, complexity, tests, docs)
   - Select 3-5 BEST projects from the top of the list
   - PRIVATE REPOS with high commits are often MORE impressive than public repos with stars
   - Prioritize: qualityScore, commits > 100, complexity='complex', hasMetrics=true, hasDemo=true
   - USE the enriched data to write ACCURATE, IMPRESSIVE, REAL descriptions
   
   **CRITICAL: MERGE RELATED REPOSITORIES INTO SINGLE PROJECTS**
   - DETECT repositories that are part of the SAME product/project (e.g., "idolchat", "idolchat-app", "idolchat-backend")
   - Common patterns: [name], [name]-frontend, [name]-backend, [name]-api, [name]-app, [name]-mobile, [name]-web, [name]-server, [name]-client
   - When you find related repos (same base name with suffixes), MERGE them into ONE project entry
   - Use the base product name (e.g., "idolchat" not "idolchat-backend")
   - Combine ALL technologies from all related repos into the technologies array
   - Write bullets that describe the FULL product, mentioning frontend/backend/mobile components
   - Use the HIGHEST star count and combine all URLs (use homepage if available, otherwise main repo)
   
   **MERGE EXAMPLE:**
   Instead of 3 separate projects:
   - "idolchat" (landing page)
   - "idolchat-app" (mobile app)
   - "idolchat-backend" (API)
   
   Create ONE project:
   - Name: "idolchat"
   - Technologies: [React.js, Next.js, TypeScript, CSS, React Native, Expo, Node.js, Express.js, Google Generative AI, Prisma, LibSQL, bcryptjs]
   - Bullets:
     * "Developed full-stack chat application with React/Next.js landing page, React Native mobile app, and Node.js/Express backend API"
     * "Integrated Google Generative AI for advanced AI capabilities and implemented secure authentication with bcryptjs"
     * "Architected scalable backend using Prisma ORM with LibSQL, supporting real-time chat and media sharing across web and mobile platforms"
   
   **MANDATORY RULES FOR PROJECT DESCRIPTIONS:**
   - Use ACTUAL dependencies from the 'dependencies' array (these are REAL packages from package.json/requirements.txt)
   - Mention projectType (e.g., "full-stack application", "REST API", "CLI tool", "library")
   - If hasTests=true → "comprehensive test suite" or "test-driven development"
   - If hasBuild=true → "production-ready build pipeline"
   - If hasLint=true → "enforced code quality standards"
   - If hasDemo=true → "deployed live at [homepage]" or "production deployment"
   - If hasDocs=true → "comprehensive documentation"
   - If hasMetrics=true → extract and use the actual numbers from README
   - If complexity='complex' → emphasize architecture, scalability, advanced patterns
   - If stars > 10 → mention community adoption
   - If forks > 5 → mention open-source contribution
   
   **DESCRIPTION FORMULA:**
   Bullet 1: "Developed [projectType] using [3-5 ACTUAL dependencies from list] [+ architecture pattern if complex]"
   Bullet 2: "Implemented [key features inferred from description/README] with [specific tech from dependencies]"
   Bullet 3: "[Impact: metrics from README OR stars/forks OR deployment status]"
   
   **EXAMPLES:**
   - Simple project: "Built CLI tool using Python, Click, and Requests to automate API testing workflows"
   - Complex project: "Architected full-stack e-commerce platform using React, Redux, TypeScript, Node.js, Express, PostgreSQL, and Redis with microservices architecture, comprehensive Jest/Cypress test suite, deployed on AWS with CI/CD pipeline via GitHub Actions, serving 5000+ daily users"
   - Library: "Developed open-source React component library using TypeScript, Storybook, and Rollup with 150+ GitHub stars and 20+ contributors"
   
   **BE SPECIFIC AND ACCURATE**: Only mention technologies that appear in the dependencies array or techStack

5. TECHNICAL SKILLS (ATS-Critical):
   - Languages: List ALL programming languages from repos (JavaScript, TypeScript, Python, Java, etc.)
   - Frameworks: React, Node.js, Express, Django, Spring Boot, etc.
   - Tools & Platforms: Git, Docker, Kubernetes, AWS, GCP, Azure, CI/CD, databases
   - Format as comma-separated lists for ATS parsing

=== QUALITY STANDARDS ===
- Every bullet MUST have a measurable outcome or clear impact
- Use numbers: "50% faster", "10K users", "99.9% uptime", "3x improvement"
- NO generic phrases: "responsible for", "worked on", "helped with"
- NO first person (I, my, we)
- Keep bullets concise: 1-2 lines max
- Prioritize recent and relevant experience
- Technical depth over breadth
- ATS-friendly formatting

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

AVAILABLE REPOSITORIES (for adding projects):
${JSON.stringify(relevantRepos, null, 2)}

ENRICHED REPOSITORY DATA (with package.json/README analysis):
${JSON.stringify(enrichedRepoContext, null, 2)}

USER CONTEXT:
- Name: ${context.user.name || context.user.login}
- Bio: ${context.user.bio || 'N/A'}
- LinkedIn/Extra: ${context.linkedinText || 'N/A'}

USER INSTRUCTION:
"${sanitizedPrompt}"

=== CRITICAL RULES ===

1. PRESERVATION IS PARAMOUNT:
   - ONLY modify what the user EXPLICITLY asks to change
   - DO NOT remove, rewrite, or "improve" sections NOT mentioned
   - DO NOT condense content unless explicitly asked
   - Copy unchanged sections EXACTLY (including all IDs)

2. ATS OPTIMIZATION (Apply to ALL changes):
   - Use standard action verbs: Developed, Implemented, Designed, Led, Optimized, Built
   - Include measurable results: percentages, numbers, scale
   - Use full technology names: "JavaScript" not "JS", "Amazon Web Services (AWS)"
   - NO special characters, emojis, or fancy formatting
   - Keep bullet points concise (1-2 lines)

3. WHEN ADDING CONTENT:
   - Projects: Find in REPOSITORIES, create 2-3 impactful bullets with technologies and metrics
   - Experience: Use STAR format (Situation, Task, Action, Result)
   - Skills: Add to appropriate category (languages/frameworks/tools)

4. BULLET POINT FORMAT:
   - Start with strong ACTION VERB
   - Include WHAT + HOW + RESULT
   - Example: "Developed scalable REST API using Node.js and PostgreSQL, handling 50K+ daily requests with 99.9% uptime"

5. COMMON REQUESTS:
   - "Make it more impactful" → Add metrics and stronger verbs to existing bullets
   - "Add project X" → Create entry with tech stack and 2-3 achievement bullets
   - "Condense" → Keep most impactful points, remove redundancy
   - "More technical" → Add specific technologies, architectures, methodologies
   - "Target [role]" → Emphasize relevant skills and experiences for that role

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

  // Ensure experience and education items have IDs
  newData.experience = newData.experience.map(e => ({
    ...e,
    id: e.id || generateId(),
    description: e.description || []
  }));

  newData.education = newData.education.map(e => ({
    ...e,
    id: e.id || generateId()
  }));

  return newData;
};